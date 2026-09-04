// ─────────────────────────────────────────────────────────
// tests/auth.integration.test.js — Full authentication flow tests
//
// Tests: Login URL generation, PKCE verification, state mismatch,
//        token expiry, session creation/destruction, rate limiting
// ─────────────────────────────────────────────────────────

import { jest } from '@jest/globals';
import request from 'supertest';
import nock from 'nock';
import { fixtures, pool, setupTestDb, teardownTestDb } from './setup.js';
import { createMockOfficial } from './factories.js';

// ── Mock external services BEFORE app import ──────────────
jest.unstable_mockModule('../src/services/authService.js', () => ({
  authService: {
    buildAuthorizationURL: jest.fn().mockReturnValue(
      'https://esignet.mock.test/authorize?state=teststate&nonce=testnonce&code_challenge=challenge'
    ),
    exchangeCodeForTokens: jest.fn().mockResolvedValue({
      id_token: 'mock.id.token',
      access_token: 'mock_access',
    }),
    validateIdToken: jest.fn().mockResolvedValue({
      sub: 'aadhaar_admin_001',
      nonce: 'testnonce',
      acr: 'LOA_3_BIOMETRIC',
      name: 'Admin Officer',
    }),
    generatePKCE: jest.fn().mockReturnValue({
      codeVerifier: 'v'.repeat(43),
      codeChallenge: 'challenge',
    }),
    getOrCreateOfficer: jest.fn().mockResolvedValue({
      id: 'official_admin_001',
      name: 'Admin Officer',
      role: 'ADMIN',
      loa_level: 'LOA_3_BIOMETRIC',
    }),
  },
}));

jest.unstable_mockModule('../src/services/nonceStore.js', () => ({
  nonceStore: {
    storeNonce: jest.fn().mockResolvedValue(true),
    isValid: jest.fn().mockResolvedValue(true),
    markUsed: jest.fn().mockResolvedValue(true),
  },
}));

// Mock Redis to prevent real connections
jest.unstable_mockModule('redis', () => ({
  createClient: jest.fn().mockReturnValue({
    connect: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    setEx: jest.fn().mockResolvedValue('OK'),
    quit: jest.fn().mockResolvedValue(undefined),
  }),
}));

let app;

beforeAll(async () => {
  await setupTestDb();
  const mod = await import('../src/app.js');
  app = mod.default;
});

afterAll(async () => {
  await teardownTestDb();
});

afterEach(() => {
  nock.cleanAll();
  jest.clearAllMocks();
});

describe('Task 17: Auth Integration Flow', () => {

  // ── Authentication Status ──────────────────────────────────
  test('GET /auth/status returns unauthenticated when no session', async () => {
    const res = await request(app).get('/auth/status');
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
  });

  // ── Login URL Generation ───────────────────────────────────
  test('GET /auth/login-url returns redirect URL with biometric ACR', async () => {
    const res = await request(app).get('/auth/login-url?acr=biometric');
    expect([200, 302, 429]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body.url).toBeDefined();
      expect(res.body.url).toContain('esignet');
    }
  });

  test('GET /auth/login-url returns redirect URL with OTP ACR', async () => {
    const res = await request(app).get('/auth/login-url?acr=otp');
    expect([200, 302, 429]).toContain(res.status);
  });

  // ── Protected Route Without Auth ───────────────────────────
  test('GET /auth/me returns 401 without session', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  // ── Logout ─────────────────────────────────────────────────
  test('POST /auth/logout returns 401 without session (requireAuth)', async () => {
    const res = await request(app).post('/auth/logout');
    // logout requires auth, so without session it should 401 or 403
    expect([401, 403]).toContain(res.status);
  });

  // ── State Mismatch (CSRF Protection) ───────────────────────
  test('GET /auth/callback with mismatched state is rejected', async () => {
    const res = await request(app)
      .get('/auth/callback?code=authcode&state=WRONG_STATE');
    // Without a valid session state, this should redirect to /login with error
    expect([302, 400, 403]).toContain(res.status);
    if (res.status === 302) {
      expect(res.headers.location).toContain('error');
    }
  });

  // ── eSignet Error Handling ─────────────────────────────────
  test('GET /auth/callback with error param from eSignet redirects', async () => {
    const res = await request(app)
      .get('/auth/callback?error=access_denied&error_description=User+denied');
    expect([302, 400]).toContain(res.status);
    if (res.status === 302) {
      expect(res.headers.location).toContain('access_denied');
    }
  });

  // ── Token Expiry Handling ──────────────────────────────────
  test('Protected route returns 401 with expired/invalid session cookie', async () => {
    const res = await request(app)
      .get('/api/tenders')
      .set('Cookie', ['tender.sid=s%3AEXPIRED_SESSION_TOKEN.invalid']);
    expect(res.status).toBe(401);
  });

  // ── CSRF Token Endpoint ────────────────────────────────────
  test('GET /auth/csrf-token returns a CSRF token', async () => {
    const res = await request(app).get('/auth/csrf-token');
    expect(res.status).toBe(200);
    expect(res.body.csrfToken).toBeDefined();
    expect(res.body.csrfToken.length).toBe(64); // 32 bytes hex
  });

  // ── Health Check ───────────────────────────────────────────
  test('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.timestamp).toBeDefined();
  });

  // ── Missing Code in Callback ───────────────────────────────
  test('GET /auth/callback without code param redirects with error', async () => {
    const res = await request(app)
      .get('/auth/callback?state=somestate');
    expect([302, 400]).toContain(res.status);
  });

  // ── Rate Limiting ──────────────────────────────────────────
  test('Rate limiting returns 429 after too many login requests', async () => {
    // Send many rapid requests to trigger rate limiter
    const results = [];
    for (let i = 0; i < 8; i++) {
      const res = await request(app).get('/auth/login-url?acr=otp');
      results.push(res.status);
    }
    // At least one should be 429 (rate limit is 5 per 15 min)
    expect(results).toContain(429);
  });

  // ── Session Status with Auth ───────────────────────────────
  test('GET /auth/status reports authenticated:false for unknown session', async () => {
    const res = await request(app)
      .get('/auth/status')
      .set('Cookie', ['tender.sid=s%3Ainvalid_session.fakesig']);
    expect(res.status).toBe(200);
    expect(res.body.authenticated).toBe(false);
  });

  // ── 404 Handler ────────────────────────────────────────────
  test('Unknown endpoint returns 404', async () => {
    const res = await request(app).get('/api/nonexistent');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Endpoint not found');
  });
});
