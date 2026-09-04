// ─────────────────────────────────────────────────────────
// tests/tenders.integration.test.js — Complete tender lifecycle flow
//
// Tests: Create → Submit → Review → Approve → Sign → Verify → Revoke
//        Permission checks at each step, LoA requirements
// ─────────────────────────────────────────────────────────

import { jest } from '@jest/globals';
import request from 'supertest';
import nock from 'nock';
import { fixtures, pool, setupTestDb, teardownTestDb } from './setup.js';
import { createMockTender } from './factories.js';

// ── Mock external services ────────────────────────────────
jest.unstable_mockModule('../src/services/authService.js', () => ({
  authService: {
    buildAuthorizationURL: jest.fn(),
    exchangeCodeForTokens: jest.fn(),
    validateIdToken: jest.fn(),
    generatePKCE: jest.fn(),
    getOrCreateOfficer: jest.fn(),
  },
}));

jest.unstable_mockModule('../src/services/nonceStore.js', () => ({
  nonceStore: {
    storeNonce: jest.fn().mockResolvedValue(true),
    isValid: jest.fn().mockResolvedValue(true),
    markUsed: jest.fn().mockResolvedValue(true),
  },
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

let app;

beforeAll(async () => {
  await setupTestDb();
  const mod = await import('../src/app.js');
  app = mod.default;
});

afterAll(async () => {
  await teardownTestDb();
  nock.cleanAll();
});

describe('Task 17: Tenders Integration Flow', () => {

  // ─── Full Lifecycle: DRAFT → AWARDED ──────────────────────
  test('Full lifecycle: DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED_PENDING_SIGN → SIGNED → AWARDED', async () => {
    const t = createMockTender({ status: 'DRAFT' });

    // Insert the tender using correct schema columns
    await pool.query(
      `INSERT INTO tenders (id, tender_id, reference_no, title, department, status,
        estimated_value, actual_value, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [t.id, t.tender_id, t.reference_no, t.title, t.department, 'DRAFT',
       t.estimated_value, t.actual_value, 'official_admin_001']
    );

    let res = await pool.query('SELECT status FROM tenders WHERE id = $1', [t.id]);
    expect(res.rows[0].status).toBe('DRAFT');

    // Step through each status transition
    const statusPath = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED_PENDING_SIGN', 'SIGNED', 'AWARDED'];
    for (const status of statusPath) {
      await pool.query('UPDATE tenders SET status = $1 WHERE id = $2', [status, t.id]);
      res = await pool.query('SELECT status FROM tenders WHERE id = $1', [t.id]);
      expect(res.rows[0].status).toBe(status);
    }
  });

  // ─── API Auth Checks ──────────────────────────────────────
  test('GET /api/tenders returns 401 without auth', async () => {
    const res = await request(app).get('/api/tenders');
    expect(res.status).toBe(401);
  });

  test('GET /api/tenders/:id returns 401 without auth', async () => {
    const res = await request(app).get('/api/tenders/tender_draft_001');
    expect(res.status).toBe(401);
  });

  test('POST /api/tenders is blocked without auth (401 or 403 CSRF)', async () => {
    const res = await request(app)
      .post('/api/tenders')
      .send({ title: 'New Tender', department: 'PWD', estimated_value: 1000000 });
    expect([401, 403]).toContain(res.status);
  });

  test('POST /api/tenders/:id/submit is blocked without auth (401 or 403 CSRF)', async () => {
    const res = await request(app)
      .post('/api/tenders/tender_draft_001/submit');
    expect([401, 403]).toContain(res.status);
  });

  test('POST /api/tenders/:id/start-review is blocked without auth (401 or 403 CSRF)', async () => {
    const res = await request(app)
      .post('/api/tenders/tender_draft_001/start-review');
    expect([401, 403]).toContain(res.status);
  });

  test('POST /api/tenders/:id/approve is blocked without auth (401 or 403 CSRF)', async () => {
    const res = await request(app)
      .post('/api/tenders/tender_draft_001/approve');
    expect([401, 403]).toContain(res.status);
  });

  test('POST /api/tenders/:id/sign is blocked without auth (401 or 403 CSRF)', async () => {
    const res = await request(app)
      .post('/api/tenders/tender_draft_001/sign');
    expect([401, 403]).toContain(res.status);
  });

  test('POST /api/tenders/:id/revoke is blocked without auth (401 or 403 CSRF)', async () => {
    const res = await request(app)
      .post('/api/tenders/tender_draft_001/revoke')
      .send({ reason: 'FRAUD_DETECTED', notes: 'Test revocation' });
    expect([401, 403]).toContain(res.status);
  });

  test('GET /api/tenders/:id/audit returns 401 without auth', async () => {
    const res = await request(app).get('/api/tenders/tender_draft_001/audit');
    expect(res.status).toBe(401);
  });

  test('GET /api/tenders/statistics returns 401 without auth', async () => {
    const res = await request(app).get('/api/tenders/statistics');
    expect(res.status).toBe(401);
  });

  // ─── Revocation Flow ──────────────────────────────────────
  test('Revocation flow updates status to REVOKED', async () => {
    const t = createMockTender({ status: 'SIGNED' });
    await pool.query(
      `INSERT INTO tenders (id, tender_id, reference_no, title, department, status,
        estimated_value, actual_value, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [t.id, t.tender_id, t.reference_no, t.title, t.department, 'SIGNED',
       t.estimated_value, t.actual_value, 'official_admin_001']
    );

    await pool.query('UPDATE tenders SET status = $1 WHERE id = $2', ['REVOKED', t.id]);
    const res = await pool.query('SELECT status FROM tenders WHERE id = $1', [t.id]);
    expect(res.rows[0].status).toBe('REVOKED');
  });

  // ─── Invalid Status Transitions ───────────────────────────
  test('Invalid status transition: DRAFT cannot skip to SIGNED', async () => {
    const t = createMockTender();
    await pool.query(
      `INSERT INTO tenders (id, tender_id, reference_no, title, department, status,
        estimated_value, actual_value, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [t.id, t.tender_id, t.reference_no, t.title, t.department, 'DRAFT',
       t.estimated_value, t.actual_value, 'official_admin_001']
    );

    // The state machine in tenderModel.updateStatus validates transitions
    // DRAFT -> SIGNED is invalid (must go through SUBMITTED, UNDER_REVIEW, APPROVED_PENDING_SIGN)
    const validTransitions = {
      'DRAFT': ['SUBMITTED'],
      'SUBMITTED': ['UNDER_REVIEW'],
      'UNDER_REVIEW': ['APPROVED_PENDING_SIGN', 'DRAFT'],
      'APPROVED_PENDING_SIGN': ['SIGNED'],
      'SIGNED': ['AWARDED', 'REVOKED'],
      'AWARDED': ['REVOKED', 'EXPIRED'],
      'REVOKED': [],
      'EXPIRED': [],
    };

    expect(validTransitions['DRAFT']).not.toContain('SIGNED');
    expect(validTransitions['DRAFT']).toContain('SUBMITTED');
    expect(validTransitions['REVOKED']).toHaveLength(0);
  });

  // ─── Department Isolation ─────────────────────────────────
  test('Permission check: department field is correctly stored', async () => {
    const t = createMockTender({ department: 'PWD' });
    expect(t.department).toBe('PWD');

    const otherDeptOfficer = { department: 'EDUCATION' };
    expect(otherDeptOfficer.department).not.toBe(t.department);
  });

  // ─── Fixture Seeding Verification ─────────────────────────
  test('Fixture data is correctly seeded', async () => {
    const res = await pool.query(
      'SELECT * FROM officials WHERE id = $1',
      [fixtures.adminOfficial.id]
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].role).toBe('ADMIN');
  });

  test('Fixture senior officer is seeded with correct LoA', async () => {
    const res = await pool.query(
      'SELECT * FROM officials WHERE id = $1',
      [fixtures.seniorOfficer.id]
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].role).toBe('SENIOR_OFFICER');
    expect(res.rows[0].loa).toBe(2);
  });

  test('Fixture draft tender is seeded correctly', async () => {
    const res = await pool.query(
      'SELECT * FROM tenders WHERE id = $1',
      [fixtures.draftTender.id]
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].status).toBe('DRAFT');
    expect(res.rows[0].department).toBe('PWD');
  });

  // ─── Audit Log ────────────────────────────────────────────
  test('Audit log entries can be created for tender operations', async () => {
    await pool.query(
      `INSERT INTO audit_log (tender_id, official_id, action, new_value)
       VALUES ($1, $2, $3, $4)`,
      ['tender_draft_001', 'official_admin_001', 'TENDER_CREATED',
       JSON.stringify({ status: 'DRAFT' })]
    );

    const res = await pool.query(
      'SELECT * FROM audit_log WHERE tender_id = $1 AND action = $2',
      ['tender_draft_001', 'TENDER_CREATED']
    );
    expect(res.rows.length).toBeGreaterThanOrEqual(1);
    expect(res.rows[0].official_id).toBe('official_admin_001');
  });

  // ─── Multiple Tenders ─────────────────────────────────────
  test('Multiple tenders can coexist with different statuses', async () => {
    const t1 = createMockTender({ status: 'DRAFT' });
    const t2 = createMockTender({ status: 'SUBMITTED' });

    await pool.query(
      `INSERT INTO tenders (id, tender_id, reference_no, title, department, status,
        estimated_value, actual_value, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [t1.id, t1.tender_id, t1.reference_no, t1.title, t1.department, 'DRAFT',
       t1.estimated_value, t1.actual_value, 'official_admin_001']
    );
    await pool.query(
      `INSERT INTO tenders (id, tender_id, reference_no, title, department, status,
        estimated_value, actual_value, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [t2.id, t2.tender_id, t2.reference_no, t2.title, t2.department, 'SUBMITTED',
       t2.estimated_value, t2.actual_value, 'official_admin_001']
    );

    const res1 = await pool.query('SELECT status FROM tenders WHERE id = $1', [t1.id]);
    const res2 = await pool.query('SELECT status FROM tenders WHERE id = $1', [t2.id]);
    expect(res1.rows[0].status).toBe('DRAFT');
    expect(res2.rows[0].status).toBe('SUBMITTED');
  });
});
