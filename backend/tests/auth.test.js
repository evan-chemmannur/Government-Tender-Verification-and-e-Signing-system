import express from 'express';
import session from 'express-session';
import request from 'supertest';
import { jest } from '@jest/globals';
import crypto from 'crypto';

// Setup environment before importing code that reads it
process.env.ESIGNET_BASE_URL = 'https://esignet.mosip.net';
process.env.CLIENT_ID = 'test-client';
process.env.REDIRECT_URI = 'http://localhost:3001/auth/callback';
process.env.PRIVATE_KEY_PATH = './fake-key.pem';

// Mocks
jest.unstable_mockModule('redis', () => ({
  createClient: jest.fn(() => ({
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(),
    get: jest.fn().mockResolvedValue(null),
    setEx: jest.fn().mockResolvedValue('OK')
  }))
}));

jest.unstable_mockModule('../src/config/database.js', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ 
      rows: [{ id: '123', name: 'Test Officer', loa_level: 'LOA_3_BIOMETRIC', role: 'OFFICER' }],
      rowCount: 1
    })
  }
}));

jest.unstable_mockModule('fs/promises', () => ({
  default: {
    readFile: jest.fn().mockResolvedValue('fake-pem-content')
  }
}));

jest.unstable_mockModule('jose', () => ({
  importPKCS8: jest.fn().mockResolvedValue('fake-key'),
  SignJWT: class {
    setProtectedHeader() { return this; }
    setIssuer() { return this; }
    setAudience() { return this; }
    setSubject() { return this; }
    setJti() { return this; }
    setIssuedAt() { return this; }
    setExpirationTime() { return this; }
    sign() { return Promise.resolve('fake-client-assertion'); }
  },
  createRemoteJWKSet: jest.fn().mockReturnValue('fake-jwks'),
  jwtVerify: jest.fn()
}));

// Mock global fetch for token exchange
global.fetch = jest.fn();

// Import the modules after mocking
const { authService } = await import('../src/services/authService.js');
const { requireAuth, requireLoA } = await import('../src/middleware/auth.js');
const authRouter = (await import('../src/routes/auth.js')).default;
const { jwtVerify } = await import('jose');

describe('Auth System', () => {

  describe('authService.js', () => {
    
    it('generatePKCE returns correct format', () => {
      const { codeVerifier, codeChallenge } = authService.generatePKCE();
      expect(typeof codeVerifier).toBe('string');
      expect(typeof codeChallenge).toBe('string');
      expect(codeVerifier.length).toBeGreaterThanOrEqual(43); // RFC 7636
    });

    it('buildAuthorizationURL contains all required params', () => {
      const url = authService.buildAuthorizationURL({
        acr_values: 'LOA_3_BIOMETRIC',
        state: 'test-state',
        nonce: 'test-nonce',
        codeChallenge: 'test-challenge'
      });
      const parsed = new URL(url);
      expect(parsed.searchParams.get('client_id')).toBe('test-client');
      expect(parsed.searchParams.get('state')).toBe('test-state');
      expect(parsed.searchParams.get('nonce')).toBe('test-nonce');
      expect(parsed.searchParams.get('code_challenge')).toBe('test-challenge');
      expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
      expect(parsed.searchParams.get('acr_values')).toBe('LOA_3_BIOMETRIC');
      expect(parsed.searchParams.get('auth_type')).toBe('bio');
    });

    it('validateIdToken throws on invalid signature', async () => {
      jwtVerify.mockRejectedValueOnce({ code: 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED' });
      await expect(authService.validateIdToken('fake-token', 'nonce'))
        .rejects.toThrow('INVALID_SIGNATURE');
    });

    it('validateIdToken throws on expired token', async () => {
      jwtVerify.mockRejectedValueOnce({ code: 'ERR_JWT_EXPIRED' });
      await expect(authService.validateIdToken('fake-token', 'nonce'))
        .rejects.toThrow('EXPIRED_TOKEN');
    });

    it('validateIdToken throws on wrong nonce', async () => {
      jwtVerify.mockResolvedValueOnce({ payload: { nonce: 'wrong-nonce' } });
      await expect(authService.validateIdToken('fake-token', 'expected-nonce'))
        .rejects.toThrow('INVALID_CLAIMS');
    });
  });

  describe('Middleware (auth.js)', () => {
    it('requireAuth returns 401 for unauthenticated request', () => {
      const req = { session: {} };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      requireAuth(req, res, next);
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Not authenticated' }));
      expect(next).not.toHaveBeenCalled();
    });

    it('requireLoA returns 403 when LoA insufficient', () => {
      const req = { officer: { loa: 'LOA_2_OTP' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      const middleware = requireLoA('loa3');
      middleware(req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Insufficient authentication level' }));
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe('Routes (auth.js)', () => {
    let app;

    beforeEach(() => {
      app = express();
      app.use(session({
        secret: 'test-secret',
        resave: false,
        saveUninitialized: true
      }));
      app.use('/auth', authRouter);
      jest.clearAllMocks();
    });

    it('Callback route rejects mismatched state', async () => {
      // Create an agent to maintain session state across requests
      const agent = request.agent(app);
      
      // Step 1: Hit login to setup session
      await agent.get('/auth/login?acr=otp');

      // Step 2: Hit callback with wrong state
      const response = await agent.get('/auth/callback?code=123&state=wrong-state');
      
      expect(response.status).toBe(302);
      expect(response.headers.location).toBe('/login?error=invalid_state');
    });

    it('Callback route creates session on success', async () => {
      const agent = request.agent(app);

      // Setup session via login
      const loginRes = await agent.get('/auth/login?acr=otp');
      const authUrl = new URL(loginRes.headers.location);
      const state = authUrl.searchParams.get('state');
      const nonce = authUrl.searchParams.get('nonce');

      // Mock exchange logic
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'ac123', id_token: 'id123', token_type: 'Bearer' })
      });

      // Mock jwtVerify success
      jwtVerify.mockResolvedValueOnce({
        payload: {
          sub: 'test-sub',
          nonce: nonce,
          acr: 'LOA_2_OTP'
        }
      });

      // Execute callback
      const callbackRes = await agent.get(`/auth/callback?code=valid_code&state=${state}`);

      expect(callbackRes.status).toBe(302);
      expect(callbackRes.headers.location).toBe('/dashboard');

      // Verify the me endpoint recognizes the session
      const meRes = await agent.get('/auth/me');
      expect(meRes.status).toBe(200);
      expect(meRes.body.name).toBe('Test Officer');
    });
  });
});
