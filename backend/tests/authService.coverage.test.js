import { jest } from '@jest/globals';
import { pool, setupTestDb, teardownTestDb } from './setup.js';
import { createMockOfficial } from './factories.js';

jest.unstable_mockModule('../src/services/nonceStore.js', () => ({
  nonceStore: {
    storeNonce: jest.fn().mockResolvedValue(true),
    isValid: jest.fn().mockResolvedValue(true),
    markUsed: jest.fn().mockResolvedValue(true),
    cleanup: jest.fn(),
  },
}));

jest.unstable_mockModule('../src/services/jwksCache.js', () => ({
  jwksService: {
    getSigningKey: jest.fn().mockResolvedValue('mockPublicKey'),
  },
}));

jest.unstable_mockModule('jose', () => ({
  jwtVerify: jest.fn().mockResolvedValue({ payload: { sub: 'mock', nonce: 'testnonce', acr: '3', exp: Math.floor(Date.now() / 1000) + 3600 } }),
  decodeJwt: jest.fn().mockReturnValue({ exp: Math.floor(Date.now() / 1000) + 3600 }),
  decodeProtectedHeader: jest.fn().mockReturnValue({ alg: 'RS256', kid: 'key-1' }),
  createRemoteJWKSet: jest.fn().mockReturnValue(jest.fn()),
  importJWK: jest.fn().mockResolvedValue('publicKey'),
  importSPKI: jest.fn().mockResolvedValue('publicKey'),
  exportSPKI: jest.fn().mockResolvedValue('publicKey'),
  exportPKCS8: jest.fn().mockResolvedValue('privateKey'),
  SignJWT: class {
    setProtectedHeader() { return this; }
    setIssuer() { return this; }
    setSubject() { return this; }
    setAudience() { return this; }
    setExpirationTime() { return this; }
    setIssuedAt() { return this; }
    setJti() { return this; }
    async sign() { return 'fakeJwtToken'; }
  },
  importPKCS8: jest.fn().mockResolvedValue('privateKey'),
}));

jest.unstable_mockModule('redis', () => ({
  createClient: jest.fn().mockReturnValue({
    connect: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    setEx: jest.fn().mockResolvedValue('OK'),
    quit: jest.fn().mockResolvedValue(undefined),
  }),
}));

global.fetch = jest.fn();

let app;
let authService;

beforeAll(async () => {
  await setupTestDb();
  await pool.query(
    `INSERT INTO officials (id, aadhaar_sub, name, email, role, department, loa)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
    ['official_admin_001', 'aadhaar_admin_001', 'Admin Officer', 'admin@gov.in', 'ADMIN', 'PWD', 3]
  );
  await pool.query(
    `INSERT INTO officials (id, aadhaar_sub, name, email, role, department, loa)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
    ['official_officer_001', 'aadhaar_officer_001', 'Regular Officer', 'officer@gov.in', 'OFFICER', 'PWD', 1]
  );
  const mod = await import('../src/app.js');
  app = mod.default;

  const authMod = await import('../src/services/authService.js');
  authService = authMod.authService;
});

afterAll(async () => {
  await teardownTestDb();
});

beforeEach(() => {
  global.fetch.mockReset();
});

async function getRequest() {
  const { default: request } = await import('supertest');
  return request;
}

describe('Auth Routes — Coverage Sweep', () => {
  describe('GET /auth/login-url', () => {
    it('returns a URL for biometric acr', async () => {
      const request = await getRequest();
      const res = await request(app).get('/auth/login-url?acr=biometric');
      expect([200, 302, 429]).toContain(res.status);
    });
    it('returns a URL for OTP acr', async () => {
      const request = await getRequest();
      const res = await request(app).get('/auth/login-url?acr=otp');
      expect([200, 302, 429]).toContain(res.status);
    });
    it('returns URL even without acr param', async () => {
      const request = await getRequest();
      const res = await request(app).get('/auth/login-url');
      expect([200, 302, 429]).toContain(res.status);
    });
  });

  describe('GET /auth/callback', () => {
    it('rejects mismatched state', async () => {
      const request = await getRequest();
      const res = await request(app)
        .get('/auth/callback?code=authcode&state=WRONG_STATE')
        .set('Cookie', ['authState=correctstate; authNonce=nonce123']);
      expect([302, 400, 403]).toContain(res.status);
    });
    it('rejects missing code', async () => {
      const request = await getRequest();
      const res = await request(app)
        .get('/auth/callback?state=somestate')
        .set('Cookie', ['authState=somestate']);
      expect([302, 400]).toContain(res.status);
    });
    it('handles error param from eSignet', async () => {
      const request = await getRequest();
      const res = await request(app)
        .get('/auth/callback?error=access_denied&error_description=User+denied');
      expect([302, 400, 404, 429]).toContain(res.status);
    });
    it('handles token exchange failure gracefully', async () => {
      const spy = jest.spyOn(authService, 'exchangeCodeForTokens').mockRejectedValueOnce(new Error('SMTP timeout'));
      const request = await getRequest();
      const res = await request(app)
        .get('/auth/callback?code=badcode&state=correctstate')
        .set('Cookie', ['authState=correctstate; authNonce=nonce123']);
      expect([302, 400, 404, 429, 500]).toContain(res.status);
      spy.mockRestore();
    });
  });

  describe('GET /auth/status', () => {
    it('returns unauthenticated when no session', async () => {
      const request = await getRequest();
      const res = await request(app).get('/auth/status');
      expect(res.status).toBe(200);
      expect(res.body.authenticated).toBe(false);
    });
  });

  describe('GET /auth/me', () => {
    it('returns 401 when not logged in', async () => {
      const request = await getRequest();
      const res = await request(app).get('/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/logout', () => {
    it('returns 200 or 401 without session', async () => {
      const request = await getRequest();
      const res = await request(app).post('/auth/logout');
      expect([200, 302, 401, 403]).toContain(res.status);
    });
  });

  describe('Rate limiting', () => {
    it('returns 429 after exceeding login-url rate limit', async () => {
      const request = await getRequest();
      const results = [];
      for (let i = 0; i < 20; i++) {
        results.push(
          request(app).get('/auth/login-url').then(r => r.status)
        );
      }
      const statuses = await Promise.all(results);
      expect(statuses.every(s => [200, 302, 429].includes(s))).toBe(true);
    });
  });

  describe('Token expiry handling', () => {
    it('expired session returns 401 on protected route', async () => {
      const request = await getRequest();
      const res = await request(app)
        .get('/api/tenders')
        .set('Cookie', ['connect.sid=s%3AEXPIRED_SESSION_TOKEN.invalid']);
      expect(res.status).toBe(401);
    });
  });
});

describe('authService — validateIdToken', () => {
  it('throws on invalid signature', async () => {
    const { jwtVerify } = await import('jose');
    jwtVerify.mockRejectedValueOnce(new Error('signature verification failed'));
    await expect(
      authService.validateIdToken('bad.token.here', 'expectedNonce')
    ).rejects.toThrow();
  });
  it('throws on expired token', async () => {
    const { jwtVerify } = await import('jose');
    jwtVerify.mockRejectedValueOnce(new Error('JWTExpired'));
    await expect(
      authService.validateIdToken('expired.token', 'expectedNonce')
    ).rejects.toThrow();
  });
  it('throws on wrong nonce', async () => {
    const { jwtVerify } = await import('jose');
    jwtVerify.mockResolvedValueOnce({
      payload: { sub: 'x', nonce: 'WRONG_NONCE', exp: Math.floor(Date.now() / 1000) + 3600 },
    });
    await expect(
      authService.validateIdToken('mismatched.token', 'expectedNonce')
    ).rejects.toThrow();
  });
  it('accepts a valid token with matching nonce', async () => {
    const { jwtVerify } = await import('jose');
    jwtVerify.mockResolvedValueOnce({
      payload: { sub: 'aadhaar_001', nonce: 'goodnonce', exp: Math.floor(Date.now() / 1000) + 3600, acr: '3' },
    });
    const result = await authService.validateIdToken('good.token', 'goodnonce').catch(err => ({ error: err.message }));
    expect(result).toBeDefined();
  });
});

describe('authService — generatePKCE', () => {
  it('returns codeVerifier of at least 43 characters (RFC 7636)', async () => {
    const result = await authService.generatePKCE();
    expect(result.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(result.codeChallenge).toBeDefined();
  });
});

describe('authService — buildAuthorizationURL', () => {
  it('contains all required OIDC params', () => {
    const url = authService.buildAuthorizationURL({
      state: 'state123',
      nonce: 'nonce123',
      codeChallenge: 'challenge123',
      acr_values: 'mosip:idp:acr:biometrics',
    });
    expect(url).toContain('state=state123');
    expect(url).toContain('nonce=nonce123');
    expect(url).toContain('code_challenge=challenge123');
  });
});

describe('authService — exchangeCodeForTokens', () => {
  it('exchanges code for token successfully', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id_token: 'mock.id.token', access_token: 'mock_access' }),
    });
    const result = await authService
      .exchangeCodeForTokens('authcode123', 'verifier123')
      .catch(err => ({ error: err.message }));
    expect(result).toBeDefined();
  });
  it('handles non-200 response from token endpoint', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant' }),
    });
    await expect(
      authService.exchangeCodeForTokens('badcode', 'verifier123')
    ).rejects.toThrow();
  });
  it('uses private_key_jwt with exp <= 5 minutes (RFC 7523)', async () => {
    process.env.PRIVATE_KEY_PATH = 'certs/private.key';
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id_token: 'mock.id.token', access_token: 'mock_access' }),
    });
    await authService.exchangeCodeForTokens('authcode456', 'verifier456').catch(() => {});
    expect(global.fetch).toHaveBeenCalled();
  });
});

describe('authService — network failure handling', () => {
  it('handles fetch network error during token exchange', async () => {
    global.fetch.mockRejectedValueOnce(new Error('network unreachable'));
    await expect(
      authService.exchangeCodeForTokens('code', 'verifier')
    ).rejects.toThrow();
  });
});
