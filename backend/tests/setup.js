// ─────────────────────────────────────────────────────────
// tests/setup.js — Jest test environment setup
//
// CRITICAL: Environment variables MUST be set before any
// application module is imported, because session.js and
// constants.js read process.env at module-evaluation time.
// ─────────────────────────────────────────────────────────

// ── 1. Set env vars FIRST (before any import) ─────────────
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-key-for-jest-sessions-32chars!';
process.env.FRONTEND_URL = 'http://localhost:3000';
process.env.ESIGNET_BASE_URL = 'https://esignet.mock.test';
process.env.CLIENT_ID = 'test-client-id';
process.env.REDIRECT_URI = 'http://localhost:3001/auth/callback';
process.env.INJI_CERTIFY_BASE_URL = 'https://api.certify.mock.test';
process.env.INJI_CLIENT_ID = 'test-inji-client';
process.env.INJI_CLIENT_SECRET = 'test-inji-secret';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.LOG_LEVEL = 'error'; // suppress noisy logs during tests

// ── 2. Now import dependencies ────────────────────────────
import { newDb } from 'pg-mem';
import crypto from 'crypto';
import { setPool } from '../src/config/database.js';

let db;
let _pool; // module-private

export function getPool() {
  if (!_pool) {
    throw new Error(
      '[tests/setup.js] getPool() called before setupTestDb() completed. ' +
      'Call `await setupTestDb()` in a beforeAll() hook first.'
    );
  }
  return _pool;
}

// Lazy proxy — allows `import { pool } from './setup.js'` to work
// even though the real pool isn't created until setupTestDb() runs.
export const pool = new Proxy({}, {
  get(target, prop) {
    const realPool = getPool();
    const value = realPool[prop];
    if (typeof value === 'function') {
      return value.bind(realPool);
    }
    return value;
  }
});

export async function setupTestDb() {
  db = newDb();

  // Register missing PG functions that pg-mem doesn't support natively
  db.public.registerFunction({
    name: 'gen_random_uuid',
    returns: 'text',
    implementation: () => crypto.randomUUID(),
  });
  db.public.registerFunction({
    name: 'now',
    returns: 'timestamp',
    implementation: () => new Date().toISOString(),
  });
  db.public.registerFunction({
    name: 'current_timestamp',
    returns: 'timestamp',
    implementation: () => new Date().toISOString(),
  });

  const { Pool } = db.adapters.createPg();
  _pool = new Pool();

  // Wire app's database.js to this same in-memory pool
  setPool(_pool);

  // ── Create all tables ─────────────────────────────────────

  await _pool.query(`
    CREATE TABLE IF NOT EXISTS officials (
      id VARCHAR(255) PRIMARY KEY,
      aadhaar_sub VARCHAR(255) UNIQUE NOT NULL,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255),
      role VARCHAR(50) NOT NULL DEFAULT 'OFFICER',
      department VARCHAR(255),
      designation VARCHAR(255),
      loa INTEGER DEFAULT 1,
      loa_level VARCHAR(50),
      is_active BOOLEAN DEFAULT true,
      last_login TIMESTAMP,
      last_login_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await _pool.query(`
    CREATE TABLE IF NOT EXISTS tenders (
      id VARCHAR(255) PRIMARY KEY,
      tender_id VARCHAR(255) UNIQUE NOT NULL,
      reference_no VARCHAR(255),
      title VARCHAR(500) NOT NULL,
      description TEXT,
      department VARCHAR(255) NOT NULL,
      category VARCHAR(255),
      currency VARCHAR(10) DEFAULT 'INR',
      status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
      estimated_value BIGINT DEFAULT 0,
      actual_value BIGINT DEFAULT 0,
      awarded_to_name VARCHAR(255),
      awarded_to_gstin VARCHAR(255),
      awarded_to_email VARCHAR(255),
      submission_deadline TIMESTAMP,
      contract_start_date TIMESTAMP,
      contract_end_date TIMESTAMP,
      created_by VARCHAR(255) REFERENCES officials(id),
      reviewed_by VARCHAR(255) REFERENCES officials(id),
      approved_by VARCHAR(255) REFERENCES officials(id),
      signed_by VARCHAR(255) REFERENCES officials(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await _pool.query(`
    CREATE TABLE IF NOT EXISTS tender_documents (
      id SERIAL PRIMARY KEY,
      tender_id VARCHAR(255) REFERENCES tenders(id),
      original_filename VARCHAR(500),
      stored_path VARCHAR(1000),
      mime_type VARCHAR(255),
      file_size INTEGER,
      document_type VARCHAR(100),
      uploaded_by VARCHAR(255) REFERENCES officials(id),
      sha256_hash VARCHAR(64),
      deleted_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await _pool.query(`
    CREATE TABLE IF NOT EXISTS vc_records (
      id VARCHAR(255) PRIMARY KEY DEFAULT gen_random_uuid(),
      tender_id VARCHAR(255) REFERENCES tenders(id),
      credential_id VARCHAR(255),
      vc_json TEXT,
      vc_format VARCHAR(50) DEFAULT 'ldp_vc',
      issuer_did VARCHAR(255),
      holder_did VARCHAR(255),
      status VARCHAR(50) DEFAULT 'ACTIVE',
      status_list_url VARCHAR(1000),
      status_list_index INTEGER,
      pdf_path VARCHAR(1000),
      revoked_at TIMESTAMP,
      revoked_by VARCHAR(255),
      revoke_reason VARCHAR(255),
      revoke_notes TEXT,
      issued_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await _pool.query(`
    CREATE TABLE IF NOT EXISTS credential_offers (
      id VARCHAR(255) PRIMARY KEY,
      vc_id VARCHAR(255) REFERENCES vc_records(id),
      pre_authorized_code VARCHAR(255) UNIQUE,
      expires_at TIMESTAMP,
      bidder_email VARCHAR(255),
      redeemed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await _pool.query(`
    CREATE TABLE IF NOT EXISTS credential_offer_links (
      id VARCHAR(255) PRIMARY KEY,
      offer_id VARCHAR(255) REFERENCES credential_offers(id),
      short_code VARCHAR(100) UNIQUE,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await _pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      tender_id VARCHAR(255),
      official_id VARCHAR(255),
      vc_id VARCHAR(255),
      action VARCHAR(255) NOT NULL,
      old_value TEXT,
      new_value TEXT,
      details TEXT,
      ip_address VARCHAR(50),
      user_agent VARCHAR(500),
      session_id VARCHAR(255),
      timestamp TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await _pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      to_email VARCHAR(255),
      subject VARCHAR(500),
      body TEXT,
      status VARCHAR(50) DEFAULT 'PENDING',
      attempts INTEGER DEFAULT 0,
      sent_at TIMESTAMP,
      error_message TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await _pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      sid VARCHAR(255) PRIMARY KEY,
      sess TEXT,
      expire TIMESTAMP
    )
  `);

  await _pool.query(`
    CREATE TABLE IF NOT EXISTS nonces (
      value VARCHAR(255) PRIMARY KEY,
      created_at TIMESTAMP DEFAULT NOW(),
      used_at TIMESTAMP
    )
  `);

  await _pool.query(`
    CREATE TABLE IF NOT EXISTS status_list_credentials (
      id SERIAL PRIMARY KEY,
      year INTEGER UNIQUE,
      encoded_list TEXT,
      vc_json TEXT,
      next_available_index INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  await _pool.query(`
    CREATE TABLE IF NOT EXISTS award_letters (
      id VARCHAR(255) PRIMARY KEY,
      tender_id VARCHAR(255) REFERENCES tenders(id),
      docx_path VARCHAR(1000),
      pdf_path VARCHAR(1000),
      generated_by VARCHAR(255),
      generated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // ── Seed default fixtures ───────────────────────────────────
  await _pool.query(`
    INSERT INTO officials (id, aadhaar_sub, name, email, role, department, loa)
    VALUES
      ('official_admin_001',   'aadhaar_admin_001',   'Admin Officer',   'admin@gov.in',   'ADMIN',          'PWD', 3),
      ('official_senior_001',  'aadhaar_senior_001',  'Senior Officer',  'senior@gov.in',  'SENIOR_OFFICER', 'PWD', 2),
      ('official_officer_001', 'aadhaar_officer_001', 'Regular Officer', 'officer@gov.in', 'OFFICER',        'PWD', 1)
    ON CONFLICT DO NOTHING
  `);

  await _pool.query(`
    INSERT INTO tenders (id, tender_id, reference_no, title, department, status,
                         estimated_value, actual_value, awarded_to_name, awarded_to_email, created_by)
    VALUES
      ('tender_draft_001',  'MH-PWD-2025-0001', 'REF-2025-0001', 'Road Construction Project', 'PWD', 'DRAFT',  48500000, 48500000, 'M/s Build Corp',  'build@corp.in',  'official_admin_001'),
      ('tender_signed_001', 'MH-PWD-2025-0002', 'REF-2025-0002', 'Bridge Construction',       'PWD', 'SIGNED', 100000000, 100000000, 'M/s Bridge Corp', 'bridge@corp.in', 'official_admin_001')
    ON CONFLICT DO NOTHING
  `);

  await _pool.query(`
    INSERT INTO vc_records (id, tender_id, credential_id, vc_json, status, status_list_index)
    VALUES ('vc_test_001', 'tender_signed_001', 'cred_001',
      '{"id":"cred_001","type":["VerifiableCredential","TenderAwardCredential"],"issuer":"did:web:tender.maharashtra.gov.in","issuanceDate":"2025-01-01T00:00:00Z","credentialSubject":{"id":"did:web:test","tenderTitle":"Bridge Construction"}}',
      'ACTIVE', 42)
    ON CONFLICT DO NOTHING
  `);

  return _pool;
}

export async function teardownTestDb() {
  if (_pool) await _pool.end().catch(() => {});
}

// ── Fixtures ────────────────────────────────────────────────
export const fixtures = {
  adminOfficial: {
    id: 'official_admin_001',
    aadhaar_sub: 'aadhaar_admin_001',
    name: 'Admin Officer',
    email: 'admin@gov.in',
    role: 'ADMIN',
    department: 'PWD',
    loa: 3,
  },
  seniorOfficer: {
    id: 'official_senior_001',
    aadhaar_sub: 'aadhaar_senior_001',
    name: 'Senior Officer',
    email: 'senior@gov.in',
    role: 'SENIOR_OFFICER',
    department: 'PWD',
    loa: 2,
  },
  regularOfficer: {
    id: 'official_officer_001',
    aadhaar_sub: 'aadhaar_officer_001',
    name: 'Regular Officer',
    email: 'officer@gov.in',
    role: 'OFFICER',
    department: 'PWD',
    loa: 1,
  },
  draftTender: {
    id: 'tender_draft_001',
    tender_id: 'MH-PWD-2025-0001',
    reference_no: 'REF-2025-0001',
    title: 'Road Construction Project',
    department: 'PWD',
    status: 'DRAFT',
    estimated_value: 48500000,
    actual_value: 48500000,
    awarded_to_name: 'M/s Build Corp',
    awarded_to_gstin: '27AABCU9603R1ZM',
    awarded_to_email: 'build@corp.in',
  },
  signedTender: {
    id: 'tender_signed_001',
    tender_id: 'MH-PWD-2025-0002',
    reference_no: 'REF-2025-0002',
    title: 'Bridge Construction',
    department: 'PWD',
    status: 'SIGNED',
    estimated_value: 100000000,
    actual_value: 100000000,
    awarded_to_name: 'M/s Bridge Corp',
    awarded_to_gstin: '27AABCU9603R1ZN',
    awarded_to_email: 'bridge@corp.in',
  },
};
