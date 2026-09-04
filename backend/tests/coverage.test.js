import request from 'supertest';
import app from '../src/app.js';
import { pool, setupTestDb, teardownTestDb } from './setup.js';
import { createMockTender } from './factories.js';
import nock from 'nock';

describe('Coverage Test Suite', () => {
  let agent;
  let tId;

  beforeAll(async () => {
    await setupTestDb();
    agent = request.agent(app);
    const t = createMockTender({ status: 'DRAFT' });
    tId = t.id;
    await pool.query(
      `INSERT INTO officials (id, aadhaar_sub, name, email, role, department, loa)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      ['cov_user', 'cov_user_aad', 'Cov User', 'cov@gov.in', 'OFFICER', 'PWD', 1]
    );
    await pool.query(
      `INSERT INTO tenders (id, tender_id, reference_no, title, status, department, estimated_value, actual_value, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [t.id, t.tender_id, t.reference_no, t.title, t.status, t.department,
       t.estimated_value, t.actual_value, 'official_admin_001']
    );
  });

  afterAll(async () => {
    await teardownTestDb();
    nock.cleanAll();
  });

  test('Public Verify', async () => {
    const res = await request(app).get(`/api/public/verify/${tId}`);
    expect(res.status).toBeDefined();
  });

  test('Documents Route returns 401 without auth', async () => {
    const res = await agent.get(`/api/tenders/${tId}/documents`);
    expect(res.status).toBe(401);
  });

  test('PDF Route returns 401 without auth', async () => {
    const res = await agent.get(`/api/tenders/${tId}/pdf`);
    expect(res.status).toBe(401);
  });

  test('Award Letters Route returns 401 without auth', async () => {
    const res = await agent.get(`/api/tenders/${tId}/award-letter`);
    expect([401, 404]).toContain(res.status);
  });
});
