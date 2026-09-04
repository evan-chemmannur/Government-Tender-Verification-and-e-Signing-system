import { jwtVerify } from 'jose';
import crypto from 'crypto';
import { createClient } from 'redis';
import { generatePKCE as cryptoGeneratePKCE, loadPrivateKey, signJWT } from '../utils/crypto.js';
import { jwksService } from './jwksCache.js';

// Setup optional Redis client for JTI replay prevention with in-memory fallback
const inMemoryJti = new Set();
let redisClient = null;

if (process.env.REDIS_URL) {
  redisClient = createClient({
    url: process.env.REDIS_URL
  });
  redisClient.on('error', (err) => console.error('Redis Client Error', err));
  redisClient.connect().catch((err) => console.error('Redis Connect Error', err.message));
}

export const authService = {
  /**
   * Generates PKCE pair
   */
  generatePKCE() {
    return cryptoGeneratePKCE();
  },

  /**
   * Builds the full authorization URL to eSignet
   */
  buildAuthorizationURL({ acr_values, state, nonce, codeChallenge, loginHint }) {
    const baseUrl = process.env.ESIGNET_BASE_URL || 'https://esignet.mosip.net';
    const clientId = process.env.CLIENT_ID || 'tender-portal-client';
    const redirectUri = process.env.REDIRECT_URI || 'http://localhost:3001/auth/callback';

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'openid profile',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      acr_values,
    });

    if (loginHint) {
      params.append('login_hint', loginHint);
    }

    // Add specific auth method requirement for eSignet
    params.append('auth_type', acr_values === 'LOA_3_BIOMETRIC' ? 'bio' : 'otp');

    return `${baseUrl}/authorize?${params.toString()}`;
  },

  /**
   * Exchanges authorization code for tokens using private_key_jwt
   */
  async exchangeCodeForTokens(code, codeVerifier) {
    const baseUrl = process.env.ESIGNET_BASE_URL || 'https://esignet.mosip.net';
    const tokenEndpoint = `${baseUrl}/oauth/token`;
    const clientId = process.env.CLIENT_ID || 'tender-portal-client';
    const redirectUri = process.env.REDIRECT_URI || 'http://localhost:3001/auth/callback';

    try {
      const privateKey = await loadPrivateKey();
      const jti = crypto.randomUUID();

      const clientAssertion = await signJWT({}, privateKey, {
        issuer: clientId,
        subject: clientId,
        audience: tokenEndpoint,
        jwtid: jti,
        expirationTime: '2m' // max 5 mins per RFC 7523
      });

      const params = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
        client_assertion: clientAssertion,
        code_verifier: codeVerifier
      });

      const response = await fetch(tokenEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
      });

      const data = await response.json();

      if (!response.ok) {
        if (data.error === 'invalid_grant') {
          throw new Error('INVALID_CODE');
        }
        throw new Error('TOKEN_ENDPOINT_ERROR');
      }

      console.log(`Token exchange successful for sub: ${data.id_token.substring(0, 8)}...`);

      return {
        access_token: data.access_token,
        id_token: data.id_token,
        token_type: data.token_type
      };
    } catch (error) {
      if (error.message === 'INVALID_CODE' || error.message === 'TOKEN_ENDPOINT_ERROR') {
        throw error;
      }
      throw new Error('NETWORK_ERROR');
    }
  },

  /**
   * Validates the ID token signature, claims, and prevents replay
   */
  async validateIdToken(idToken, expectedNonce) {
    const baseUrl = process.env.ESIGNET_BASE_URL || 'https://esignet.mosip.net';
    const clientId = process.env.CLIENT_ID || 'tender-portal-client';
    const jwksUri = process.env.ESIGNET_JWKS_URI || `${baseUrl}/.well-known/jwks.json`;

    try {
      const JWKS = jwksService.getSigningKey();

      const { payload } = await jwtVerify(idToken, JWKS, {
        issuer: baseUrl,
        audience: clientId,
        clockTolerance: 30 // 30s tolerance for iat/exp
      });

      if (payload.nonce !== expectedNonce) {
        throw new Error('INVALID_CLAIMS'); // Wrong nonce
      }

      // Replay prevention using JTI
      if (payload.jti) {
        const ttl = payload.exp ? Math.max(1, payload.exp - Math.floor(Date.now() / 1000)) : 3600;
        if (redisClient && redisClient.isOpen) {
          const isReplayed = await redisClient.get(`jti:${payload.jti}`);
          if (isReplayed) {
            throw new Error('INVALID_CLAIMS'); // Token already used
          }
          await redisClient.setEx(`jti:${payload.jti}`, ttl, 'used');
        } else {
          if (inMemoryJti.has(payload.jti)) {
            throw new Error('INVALID_CLAIMS');
          }
          inMemoryJti.add(payload.jti);
          setTimeout(() => inMemoryJti.delete(payload.jti), ttl * 1000);
        }
      }

      return payload;
    } catch (error) {
      if (error.code === 'ERR_JWT_EXPIRED') {
        throw new Error('EXPIRED_TOKEN');
      }
      if (error.code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED') {
        throw new Error('INVALID_SIGNATURE');
      }
      if (error.code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' || error.message === 'INVALID_CLAIMS') {
        throw new Error('INVALID_CLAIMS');
      }
      throw error;
    }
  },

  /**
   * Upserts the official into the database using sub claim
   */
  async getOrCreateOfficer(claims, db) {
    // Determine LoA matching our ENUM based on claims
    let loa_level = 'LOA_2_OTP';
    if (claims.acr === 'LOA_3_BIOMETRIC' || claims.acr === 'bio') {
      loa_level = 'LOA_3_BIOMETRIC';
    }

    const { rows } = await db.query(`
      INSERT INTO officials (
        aadhaar_sub, 
        name, 
        loa_level,
        last_login_at,
        is_active
      ) VALUES ($1, $2, $3, NOW(), true)
      ON CONFLICT (aadhaar_sub) DO UPDATE SET
        name = EXCLUDED.name,
        loa_level = EXCLUDED.loa_level,
        last_login_at = EXCLUDED.last_login_at,
        updated_at = NOW()
      RETURNING *;
    `, [
      claims.sub,
      claims.name || `${claims.given_name || ''} ${claims.family_name || ''}`.trim(),
      loa_level
    ]);

    return rows[0];
  }
};
