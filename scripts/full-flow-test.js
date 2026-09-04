import pg from 'pg';
import crypto from 'crypto';
import zlib from 'zlib';
import { promisify } from 'util';

const unzipAsync = promisify(zlib.gunzip);
const { Pool } = pg;

const API_BASE = process.env.API_URL || 'http://localhost:3001/api';

const pool = new Pool({
  user: process.env.DB_USER || 'tender_admin',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'tender_db',
  password: process.env.DB_PASSWORD || 'tender_password',
  port: process.env.DB_PORT || 5432,
});

async function runTest() {
  let officerSessionCookie = '';
  let adminSessionCookie = '';
  let tenderId = '';
  let vcData = null;
  let statusListIndex = null;
  const startTime = Date.now();

  const printStep = (step, name, success, timeMs, extra = '') => {
    const status = success ? '✅ PASS' : '❌ FAIL';
    console.log(`[Step ${String(step).padStart(2, ' ')}] ${name.padEnd(45)} | ${status} | ${timeMs}ms ${extra}`);
  };

  const createSession = async (officialId, role, loa, name) => {
    const sid = crypto.randomBytes(16).toString('hex');
    const sessionData = {
      cookie: { originalMaxAge: 300000, expires: new Date(Date.now() + 300000).toISOString(), secure: false, httpOnly: true, path: '/' },
      officerId: officialId,
      officerName: name,
      loa,
      role,
      loginAt: new Date().toISOString()
    };
    
    await pool.query(`INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2, to_timestamp($3))`, 
      [sid, sessionData, Math.floor((Date.now() + 300000)/1000)]);
    
    const secret = process.env.SESSION_SECRET || 'tender-dev-secret';
    const signed = crypto.createHmac('sha256', secret).update(sid).digest('base64').replace(/\=+$/, '');
    return `tender.sid=s%3A${sid}.${signed};`;
  };

  try {
    console.log('--- Starting Full Flow Test (Headless) ---');

    // ---------------------------------------------------------
    // Step 1: Create Officer
    // ---------------------------------------------------------
    let s1Start = Date.now();
    try {
      const officerRes = await pool.query(`
        INSERT INTO officials (aadhaar_sub, name, department, role, loa_level, email, is_active)
        VALUES ($1, 'Test Officer', 'Public Works', 'OFFICER', 'LOA_3_BIOMETRIC', 'test_officer@gov.in', true)
        ON CONFLICT (aadhaar_sub) DO UPDATE SET is_active = true RETURNING id
      `, ['TEST-SUB-OFFICER-001']);
      
      officerSessionCookie = await createSession(officerRes.rows[0].id, 'OFFICER', 'LOA_3_BIOMETRIC', 'Test Officer');
      printStep(1, 'Create officer session', true, Date.now() - s1Start);
    } catch (err) {
      printStep(1, 'Create officer session', false, Date.now() - s1Start);
      throw err;
    }

    // ---------------------------------------------------------
    // Step 2: Create tender via API
    // ---------------------------------------------------------
    let s2Start = Date.now();
    try {
      const res = await fetch(`${API_BASE}/tenders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': officerSessionCookie
        },
        body: JSON.stringify({
          title: 'Highway Repair Project E2E',
          description: 'Automated E2E Test Tender',
          department: 'Public Works',
          category: 'WORKS',
          estimated_value: 50000000,
          awarded_to_name: 'ACME Construction',
          awarded_to_gstin: '27ABCDE1234F1Z5',
          awarded_to_email: 'bidder@example.com',
          contract_start_date: new Date().toISOString(),
          contract_end_date: new Date(Date.now() + 86400000*30).toISOString()
        })
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      tenderId = data.id;
      printStep(2, 'Create tender via API', true, Date.now() - s2Start, `(ID: ${tenderId})`);
    } catch (err) {
      printStep(2, 'Create tender via API', false, Date.now() - s2Start);
      throw err;
    }

    // ---------------------------------------------------------
    // Step 3: Submit tender
    // ---------------------------------------------------------
    let s3Start = Date.now();
    try {
      const res = await fetch(`${API_BASE}/tenders/${tenderId}/submit`, {
        method: 'POST',
        headers: { 'Cookie': officerSessionCookie }
      });
      if (!res.ok) throw new Error(await res.text());
      printStep(3, 'Submit tender', true, Date.now() - s3Start);
    } catch (err) {
      printStep(3, 'Submit tender', false, Date.now() - s3Start);
      throw err;
    }

    // ---------------------------------------------------------
    // Step 4: Login as admin
    // ---------------------------------------------------------
    let s4Start = Date.now();
    try {
      const adminRes = await pool.query(`
        INSERT INTO officials (aadhaar_sub, name, department, role, loa_level, email, is_active)
        VALUES ($1, 'Test Admin', 'HQ', 'ADMIN', 'LOA_3_BIOMETRIC', 'test_admin@gov.in', true)
        ON CONFLICT (aadhaar_sub) DO UPDATE SET is_active = true RETURNING id
      `, ['TEST-SUB-ADMIN-001']);
      
      adminSessionCookie = await createSession(adminRes.rows[0].id, 'ADMIN', 'LOA_3_BIOMETRIC', 'Test Admin');
      printStep(4, 'Login as admin', true, Date.now() - s4Start);
    } catch (err) {
      printStep(4, 'Login as admin', false, Date.now() - s4Start);
      throw err;
    }

    // ---------------------------------------------------------
    // Step 5: Start Review
    // ---------------------------------------------------------
    let s5Start = Date.now();
    try {
      const res = await fetch(`${API_BASE}/tenders/${tenderId}/start-review`, {
        method: 'POST',
        headers: { 'Cookie': adminSessionCookie }
      });
      if (!res.ok) throw new Error(await res.text());
      printStep(5, 'Start Review', true, Date.now() - s5Start);
    } catch (err) {
      printStep(5, 'Start Review', false, Date.now() - s5Start);
      throw err;
    }

    // ---------------------------------------------------------
    // Step 5b: Approve tender
    // ---------------------------------------------------------
    let s5bStart = Date.now();
    try {
      const res = await fetch(`${API_BASE}/tenders/${tenderId}/approve`, {
        method: 'POST',
        headers: { 'Cookie': adminSessionCookie }
      });
      if (!res.ok) throw new Error(await res.text());
      printStep('5b', 'Approve tender', true, Date.now() - s5bStart);
    } catch (err) {
      printStep('5b', 'Approve tender', false, Date.now() - s5bStart);
      throw err;
    }

    // ---------------------------------------------------------
    // Step 6: Sign tender (mock biometric)
    // ---------------------------------------------------------
    let s6Start = Date.now();
    try {
      const res = await fetch(`${API_BASE}/tenders/${tenderId}/sign`, {
        method: 'POST',
        headers: { 'Cookie': adminSessionCookie }
      });
      if (!res.ok) throw new Error(await res.text());
      printStep(6, 'Sign tender (trigger VC)', true, Date.now() - s6Start);
    } catch (err) {
      printStep(6, 'Sign tender (trigger VC)', false, Date.now() - s6Start);
      throw err;
    }

    // ---------------------------------------------------------
    // Step 7: Fetch VC from database
    // ---------------------------------------------------------
    let s7Start = Date.now();
    try {
      const dbVc = await pool.query('SELECT vc_json, status_list_index FROM vc_records WHERE tender_id = $1', [tenderId]);
      if (dbVc.rowCount === 0) throw new Error("VC Payload not found in DB");
      vcData = dbVc.rows[0].vc_json;
      statusListIndex = dbVc.rows[0].status_list_index;
      printStep(7, 'Fetch VC from database', true, Date.now() - s7Start, `(Index: ${statusListIndex})`);
    } catch (err) {
      printStep(7, 'Fetch VC from database', false, Date.now() - s7Start);
      throw err;
    }

    // ---------------------------------------------------------
    // Step 8: GET /api/public/vc/:tenderId
    // ---------------------------------------------------------
    let s8Start = Date.now();
    try {
      const verifyRes = await fetch(`http://localhost:3001/api/public/vc/${tenderId}`);
      if (!verifyRes.ok) throw new Error(await verifyRes.text());
      const pubData = await verifyRes.json();
      if (!pubData.vc || !pubData.vc.credentialSubject) throw new Error("Invalid VC format");
      printStep(8, 'Verify via public endpoint', true, Date.now() - s8Start, `(Subj: ${pubData.vc.credentialSubject.tenderId})`);
    } catch (err) {
      printStep(8, 'Verify via public endpoint', false, Date.now() - s8Start);
      throw err;
    }

    // ---------------------------------------------------------
    // Step 9: Check status list (should be bit=0)
    // ---------------------------------------------------------
    let s9Start = Date.now();
    try {
      const currentYear = new Date().getFullYear();
      const statusRes = await fetch(`http://localhost:3001/.well-known/statuslist/${currentYear}`);
      if (!statusRes.ok) throw new Error(await statusRes.text());
      const statusListVC = await statusRes.json();
      
      const encoded = statusListVC.credentialSubject.encodedList;
      const bitstringBuf = await unzipAsync(Buffer.from(encoded, 'base64'));
      
      const byteIdx = Math.floor(statusListIndex / 8);
      const bitIdx = 7 - (statusListIndex % 8);
      const bit = (bitstringBuf[byteIdx] >> bitIdx) & 1;
      
      if (bit !== 0) throw new Error(`Bit at ${statusListIndex} is not 0 (got ${bit})`);
      printStep(9, 'Check status list (bit=0)', true, Date.now() - s9Start);
    } catch (err) {
      printStep(9, 'Check status list (bit=0)', false, Date.now() - s9Start);
      throw err;
    }

    // ---------------------------------------------------------
    // Step 10: Revoke tender
    // ---------------------------------------------------------
    let s10Start = Date.now();
    try {
      const res = await fetch(`${API_BASE}/tenders/${tenderId}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Cookie': adminSessionCookie },
        body: JSON.stringify({ reason: 'ADMINISTRATIVE_ERROR', notes: 'E2E test' })
      });
      if (!res.ok) throw new Error(await res.text());
      printStep(10, 'Revoke tender', true, Date.now() - s10Start);
    } catch (err) {
      printStep(10, 'Revoke tender', false, Date.now() - s10Start);
      throw err;
    }

    // ---------------------------------------------------------
    // Step 11: Check status list (should be bit=1)
    // ---------------------------------------------------------
    let s11Start = Date.now();
    try {
      const currentYear = new Date().getFullYear();
      const statusRes = await fetch(`http://localhost:3001/.well-known/statuslist/${currentYear}`);
      if (!statusRes.ok) throw new Error(await statusRes.text());
      const statusListVC = await statusRes.json();
      
      const encoded = statusListVC.credentialSubject.encodedList;
      const bitstringBuf = await unzipAsync(Buffer.from(encoded, 'base64'));
      
      const byteIdx = Math.floor(statusListIndex / 8);
      const bitIdx = 7 - (statusListIndex % 8);
      const bit = (bitstringBuf[byteIdx] >> bitIdx) & 1;
      
      if (bit !== 1) throw new Error(`Bit at ${statusListIndex} is not 1 (got ${bit})`);
      printStep(11, 'Check status list (bit=1)', true, Date.now() - s11Start);
    } catch (err) {
      printStep(11, 'Check status list (bit=1)', false, Date.now() - s11Start);
      throw err;
    }

    // ---------------------------------------------------------
    // Step 12: GET /api/public/vc/:tenderId (revoked_at not null)
    // ---------------------------------------------------------
    let s12Start = Date.now();
    try {
      const verifyRes = await fetch(`http://localhost:3001/api/public/vc/${tenderId}`);
      if (!verifyRes.ok) throw new Error(await verifyRes.text());
      const pubData = await verifyRes.json();
      if (!pubData.revokedAt) throw new Error("revokedAt is null but should be set");
      printStep(12, 'Verify revoked status via public API', true, Date.now() - s12Start);
    } catch (err) {
      printStep(12, 'Verify revoked status via public API', false, Date.now() - s12Start);
      throw err;
    }

    console.log(`\n🎉 E2E Test Completed in ${Date.now() - startTime}ms`);

  } catch (err) {
    console.error('\n❌ TEST FAILED:', err.message);
    console.error(err.stack);
  } finally {
    // Cleanup
    if (tenderId) {
      await pool.query('DELETE FROM audit_log WHERE tender_id = $1', [tenderId]);
      await pool.query('DELETE FROM vc_records WHERE tender_id = $1', [tenderId]);
      await pool.query('DELETE FROM tender_documents WHERE tender_id = $1', [tenderId]);
      await pool.query('DELETE FROM tenders WHERE id = $1', [tenderId]);
      console.log(`Cleanup: Deleted test tender ${tenderId}`);
    }
    await pool.end();
  }
}

runTest();
