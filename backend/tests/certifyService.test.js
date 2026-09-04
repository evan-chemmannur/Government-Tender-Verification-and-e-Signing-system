/**
 * certifyService.test.js — Integration tests for Inji Certify Service
 *
 * Covers every spec-required test case:
 *   1. getAccessToken caches the token (doesn't call endpoint twice)
 *   2. getAccessToken uses private_key_jwt with RS256
 *   3. getNonce calls explicit /nonce endpoint
 *   4. buildProofJWT produces RS256 signed JWT
 *   5. buildCredentialSubject produces correct nested structure
 *   6. validateCredentialResponse throws on missing proof
 *   7. validateCredentialResponse throws on issuer DID mismatch
 *   8. DPoP nonce interceptor catches 401 and replays
 *   9. issueCredential returns existing VC (idempotency)
 *  10. issueCredential saves to DB on success
 *  11. issueCredential rolls back (revokes VC) on DB failure
 *  12. validateCredentialResponse throws on missing credentialSubject
 */

import { jest } from '@jest/globals';
import { InjiCertifyService } from '../src/services/certifyService.js';
import { vcModel } from '../src/models/vcModel.js';
import * as jose from 'jose';
import {
  CertifyValidationError,
  CertifyNetworkError,
  CertifyAuthError,
  CertifyRevocationError
} from '../src/errors/certifyErrors.js';
import { pool, setupTestDb, teardownTestDb } from './setup.js';

describe('Inji Certify Service Integration', () => {
  let service;
  let clientPostSpy;
  let rsaKey;

  beforeAll(async () => {
    await setupTestDb();
    // Generate a valid RS256 key pair for all tests
    const { privateKey } = await jose.generateKeyPair('RS256');
    rsaKey = await jose.exportPKCS8(privateKey);

    // Create a fresh service instance with test key
    service = new InjiCertifyService();
    service.privateKeyPem = rsaKey;

    clientPostSpy = jest.spyOn(service.client, 'post');
  });

  afterEach(() => {
    jest.restoreAllMocks();
    service.cache.flushAll();
    // Re-spy after restoreAllMocks
    clientPostSpy = jest.spyOn(service.client, 'post');
  });

  afterAll(async () => {
    await teardownTestDb();
    // pool is shared pg-mem instance - do NOT call pool.end() here
  });

  // ───────────────────────────────────────────────
  // getAccessToken
  // ───────────────────────────────────────────────
  describe('getAccessToken()', () => {
    it('should use private_key_jwt with RS256 client assertion', async () => {
      clientPostSpy.mockResolvedValueOnce({
        data: { access_token: 'tok-123', expires_in: 3600 }
      });

      await service.getAccessToken();

      // Verify the POST body includes private_key_jwt grant
      const callArgs = clientPostSpy.mock.calls[0];
      expect(callArgs[0]).toBe('/oauth/token');
      const body = callArgs[1];
      expect(body).toContain('grant_type=client_credentials');
      expect(body).toContain('client_assertion_type=urn%3Aietf%3Aparams%3Aoauth%3Aclient-assertion-type%3Ajwt-bearer');
      expect(body).toContain('client_assertion=');

      // Decode the client_assertion and verify it's RS256
      const assertionMatch = body.match(/client_assertion=([^&]+)/);
      const header = jose.decodeProtectedHeader(decodeURIComponent(assertionMatch[1]));
      expect(header.alg).toBe('RS256');
      expect(header.typ).toBe('JWT');
    });

    it('should cache the token and NOT call endpoint twice', async () => {
      clientPostSpy.mockResolvedValueOnce({
        data: { access_token: 'cached-token', expires_in: 3600 }
      });

      const token1 = await service.getAccessToken();
      const token2 = await service.getAccessToken();

      expect(token1).toBe('cached-token');
      expect(token2).toBe('cached-token');
      expect(clientPostSpy).toHaveBeenCalledTimes(1); // Only 1 call
    });

    it('should throw CertifyAuthError on failure', async () => {
      clientPostSpy.mockRejectedValueOnce(new Error('Connection refused'));

      await expect(service.getAccessToken())
        .rejects.toThrow(CertifyAuthError);
    });
  });

  // ───────────────────────────────────────────────
  // getNonce
  // ───────────────────────────────────────────────
  describe('getNonce()', () => {
    it('should POST to /nonce and return the c_nonce value', async () => {
      clientPostSpy.mockResolvedValueOnce({
        data: { c_nonce: 'server-nonce-abc' }
      });

      const nonce = await service.getNonce('mock-token');

      expect(nonce).toBe('server-nonce-abc');
      expect(clientPostSpy).toHaveBeenCalledWith('/nonce', null, {
        headers: { 'Authorization': 'Bearer mock-token' }
      });
      // Also verify it's cached
      expect(service.cache.get('dpop_nonce')).toBe('server-nonce-abc');
    });

    it('should throw CertifyValidationError if no nonce returned', async () => {
      clientPostSpy.mockResolvedValueOnce({ data: {} });

      await expect(service.getNonce('mock-token'))
        .rejects.toThrow(CertifyValidationError);
    });
  });

  // ───────────────────────────────────────────────
  // buildProofJWT
  // ───────────────────────────────────────────────
  describe('buildProofJWT()', () => {
    it('should produce a valid RS256 JWT with correct claims', async () => {
      const jwt = await service.buildProofJWT('test-nonce-123');
      const header = jose.decodeProtectedHeader(jwt);
      const payload = jose.decodeJwt(jwt);

      expect(header.alg).toBe('RS256');
      expect(header.typ).toBe('openid4vci-proof+jwt');
      expect(payload.nonce).toBe('test-nonce-123');
      expect(payload.iss).toBe(service.clientId);
      expect(payload.aud).toContain('/v1/credential');
      expect(payload.jti).toBeDefined();
    });
  });

  // ───────────────────────────────────────────────
  // buildCredentialSubject
  // ───────────────────────────────────────────────
  describe('buildCredentialSubject()', () => {
    it('should produce correct nested structure per TenderAwardCredential schema', () => {
      const tender = {
        tender_id: 'TENDER-2026-PWD-00001',
        title: 'Road Construction',
        department: 'Public Works',
        actual_value: 5000000, // 50,000 INR in paisa
        awarded_to_name: 'ABC Corp',
        awarded_to_gstin: '27AABCU9603R1ZM',
        awarded_to_email: 'abc@corp.com',
        contract_start_date: '2026-07-01',
        contract_end_date: '2027-06-30',
        estimated_value: 4500000
      };
      const officer = {
        name: 'Rajesh Kumar',
        designation: 'Chief Engineer',
        aadhaar_sub: 'PSUT-12345',
        loa_level: 'LOA_3_BIOMETRIC',
        last_login_at: '2026-06-18T10:00:00Z'
      };

      const subject = service.buildCredentialSubject(tender, officer);

      // Top-level fields
      expect(subject.tenderId).toBe('TENDER-2026-PWD-00001');
      expect(subject.tenderTitle).toBe('Road Construction');
      expect(subject.tenderValueINR).toBe(50000); // paisa → rupees
      expect(subject.tenderValueWords).toBeDefined();
      expect(subject.currency).toBe('INR');

      // awardedTo nested object
      expect(subject.awardedTo.entityName).toBe('ABC Corp');
      expect(subject.awardedTo.gstin).toBe('27AABCU9603R1ZM');
      expect(subject.awardedTo.email).toBe('abc@corp.com');

      // approvingAuthority nested object
      expect(subject.approvingAuthority.name).toBe('Rajesh Kumar');
      expect(subject.approvingAuthority.designation).toBe('Chief Engineer');
      expect(subject.approvingAuthority.department).toBe('Public Works');
      expect(subject.approvingAuthority.verifiedIdentityRef).toBe('PSUT-12345');
      expect(subject.approvingAuthority.verificationMethod).toBe('Biometric Fingerprint');
      expect(subject.approvingAuthority.verificationTimestamp).toBe('2026-06-18T10:00:00Z');

      // contractPeriod
      expect(subject.contractPeriod.startDate).toBe('2026-07-01');
      expect(subject.contractPeriod.endDate).toBe('2027-06-30');

      // governmentReference
      expect(subject.governmentReference.tenderBoardMinuteRef).toBe('TENDER-2026-PWD-00001');
      expect(subject.governmentReference.issuingAuthority).toBe('Government of Maharashtra');
    });
  });

  // ───────────────────────────────────────────────
  // validateCredentialResponse
  // ───────────────────────────────────────────────
  describe('validateCredentialResponse()', () => {
    const validResponse = {
      credentialSubject: { tenderId: 'T-1' },
      proof: { type: 'Ed25519Signature2020', proofValue: 'abc' },
      credentialStatus: { statusListIndex: 42 },
      issuer: 'did:web:certify'
    };

    it('should pass on a valid response', () => {
      expect(() => service.validateCredentialResponse(validResponse)).not.toThrow();
    });

    it('should throw on missing credentialSubject', () => {
      const bad = { ...validResponse, credentialSubject: undefined };
      expect(() => service.validateCredentialResponse(bad))
        .toThrow(CertifyValidationError);
    });

    it('should throw on missing proof', () => {
      const bad = { ...validResponse, proof: undefined };
      expect(() => service.validateCredentialResponse(bad))
        .toThrow(CertifyValidationError);
    });

    it('should throw on missing proof.type', () => {
      const bad = { ...validResponse, proof: { proofValue: 'abc' } };
      expect(() => service.validateCredentialResponse(bad))
        .toThrow(CertifyValidationError);
    });

    it('should throw on missing proof.proofValue', () => {
      const bad = { ...validResponse, proof: { type: 'Ed25519Signature2020' } };
      expect(() => service.validateCredentialResponse(bad))
        .toThrow(CertifyValidationError);
    });

    it('should throw on missing credentialStatus.statusListIndex', () => {
      const bad = { ...validResponse, credentialStatus: {} };
      expect(() => service.validateCredentialResponse(bad))
        .toThrow(CertifyValidationError);
    });

    it('should throw on missing issuer', () => {
      const bad = { ...validResponse, issuer: undefined };
      expect(() => service.validateCredentialResponse(bad))
        .toThrow(CertifyValidationError);
    });

    it('should throw on issuer DID mismatch when expectedIssuerDid is configured', () => {
      service.expectedIssuerDid = 'did:web:expected-issuer';
      expect(() => service.validateCredentialResponse(validResponse))
        .toThrow(/Issuer DID mismatch/);
      service.expectedIssuerDid = null; // Reset
    });
  });

  // ───────────────────────────────────────────────
  // DPoP Nonce Interceptor
  // ───────────────────────────────────────────────
  describe('Dynamic DPoP Nonce Interceptor', () => {
    it('should intercept 401 with dpop-nonce, cache it, and replay', async () => {
      const interceptorError = {
        config: {
          headers: {},
          dpopBuilder: async (nonce) => `proof-with-${nonce}`
        },
        response: {
          status: 401,
          headers: { 'dpop-nonce': 'fresh-server-nonce' }
        }
      };

      const requestSpy = jest.spyOn(service.client, 'request')
        .mockResolvedValueOnce({ data: { success: true } });

      // Find the interceptor that handles DPoP nonce
      const handler = service.client.interceptors.response.handlers.find(
        h => h && h.rejected && h.rejected.toString().includes('_retryWithNewNonce')
      );
      expect(handler).toBeDefined();

      const response = await handler.rejected(interceptorError);

      expect(response.data.success).toBe(true);
      expect(service.cache.get('dpop_nonce')).toBe('fresh-server-nonce');
      expect(interceptorError.config.headers['DPoP']).toBe('proof-with-fresh-server-nonce');

      requestSpy.mockRestore();
    });
  });

  // ───────────────────────────────────────────────
  // issueCredential
  // ───────────────────────────────────────────────
  describe('issueCredential()', () => {
    const mockTender = {
      id: '00000000-0000-0000-0000-000000000001',
      tender_id: 'TENDER-TEST-1',
      title: 'Test Tender',
      department: 'DEPT',
      actual_value: 500000,
      estimated_value: 500000,
      awarded_to_name: 'Test Corp',
      awarded_to_gstin: 'GSTIN123',
      awarded_to_email: 'corp@test.com',
      contract_start_date: '2026-07-01',
      contract_end_date: '2027-06-30'
    };
    const mockOfficer = {
      name: 'Officer',
      designation: 'Director',
      aadhaar_sub: 'SUB-123',
      loa_level: 'LOA_3_BIOMETRIC',
      last_login_at: '2026-06-18T10:00:00Z'
    };

    const validApiCredential = {
      id: 'urn:uuid:real-vc-id',
      issuer: 'did:web:certify',
      credentialSubject: { tenderId: 'TENDER-TEST-1' },
      proof: { type: 'Ed25519Signature2020', proofValue: 'signed-data' },
      credentialStatus: { statusListIndex: 42, statusListCredential: 'list-1' }
    };

    function setupSuccessMocks() {
      jest.spyOn(vcModel, 'getVCByTenderId').mockResolvedValue(null);
      jest.spyOn(vcModel, 'createPendingVC').mockResolvedValue({
        id: 'db-vc-id',
        credential_id: 'PENDING-TENDER-TEST-1-1234'
      });
      jest.spyOn(vcModel, 'allocateStatusListIndex').mockResolvedValue({
        list_id: 'list-1', index: 42
      });
      jest.spyOn(vcModel, 'updateToIssued').mockResolvedValue({
        vc_json: validApiCredential,
        status_list_index: 42
      });
      jest.spyOn(service, 'getAccessToken').mockResolvedValue('mock-token');
      jest.spyOn(service, 'getNonce').mockResolvedValue('test-nonce');

      // API returns valid credential
      clientPostSpy.mockResolvedValueOnce({ data: validApiCredential });
    }

    it('should return existing VC if already issued (idempotency)', async () => {
      jest.spyOn(vcModel, 'getVCByTenderId').mockResolvedValue({
        credential_id: 'urn:uuid:existing-vc',
        vc_json: { id: 'existing' },
        status_list_index: 10
      });

      const result = await service.issueCredential(mockTender, mockOfficer);

      expect(result.credential).toEqual({ id: 'existing' });
      expect(result.statusListIndex).toBe(10);
      expect(clientPostSpy).not.toHaveBeenCalled(); // No API call made
    });

    it('should create PENDING state, call API, and save to DB on success', async () => {
      setupSuccessMocks();

      const result = await service.issueCredential(mockTender, mockOfficer);

      // Verify PENDING was created
      expect(vcModel.createPendingVC).toHaveBeenCalledWith(mockTender.id);
      // Verify getNonce was called explicitly
      expect(service.getNonce).toHaveBeenCalledWith('mock-token');
      // Verify API was called
      expect(clientPostSpy).toHaveBeenCalled();
      // Verify DB was updated
      expect(vcModel.allocateStatusListIndex).toHaveBeenCalled();
      expect(vcModel.updateToIssued).toHaveBeenCalledWith(
        'db-vc-id',
        'urn:uuid:real-vc-id',
        expect.any(Object),
        'list-1',
        42
      );
      expect(result.statusListIndex).toBe(42);
    });

    it('should attempt compensating revocation when DB save fails after successful issuance', async () => {
      jest.spyOn(vcModel, 'getVCByTenderId').mockResolvedValue(null);
      jest.spyOn(vcModel, 'createPendingVC').mockResolvedValue({
        id: 'db-vc-id',
        credential_id: 'PENDING-TENDER-TEST-1-1234'
      });
      jest.spyOn(service, 'getAccessToken').mockResolvedValue('mock-token');
      jest.spyOn(service, 'getNonce').mockResolvedValue('test-nonce');

      // API succeeds
      clientPostSpy.mockResolvedValueOnce({ data: validApiCredential });

      // DB allocation fails after API success
      jest.spyOn(vcModel, 'allocateStatusListIndex').mockRejectedValue(new Error('DB connection lost'));

      // Spy on revokeCredential to verify compensating call
      const revokeSpy = jest.spyOn(service, 'revokeCredential').mockResolvedValue({ success: true });

      await expect(service.issueCredential(mockTender, mockOfficer))
        .rejects.toThrow(CertifyNetworkError);

      // Verify compensating revocation was attempted
      expect(revokeSpy).toHaveBeenCalledWith(
        'urn:uuid:real-vc-id',
        'ADMINISTRATIVE_ERROR',
        null,
        null
      );
    });

    it('should throw CertifyValidationError if response is malformed', async () => {
      jest.spyOn(vcModel, 'getVCByTenderId').mockResolvedValue(null);
      jest.spyOn(vcModel, 'createPendingVC').mockResolvedValue({ id: 'db-vc-id' });
      jest.spyOn(service, 'getAccessToken').mockResolvedValue('mock-token');
      jest.spyOn(service, 'getNonce').mockResolvedValue('test-nonce');

      // Missing proof and credentialStatus
      clientPostSpy.mockResolvedValueOnce({
        data: { credentialSubject: {} }
      });

      await expect(service.issueCredential(mockTender, mockOfficer))
        .rejects.toThrow(CertifyValidationError);
    });
  });

  // ───────────────────────────────────────────────
  // Error classes
  // ───────────────────────────────────────────────
  describe('Error classes', () => {
    it('CertifyNetworkError should have isRetryable = true', () => {
      const err = new CertifyNetworkError('test');
      expect(err.isRetryable).toBe(true);
      expect(err.name).toBe('CertifyNetworkError');
    });

    it('CertifyAuthError should have isRetryable = false', () => {
      const err = new CertifyAuthError('test');
      expect(err.isRetryable).toBe(false);
    });

    it('CertifyValidationError should have isRetryable = false', () => {
      const err = new CertifyValidationError('test');
      expect(err.isRetryable).toBe(false);
    });

    it('CertifyRevocationError should have isRetryable = true', () => {
      const err = new CertifyRevocationError('test');
      expect(err.isRetryable).toBe(true);
    });
  });
});
