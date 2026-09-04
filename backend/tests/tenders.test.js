import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';

// Setup basic environment
process.env.SESSION_SECRET = 'test-secret';

// Mock DB Pool
const mockQuery = jest.fn();
jest.unstable_mockModule('../src/config/database.js', () => ({
  pool: { query: mockQuery, connect: jest.fn().mockResolvedValue({ query: mockQuery, release: jest.fn() }) }
}));

// Mock logger
jest.unstable_mockModule('../src/utils/logger.js', () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

const tendersRouter = (await import('../src/routes/tenders.js')).default;
const { sessionMonitor } = await import('../src/middleware/sessionMiddleware.js');

describe('Tenders API Integration Tests', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());

    // Inject dummy session
    app.use((req, res, next) => {
      req.session = {};
      if (req.headers['x-mock-session']) {
        const mockSess = JSON.parse(req.headers['x-mock-session']);
        req.session.officerId = mockSess.officerId;
        req.session.role = mockSess.role;
        req.session.loa = mockSess.loa;
        req.session.loginAt = new Date().toISOString();
        
        req.officer = { id: mockSess.officerId, role: mockSess.role, loa: mockSess.loa };
      }
      // Simple req.session.destroy for the auth middleware compatibility
      req.session.destroy = jest.fn();
      req.session.touch = jest.fn();
      res.clearCookie = jest.fn();
      next();
    });

    app.use(sessionMonitor);
    app.use('/api/tenders', tendersRouter);

    mockQuery.mockClear();
  });

  const validAdminSession = JSON.stringify({ officerId: '1', role: 'ADMIN', loa: 'LOA_2_OTP' });
  const validOfficerSession = JSON.stringify({ officerId: '2', role: 'OFFICER', loa: 'LOA_2_OTP' });
  const loa3AdminSession = JSON.stringify({ officerId: '3', role: 'ADMIN', loa: 'LOA_3_BIOMETRIC' });

  it('Unauthenticated request returns 401', async () => {
    const res = await request(app).get('/api/tenders');
    expect(res.status).toBe(401);
  });

  it('Insufficient role returns 403 (Officer trying to create)', async () => {
    const res = await request(app)
      .post('/api/tenders')
      .set('x-mock-session', validOfficerSession)
      .send({ title: 'Test' });
    expect(res.status).toBe(403);
  });

  it('Create tender with valid data returns 201 (ADMIN)', async () => {
    mockQuery.mockImplementation((queryStr, params) => {
      if (queryStr === 'BEGIN' || queryStr === 'COMMIT' || queryStr === 'ROLLBACK') return Promise.resolve({});
      if (queryStr.includes('next_tender_sequence')) return Promise.resolve({ rows: [{ seq: 1 }] });
      if (queryStr.includes('INSERT INTO tenders')) return Promise.resolve({ rows: [{ id: '123', status: 'DRAFT' }] });
      if (queryStr.includes('INSERT INTO audit_log')) return Promise.resolve({});
      
      // For findById inside updateStatus and sign
      if (queryStr.includes('SELECT t.id')) {
        if (queryStr.includes('123')) return Promise.resolve({ rows: [{ id: '123', status: 'APPROVED_PENDING_SIGN', awarded_to_email: 'test@example.com' }] });
        return Promise.resolve({ rows: [] });
      }

      // For updateStatus FOR UPDATE
      if (queryStr.includes('FOR UPDATE')) {
        return Promise.resolve({ rowCount: 1, rows: [{ status: 'AWARDED', awarded_to_email: 'test@example.com' }] });
      }

      if (queryStr.includes('UPDATE tenders')) {
        return Promise.resolve({ rowCount: 1, rows: [{ id: '123', status: 'REVOKED' }] });
      }
      
      return Promise.resolve({ rows: [] });
    });
    
    const res = await request(app)
      .post('/api/tenders')
      .set('x-mock-session', validAdminSession)
      .send({
        title: 'New Highway Project',
        description: 'Construction of 20km highway',
        department: 'PUBLIC_WORKS_DEPARTMENT',
        category: 'WORKS',
        estimatedValue: 150000,
        submissionDeadline: new Date().toISOString()
      });
      
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('DRAFT');
  });

  it('Create tender with valid data returns 201 (SENIOR_OFFICER)', async () => {
    // Reuses the implementation above, just testing the role check
    const res = await request(app)
      .post('/api/tenders')
      .set('x-mock-session', JSON.stringify({ officerId: '2', role: 'SENIOR_OFFICER', loa: 'LOA_2_OTP' }))
      .send({
        title: 'New IT Project',
        description: 'Provision of servers',
        department: 'IT_DEPARTMENT',
        category: 'GOODS',
        estimatedValue: 50000,
        submissionDeadline: new Date().toISOString()
      });
      
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('DRAFT');
  });

  it('Create tender with invalid GSTIN returns 400', async () => {
    const res = await request(app)
      .post('/api/tenders')
      .set('x-mock-session', validAdminSession)
      .send({
        title: 'New Highway Project',
        description: 'Construction of 20km highway',
        department: 'PUBLIC_WORKS_DEPARTMENT',
        category: 'WORKS',
        estimatedValue: 150000,
        submissionDeadline: new Date().toISOString(),
        awardedToGstin: 'INVALID123'
      });
      
    expect(res.status).toBe(400);
    expect(res.body.details).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'awardedToGstin' })
    ]));
  });

  it('Status transition validations (Cannot go DRAFT to SIGNED)', async () => {
    mockQuery.mockImplementation((queryStr) => {
      if (queryStr === 'BEGIN' || queryStr === 'COMMIT' || queryStr === 'ROLLBACK') return Promise.resolve({});
      if (queryStr.includes('SELECT t.id')) return Promise.resolve({ rows: [{ id: '123', status: 'DRAFT' }] });
      return Promise.resolve({ rows: [] });
    });
    
    const res = await request(app)
      .post('/api/tenders/123/sign')
      .set('x-mock-session', loa3AdminSession);
      
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/is not in APPROVED_PENDING_SIGN/);
  });

  it('Sign route requires LoA 3', async () => {
    mockQuery.mockImplementation((queryStr) => {
      if (queryStr === 'BEGIN' || queryStr === 'COMMIT' || queryStr === 'ROLLBACK') return Promise.resolve({});
      if (queryStr.includes('SELECT t.id')) return Promise.resolve({ rows: [{ id: '123', status: 'APPROVED_PENDING_SIGN' }] });
      return Promise.resolve({ rows: [] });
    });
    
    const res = await request(app)
      .post('/api/tenders/123/sign')
      .set('x-mock-session', validAdminSession); // This session has LOA_2_OTP
      
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Insufficient authentication level/);
  });

  it('Revoke route requires LoA 3 + admin', async () => {
    mockQuery.mockImplementation((queryStr) => {
      if (queryStr === 'BEGIN' || queryStr === 'COMMIT' || queryStr === 'ROLLBACK') return Promise.resolve({});
      if (queryStr.includes('SELECT t.id')) return Promise.resolve({ rows: [{ id: '123', status: 'AWARDED', awarded_to_email: 'test@example.com' }] });
      if (queryStr.includes('FOR UPDATE')) return Promise.resolve({ rowCount: 1, rows: [{ status: 'AWARDED', awarded_to_email: 'test@example.com' }] });
      if (queryStr.includes('UPDATE tenders')) return Promise.resolve({ rowCount: 1, rows: [{ id: '123', status: 'REVOKED' }] });
      if (queryStr.includes('INSERT INTO audit_log')) return Promise.resolve({});
      return Promise.resolve({ rows: [] });
    });

    // 1. Test missing LoA 3
    const res1 = await request(app)
      .post('/api/tenders/123/revoke')
      .set('x-mock-session', validAdminSession)
      .send({ reason: 'COURT_ORDER', notes: 'Testing' });
    expect(res1.status).toBe(403);
    
    // 2. Test missing Admin role but has LoA 3 (simulate officer with LoA 3)
    const res2 = await request(app)
      .post('/api/tenders/123/revoke')
      .set('x-mock-session', JSON.stringify({ officerId: '2', role: 'OFFICER', loa: 'LOA_3_BIOMETRIC' }))
      .send({ reason: 'COURT_ORDER', notes: 'Testing' });
    expect(res2.status).toBe(403);
    
    // 3. Test success
    const res3 = await request(app)
      .post('/api/tenders/123/revoke')
      .set('x-mock-session', loa3AdminSession)
      .send({ reason: 'COURT_ORDER', notes: 'Valid revoke' });
      
    expect(res3.status).toBe(200);
    expect(res3.body.data.status).toBe('REVOKED');
  });
});
