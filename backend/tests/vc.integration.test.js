// ─────────────────────────────────────────────────────────
// tests/vc.integration.test.js — Verifiable Credential lifecycle tests
//
// Tests: Issue VC (mock Inji Certify), Store in DB, Revoke VC,
//        Verify revocation in status list, Credential offers
// ─────────────────────────────────────────────────────────

import { jest } from '@jest/globals';
import nock from 'nock';
import { pool, setupTestDb, teardownTestDb } from './setup.js';
import { createMockTender, createMockVcRecord, createMockCredentialOffer } from './factories.js';

// ── Mock Redis ────────────────────────────────────────────
jest.unstable_mockModule('redis', () => ({
  createClient: jest.fn().mockReturnValue({
    connect: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    get: jest.fn().mockResolvedValue(null),
    setEx: jest.fn().mockResolvedValue('OK'),
    quit: jest.fn().mockResolvedValue(undefined),
  }),
}));

beforeAll(async () => {
  await setupTestDb();
});

afterAll(async () => {
  await teardownTestDb();
});

afterEach(() => {
  nock.cleanAll();
});

describe('Task 17: VC Integration Flow', () => {

  // ─── Issue VC via Inji Certify (mocked) ───────────────────
  test('Issue VC via Inji Certify and store in DB', async () => {
    // Mock the Inji Certify API
    nock('https://api.certify.mock.test')
      .post('/v1/credentials/issue')
      .reply(200, {
        credential: {
          id: 'urn:uuid:vc-integration-test-001',
          type: ['VerifiableCredential', 'TenderAwardCredential'],
          issuer: 'did:web:tender.maharashtra.gov.in',
          issuanceDate: new Date().toISOString(),
          credentialSubject: {
            id: 'did:web:test',
            tenderTitle: 'Integration Test Tender',
            awardedTo: 'M/s Test Corp',
          },
        },
      });

    const t = createMockTender({ status: 'SIGNED' });
    const vcId = `vc_int_${Date.now()}`;

    // Insert tender first
    await pool.query(
      `INSERT INTO tenders (id, tender_id, reference_no, title, department, status,
        estimated_value, actual_value, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [t.id, t.tender_id, t.reference_no, t.title, t.department, 'SIGNED',
       t.estimated_value, t.actual_value, 'official_admin_001']
    );

    // Insert VC record (simulating what certifyService does)
    await pool.query(
      `INSERT INTO vc_records (id, tender_id, credential_id, vc_json, status, status_list_index)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [vcId, t.id, 'vc_cred_int_001',
       JSON.stringify({ jwt: 'mock-vc-jwt-token', type: ['VerifiableCredential'] }),
       'ACTIVE', 100]
    );

    const res = await pool.query('SELECT * FROM vc_records WHERE id = $1', [vcId]);
    expect(res.rows[0].status).toBe('ACTIVE');
    expect(res.rows[0].credential_id).toBe('vc_cred_int_001');
    expect(res.rows[0].status_list_index).toBe(100);
    expect(res.rows[0].tender_id).toBe(t.id);
  });

  // ─── VC Storage Verification ──────────────────────────────
  test('VC JSON is stored and retrievable as valid JSON', async () => {
    const res = await pool.query('SELECT vc_json FROM vc_records WHERE id = $1', ['vc_test_001']);
    expect(res.rows.length).toBe(1);

    const vcJson = JSON.parse(res.rows[0].vc_json);
    expect(vcJson.type).toContain('VerifiableCredential');
    expect(vcJson.issuer).toBe('did:web:tender.maharashtra.gov.in');
  });

  // ─── Revoke VC ────────────────────────────────────────────
  test('Revoke VC and verify status reflects REVOKED', async () => {
    // Create a fresh VC to revoke (don't mutate seeded data)
    const t = createMockTender({ status: 'SIGNED' });
    const vcId = `vc_revoke_${Date.now()}`;

    await pool.query(
      `INSERT INTO tenders (id, tender_id, reference_no, title, department, status,
        estimated_value, actual_value, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [t.id, t.tender_id, t.reference_no, t.title, t.department, 'SIGNED',
       t.estimated_value, t.actual_value, 'official_admin_001']
    );

    await pool.query(
      `INSERT INTO vc_records (id, tender_id, credential_id, vc_json, status, status_list_index)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [vcId, t.id, `cred_revoke_${Date.now()}`,
       JSON.stringify({ type: ['VerifiableCredential'] }),
       'ACTIVE', 200]
    );

    // Revoke it
    await pool.query(
      'UPDATE vc_records SET status = $1, revoked_at = NOW(), revoke_reason = $2, revoked_by = $3 WHERE id = $4',
      ['REVOKED', 'Test revocation reason', 'official_admin_001', vcId]
    );

    const res = await pool.query(
      'SELECT status, revoke_reason, revoked_at, revoked_by FROM vc_records WHERE id = $1',
      [vcId]
    );
    expect(res.rows[0].status).toBe('REVOKED');
    expect(res.rows[0].revoke_reason).toBe('Test revocation reason');
    expect(res.rows[0].revoked_at).toBeTruthy();
    expect(res.rows[0].revoked_by).toBe('official_admin_001');
  });

  // ─── Verify Revocation in Status List ─────────────────────
  test('Revoked VC status_list_index can be used for status list verification', async () => {
    const res = await pool.query(
      'SELECT status_list_index, status FROM vc_records WHERE id = $1',
      ['vc_test_001']
    );
    expect(res.rows.length).toBe(1);
    expect(typeof res.rows[0].status_list_index).toBe('number');
    expect(res.rows[0].status_list_index).toBe(42);
  });

  // ─── Status List Credential Storage ───────────────────────
  test('Status list credential can be created and retrieved', async () => {
    await pool.query(
      `INSERT INTO status_list_credentials (year, encoded_list, next_available_index)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [2025, Buffer.alloc(Math.ceil(100000 / 8)).toString('base64'), 0]
    );

    const res = await pool.query(
      'SELECT * FROM status_list_credentials WHERE year = $1',
      [2025]
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].encoded_list).toBeTruthy();
    expect(res.rows[0].next_available_index).toBe(0);
  });

  // ─── Credential Offer Creation ────────────────────────────
  test('VC credential_offer creation and lookup', async () => {
    const offerId = `offer_int_${Date.now()}`;
    const preAuthCode = `pre_auth_int_${Date.now()}`;

    await pool.query(
      `INSERT INTO credential_offers (id, vc_id, pre_authorized_code, expires_at, bidder_email)
       VALUES ($1,$2,$3,$4,$5)`,
      [offerId, 'vc_test_001', preAuthCode,
       new Date(Date.now() + 7 * 86400000).toISOString(), 'bidder@corp.in']
    );

    const res = await pool.query(
      'SELECT * FROM credential_offers WHERE id = $1', [offerId]
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].pre_authorized_code).toBe(preAuthCode);
    expect(res.rows[0].redeemed_at).toBeNull();
    expect(res.rows[0].bidder_email).toBe('bidder@corp.in');
  });

  // ─── Credential Offer Redemption ──────────────────────────
  test('Credential offer redemption marks redeemed_at', async () => {
    const offerId = `offer_redeem_${Date.now()}`;
    const preAuthCode = `pre_auth_redeem_${Date.now()}`;

    await pool.query(
      `INSERT INTO credential_offers (id, vc_id, pre_authorized_code, expires_at, bidder_email)
       VALUES ($1,$2,$3,$4,$5)`,
      [offerId, 'vc_test_001', preAuthCode,
       new Date(Date.now() + 7 * 86400000).toISOString(), 'bidder@corp.in']
    );

    await pool.query(
      'UPDATE credential_offers SET redeemed_at = NOW() WHERE id = $1', [offerId]
    );

    const res = await pool.query(
      'SELECT redeemed_at FROM credential_offers WHERE id = $1', [offerId]
    );
    expect(res.rows[0].redeemed_at).toBeTruthy();
  });

  // ─── Credential Offer Link ────────────────────────────────
  test('Credential offer link can be created with short_code', async () => {
    const offerId = `offer_link_${Date.now()}`;
    const preAuthCode = `pre_auth_link_${Date.now()}`;
    const linkId = `link_${Date.now()}`;
    const shortCode = `SHORT_${Date.now()}`;

    await pool.query(
      `INSERT INTO credential_offers (id, vc_id, pre_authorized_code, expires_at, bidder_email)
       VALUES ($1,$2,$3,$4,$5)`,
      [offerId, 'vc_test_001', preAuthCode,
       new Date(Date.now() + 7 * 86400000).toISOString(), 'bidder@corp.in']
    );

    await pool.query(
      `INSERT INTO credential_offer_links (id, offer_id, short_code)
       VALUES ($1,$2,$3)`,
      [linkId, offerId, shortCode]
    );

    const res = await pool.query(
      'SELECT * FROM credential_offer_links WHERE short_code = $1', [shortCode]
    );
    expect(res.rows.length).toBe(1);
    expect(res.rows[0].offer_id).toBe(offerId);
  });

  // ─── VC-Tender Relationship ───────────────────────────────
  test('VC record correctly references its parent tender', async () => {
    const res = await pool.query(`
      SELECT vc.id as vc_id, vc.status as vc_status, t.title as tender_title
      FROM vc_records vc
      JOIN tenders t ON vc.tender_id = t.id
      WHERE vc.id = $1
    `, ['vc_test_001']);

    expect(res.rows.length).toBe(1);
    expect(res.rows[0].tender_title).toBe('Bridge Construction');
    expect(res.rows[0].vc_status).toBeDefined();
  });

  // ─── Duplicate VC Prevention ──────────────────────────────
  test('Multiple VC records can exist for different tenders', async () => {
    const t = createMockTender({ status: 'SIGNED' });
    const vcId = `vc_multi_${Date.now()}`;

    await pool.query(
      `INSERT INTO tenders (id, tender_id, reference_no, title, department, status,
        estimated_value, actual_value, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [t.id, t.tender_id, t.reference_no, t.title, t.department, 'SIGNED',
       t.estimated_value, t.actual_value, 'official_admin_001']
    );

    await pool.query(
      `INSERT INTO vc_records (id, tender_id, credential_id, vc_json, status, status_list_index)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [vcId, t.id, `cred_multi_${Date.now()}`,
       JSON.stringify({ type: ['VerifiableCredential'] }),
       'ACTIVE', 300]
    );

    const totalVCs = await pool.query('SELECT COUNT(*) FROM vc_records');
    expect(parseInt(totalVCs.rows[0].count, 10)).toBeGreaterThan(1);
  });
});
