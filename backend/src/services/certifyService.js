/**
 * certifyService.js — Inji Certify Integration Service
 *
 * Implements the full credential issuance lifecycle:
 *   getAccessToken()              — client_credentials + private_key_jwt (RS256)
 *   getNonce(accessToken)         — explicit POST /nonce endpoint
 *   buildProofJWT(nonce)          — RS256 DPoP proof construction
 *   buildCredentialSubject(t, o)  — TenderAwardCredential JSON-LD subject
 *   validateCredentialResponse(r) — structural + issuer DID verification
 *   issueCredential(tender, off)  — full orchestration with PENDING state
 *   revokeCredential(credId, ...)  — revoke on Inji + local DB
 *
 * Security constraints (from spec):
 *   • Never log the access token or private key
 *   • All network calls have 30-second timeout
 *   • Retry with exponential backoff: 1s, 2s, 4s then fail
 *   • Proof JWT signed with RS256 per Inji Certify sandbox spec
 */

import axios from 'axios';
import axiosRetry from 'axios-retry';
import NodeCache from 'node-cache';
import { v4 as uuidv4 } from 'uuid';
import * as jose from 'jose';
import { pool } from '../config/database.js';
import { vcModel } from '../models/vcModel.js';
import { numberToWords } from '../utils/numberToWords.js';
import logger from '../utils/logger.js';
import {
  CertifyNetworkError,
  CertifyAuthError,
  CertifyValidationError,
  CertifyRevocationError
} from '../errors/certifyErrors.js';

export class InjiCertifyService {
  constructor() {
    this.baseUrl = process.env.CERTIFY_BASE_URL || 'https://api.certify.mock/v1';
    this.clientId = process.env.CERTIFY_CLIENT_ID || 'tender-portal-backend';
    this.privateKeyPem = process.env.BACKEND_PRIVATE_KEY || '';
    this.expectedIssuerDid = process.env.CERTIFY_EXPECTED_ISSUER_DID || null;

    // Token cache with auto-expiry
    this.cache = new NodeCache();

    // HTTP client — 30s timeout, no logging of auth headers
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
    });

    // Exponential backoff retry: 1s → 2s → 4s → fail
    axiosRetry(this.client, {
      retries: 3,
      retryDelay: axiosRetry.exponentialDelay,
      retryCondition: (error) => {
        // Retry on network errors or 5xx; NOT 401s (handled by DPoP interceptor)
        return axiosRetry.isNetworkOrIdempotentRequestError(error) ||
               (error.response?.status >= 500);
      }
    });

    // ── Dynamic DPoP Nonce Interception (RFC 9449) ────────────
    // If a request returns 401 with a DPoP-Nonce header, we
    // extract the nonce, rebuild the proof JWT, and replay once.
    this.client.interceptors.response.use(
      (response) => {
        // Passively cache any DPoP-Nonce header from successful responses too
        const nonce = response.headers?.['dpop-nonce'];
        if (nonce) this.cache.set('dpop_nonce', nonce);
        return response;
      },
      async (error) => {
        const originalRequest = error.config;
        const nonceHeader = error.response?.headers?.['dpop-nonce'];

        if (error.response?.status === 401 && nonceHeader && !originalRequest._retryWithNewNonce) {
          logger.info('Intercepted fresh DPoP nonce from 401, replaying request...');
          originalRequest._retryWithNewNonce = true;
          this.cache.set('dpop_nonce', nonceHeader);

          if (originalRequest.dpopBuilder) {
            const newProof = await originalRequest.dpopBuilder(nonceHeader);
            originalRequest.headers['DPoP'] = newProof;
            return this.client.request(originalRequest);
          }
        }
        return Promise.reject(error);
      }
    );
  }

  // ───────────────────────────────────────────────────────────
  // getAccessToken()
  // Uses client_credentials grant with private_key_jwt (RS256)
  // Caches until 60s before expiry.
  // ───────────────────────────────────────────────────────────
  async getAccessToken() {
    const cached = this.cache.get('access_token');
    if (cached) return cached;

    try {
      const privateKey = await jose.importPKCS8(this.privateKeyPem, 'RS256');

      const clientAssertion = await new jose.SignJWT({
        iss: this.clientId,
        sub: this.clientId,
        aud: `${this.baseUrl}/oauth/token`,
        jti: uuidv4()
      })
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
        .setIssuedAt()
        .setExpirationTime('2m')
        .sign(privateKey);

      const response = await this.client.post('/oauth/token', new URLSearchParams({
        grant_type: 'client_credentials',
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: clientAssertion
      }).toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });

      const token = response.data.access_token;
      const expiresIn = response.data.expires_in || 3600;
      this.cache.set('access_token', token, Math.max(1, expiresIn - 60));

      return token;
    } catch (error) {
      throw new CertifyAuthError(
        `Failed to get access token: ${error.message}`,
        error.response?.data
      );
    }
  }

  // ───────────────────────────────────────────────────────────
  // getNonce(accessToken)
  // Explicit POST to /nonce as required by the spec.
  // The interceptor is a fallback; this is the primary path.
  // ───────────────────────────────────────────────────────────
  async getNonce(accessToken) {
    try {
      const response = await this.client.post('/nonce', null, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      const nonce = response.data?.c_nonce || response.data?.nonce;
      if (!nonce) {
        throw new CertifyValidationError('Nonce endpoint returned no nonce value');
      }

      this.cache.set('dpop_nonce', nonce);
      return nonce;
    } catch (error) {
      if (error instanceof CertifyValidationError) throw error;
      throw new CertifyNetworkError(
        `Failed to get nonce: ${error.message}`,
        error.response?.data
      );
    }
  }

  // ───────────────────────────────────────────────────────────
  // buildProofJWT(nonce)
  // DPoP proof signed with RS256 per Inji Certify sandbox spec.
  // ───────────────────────────────────────────────────────────
  async buildProofJWT(nonce) {
    const privateKey = await jose.importPKCS8(this.privateKeyPem, 'RS256');

    return await new jose.SignJWT({
      iss: this.clientId,
      sub: this.clientId,
      aud: `${this.baseUrl}/v1/credential`,
      nonce: nonce,
      jti: uuidv4()
    })
      .setProtectedHeader({ alg: 'RS256', typ: 'openid4vci-proof+jwt' })
      .setIssuedAt()
      .setExpirationTime('2m')
      .sign(privateKey);
  }

  // ───────────────────────────────────────────────────────────
  // mapLoaToMethod(loa)
  // Maps internal LoA enum to human-readable verification method.
  // ───────────────────────────────────────────────────────────
  mapLoaToMethod(loa) {
    const map = {
      'LOA_3_BIOMETRIC': 'Biometric Fingerprint',
      'LOA_2_DEMOGRAPHIC': 'Demographic Match',
      'LOA_2_OTP': 'OTP Verification'
    };
    return map[loa] || 'OTP Verification';
  }

  // ───────────────────────────────────────────────────────────
  // buildCredentialSubject(tender, officer)
  // Constructs the TenderAwardCredential JSON-LD subject with
  // the exact nested structure registered in Inji Certify.
  // ───────────────────────────────────────────────────────────
  buildCredentialSubject(tender, officer) {
    // Convert paisa → rupees as integer for numberToWords
    const valueInPaisa = tender.actual_value || tender.estimated_value;
    const valueInRupees = Math.floor(valueInPaisa / 100);

    return {
      tenderId: tender.tender_id,
      tenderTitle: tender.title,
      tenderValueINR: valueInRupees,
      tenderValueWords: numberToWords(valueInPaisa),
      currency: 'INR',
      awardedTo: {
        entityName: tender.awarded_to_name,
        gstin: tender.awarded_to_gstin,
        email: tender.awarded_to_email
      },
      approvingAuthority: {
        name: officer.name,
        designation: officer.designation,
        department: tender.department,
        verifiedIdentityRef: officer.aadhaar_sub,
        verificationMethod: this.mapLoaToMethod(officer.loa_level),
        verificationTimestamp: officer.last_login_at || new Date().toISOString()
      },
      contractPeriod: {
        startDate: tender.contract_start_date,
        endDate: tender.contract_end_date
      },
      governmentReference: {
        tenderBoardMinuteRef: tender.tender_id,
        issuingAuthority: 'Government of Maharashtra'
      }
    };
  }

  // ───────────────────────────────────────────────────────────
  // validateCredentialResponse(response)
  // Structural checks per spec: credentialSubject, proof with
  // type+proofValue, credentialStatus with statusListIndex,
  // issuer matching expected DID.
  // ───────────────────────────────────────────────────────────
  validateCredentialResponse(response) {
    if (!response.credentialSubject) {
      throw new CertifyValidationError('Missing credentialSubject in response');
    }

    if (!response.proof) {
      throw new CertifyValidationError('Missing proof in response');
    }
    if (!response.proof.type) {
      throw new CertifyValidationError('Missing proof.type in response');
    }
    if (!response.proof.proofValue && !response.proof.jwt) {
      throw new CertifyValidationError('Missing proof.proofValue (or proof.jwt) in response');
    }

    if (!response.credentialStatus ||
        typeof response.credentialStatus.statusListIndex === 'undefined') {
      throw new CertifyValidationError('Missing statusListIndex in credentialStatus');
    }

    if (!response.issuer) {
      throw new CertifyValidationError('Missing issuer in response');
    }

    // Verify issuer DID matches expectations if configured
    const issuerId = typeof response.issuer === 'string'
      ? response.issuer
      : response.issuer?.id;
    if (this.expectedIssuerDid && issuerId !== this.expectedIssuerDid) {
      throw new CertifyValidationError(
        `Issuer DID mismatch: expected ${this.expectedIssuerDid}, got ${issuerId}`
      );
    }
  }

  // ───────────────────────────────────────────────────────────
  // issueCredential(tender, officer)
  //
  // Full orchestration flow:
  //   1. Idempotency check — return existing VC if already issued
  //   2. Write PENDING_ISSUANCE to vc_records (no ghost credentials)
  //   3. Get access token (cached via private_key_jwt)
  //   4. Get nonce explicitly via getNonce()
  //   5. Build proof JWT + credential subject
  //   6. POST to Inji Certify /v1/credential
  //   7. Validate response structure
  //   8. Atomically allocate status list index + finalise DB record
  //   9. On DB failure: attempt compensating revocation on Inji
  // ───────────────────────────────────────────────────────────
  async issueCredential(tender, officer) {
    // ── Step 1: Idempotency ──
    let pendingVc = await vcModel.getVCByTenderId(tender.id);
    if (pendingVc && pendingVc.credential_id && !pendingVc.credential_id.startsWith('PENDING-')) {
      // Already fully issued — return existing
      return { credential: pendingVc.vc_json, statusListIndex: pendingVc.status_list_index };
    }

    // ── Step 2: Write PENDING state ──
    if (!pendingVc) {
      pendingVc = await vcModel.createPendingVC(tender.id);
    }

    let credential = null;

    try {
      // ── Step 3: Access token ──
      const accessToken = await this.getAccessToken();

      // ── Step 4: Get nonce explicitly ──
      const nonce = await this.getNonce(accessToken);

      // ── Step 5: Build proof + subject ──
      const subject = this.buildCredentialSubject(tender, officer);
      const proofJwt = await this.buildProofJWT(nonce);

      const dpopBuilder = async (newNonce) => {
        return await this.buildProofJWT(newNonce);
      };

      // ── Step 6: Issue via Inji Certify API ──
      const response = await this.client.post('/v1/credential', {
        format: 'ldp_vc',
        credential_definition: {
          '@context': [
            'https://www.w3.org/2018/credentials/v1',
            'https://w3id.org/security/suites/ed25519-2020/v1'
          ],
          type: ['VerifiableCredential', 'TenderAwardCredential']
        },
        credentialSubject: subject,
        proof: {
          proof_type: 'jwt',
          jwt: proofJwt
        }
      }, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'DPoP': proofJwt
        },
        dpopBuilder // Custom config consumed by the DPoP nonce interceptor
      });

      credential = response.data.credential || response.data;

      // ── Step 7: Validate ──
      this.validateCredentialResponse(credential);

      // ── Step 8: Atomic DB finalisation ──
      const dbClient = await pool.connect();
      try {
        await dbClient.query('BEGIN');

        const allocation = await vcModel.allocateStatusListIndex(dbClient);
        const finalIndex = credential.credentialStatus.statusListIndex ?? allocation.index;
        const finalListUrl = credential.credentialStatus.statusListCredential || allocation.list_id;

        const finalVc = await vcModel.updateToIssued(
          pendingVc.id,
          credential.id || uuidv4(),
          credential,
          finalListUrl,
          finalIndex
        );

        await dbClient.query('COMMIT');
        return { credential: finalVc.vc_json, statusListIndex: finalIndex };
      } catch (dbErr) {
        await dbClient.query('ROLLBACK');

        // ── Step 9: Compensating revocation ──
        // VC was successfully issued by Inji but our DB save failed.
        // We MUST attempt to revoke it to prevent orphaned credentials.
        logger.error(`DB save failed after successful issuance. Attempting compensating revocation...`);
        try {
          await this.revokeCredential(credential.id, 'ADMINISTRATIVE_ERROR', null, null);
          logger.info(`Compensating revocation succeeded for credential: ${credential.id}`);
        } catch (revokeErr) {
          // CRITICAL: Ghost credential exists! Log for manual remediation.
          logger.error(`CRITICAL: Compensating revocation FAILED for credential ${credential.id}. ` +
                        `Manual intervention required. Error: ${revokeErr.message}`);
        }
        throw new CertifyNetworkError(
          `VC issued but DB save failed: ${dbErr.message}. Compensating revocation attempted.`,
          { credentialId: credential.id }
        );
      } finally {
        dbClient.release();
      }

    } catch (error) {
      if (error instanceof CertifyValidationError ||
          error instanceof CertifyNetworkError ||
          error instanceof CertifyAuthError) {
        throw error;
      }
      logger.error(`Certify issuance failed: ${error.message}`);
      throw new CertifyNetworkError(
        `Failed to issue credential: ${error.message}`,
        error.response?.data
      );
    }
  }

  // ───────────────────────────────────────────────────────────
  // revokeCredential(credentialId, reason, officialId, notes)
  // Revokes on Inji Certify first, then updates local DB.
  // ───────────────────────────────────────────────────────────
  async revokeCredential(credentialId, reason, officialId = null, notes = null) {
    try {
      const accessToken = await this.getAccessToken();

      await this.client.post('/v1/revoke', {
        credentialId: credentialId,
        reason: reason
      }, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });

      // Update local DB if officialId is provided (not a compensating call)
      if (officialId) {
        await vcModel.markRevoked(credentialId, officialId, reason, notes);
      }

      return { success: true, credentialId };
    } catch (error) {
      throw new CertifyRevocationError(
        `Failed to revoke credential ${credentialId}: ${error.message}`,
        error.response?.data
      );
    }
  }
}

export default new InjiCertifyService();
