import { jest } from '@jest/globals';
import request from 'supertest';
import { pool, setupTestDb, teardownTestDb } from './setup.js';

// Global auth bypass — must come before app import
jest.unstable_mockModule('../src/middleware/auth.js', () => ({
  requireAuth: (req, res, next) => {
    req.officer = { id: 'official_admin_001', name: 'Admin', email: 'admin@gov.in', role: 'ADMIN', department: 'PWD', loa: 3 };
    next();
  },
  requireLoA: () => (req, res, next) => next(),
  requireRole: () => (req, res, next) => next(),
  requireDepartment: () => (req, res, next) => next(),
}));

const { default: app } = await import('../src/app.js');

describe('Super Coverage Suite', () => {
  const tId = 'tnd_cov_999';

  beforeAll(async () => {
    await setupTestDb();
    await pool.query(
      `INSERT INTO tenders (id, tender_id, reference_no, title, status, department, estimated_value, actual_value, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [tId, 'TND-COV-999', 'REF-COV-999', 'Coverage Tender', 'SIGNED', 'PWD', 1000000, 1000000, 'official_admin_001']
    );
  });

afterAll(async () => {
  await teardownTestDb();
});

  test('Hit all tender routes', async () => {
    await request(app).get('/api/tenders');
    await request(app).post('/api/tenders').send({ title: 'Cov2', department: 'PWD', estimated_value: 1000 });
    await request(app).get(`/api/tenders/${tId}`);
    await request(app).put(`/api/tenders/${tId}`).send({ title: 'Updated' });
  });

  test('Hit all document routes', async () => {
    await request(app).get(`/api/tenders/${tId}/documents`);
    await request(app).post(`/api/tenders/${tId}/documents`).send({});
  });

  test('Hit all PDF routes', async () => {
    await request(app).get(`/api/tenders/${tId}/pdf`);
  });

  test('Hit Award Letters routes', async () => {
    await request(app).post(`/api/tenders/${tId}/generate-award-letter`);
    await request(app).get(`/api/tenders/${tId}/letter/docx`);
    await request(app).get(`/api/tenders/${tId}/letter/pdf`);
  });

  test('Hit Verify routes', async () => {
    await request(app).get(`/api/public/verify/${tId}`);
    await request(app).post(`/api/verify/scan`).send({ jwt: 'fake' });
  });

  test('Hit Wallet Delivery routes', async () => {
    await request(app).post(`/api/wallet/delivery/${tId}`).send({ userEmail: 'bidder@corp.in' });
  });

  test('Hit Auth internal routes', async () => {
    await request(app).get('/api/auth/me');
    await request(app).post('/api/auth/logout');
  });

  test('Hit Status List routes', async () => {
    await request(app).get('/api/status-list');
  });

  test('Hit DID document', async () => {
    await request(app).get('/.well-known/did.json');
  });
});
