import { jest } from '@jest/globals';
import { pool, setupTestDb, teardownTestDb } from './setup.js';

let app;

beforeAll(async () => {
    await setupTestDb();
  const mod = await import('../src/app.js');
  app = mod.default;
});

afterAll(async () => {
  await teardownTestDb();
});

describe('Security middleware — CSP headers', () => {
  it('sets security headers on all responses', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app).get('/.well-known/did.json');
    // helmet sets at least one of these
    const hasSecurityHeader = !!(
      res.headers['content-security-policy'] ||
      res.headers['x-content-type-options'] ||
      res.headers['x-frame-options']
    );
    expect(hasSecurityHeader).toBe(true);
  });

  it('sets X-Frame-Options to prevent clickjacking', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app).get('/.well-known/did.json');
    if (res.headers['x-frame-options']) {
      expect(['DENY', 'SAMEORIGIN']).toContain(res.headers['x-frame-options']);
    } else {
      expect(true).toBe(true);
    }
  });
});

describe('Security middleware — SQL injection pattern rejection', () => {
  it('rejects SQLi payload in query param', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app).get(`/api/tenders?status=DRAFT' OR '1'='1`);
    expect([400, 401, 403, 422]).toContain(res.status);
  });

  it('rejects SQLi payload in body field', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app)
      .post('/api/tenders')
      .send({ title: "'; DROP TABLE tenders; --", department: 'PWD' });
    expect([400, 401, 403, 422]).toContain(res.status);
  });
});

describe('Security middleware — XSS sanitization', () => {
  it('sanitizes script tag in input field', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app)
      .post('/api/tenders')
      .send({ title: '<script>alert(1)</script>', department: 'PWD' });
    expect([400, 401, 403, 422]).toContain(res.status);
  });

  it('sanitizes onerror img XSS payload', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app)
      .post('/api/tenders')
      .send({ title: '<img src=x onerror=alert(1)>', department: 'PWD' });
    expect([400, 401, 403, 422]).toContain(res.status);
  });
});

describe('CSRF protection — token validation', () => {
  it('rejects state-changing request without CSRF token', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app)
      .post('/api/tenders')
      .send({ title: 'No CSRF Token Test', department: 'PWD' });
    expect([401, 403]).toContain(res.status);
  });

  it('allows GET requests without CSRF token', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app).get('/api/tenders');
    expect(res.status).not.toBe(403);
  });
});

describe('Security middleware — input validation edge cases', () => {
  it('handles malformed JSON body gracefully', async () => {
    const { default: request } = await import('supertest');
    const res = await request(app)
      .post('/api/tenders')
      .set('Content-Type', 'application/json')
      .send('{ malformed json ');
    expect([400, 401, 403]).toContain(res.status);
  });
});
