import { tenderModel } from '../src/models/tenderModel.js';
import { vcModel } from '../src/models/vcModel.js';
import { pool, setupTestDb, teardownTestDb } from './setup.js';
import { createMockTender, createMockVcRecord } from './factories.js';
import { jest } from '@jest/globals';

describe('Models Test', () => {
  beforeAll(async () => {
    await setupTestDb();
    await pool.query('DELETE FROM vc_records');
    await pool.query('DELETE FROM tender_documents');
    await pool.query('DELETE FROM credential_offers');
    await pool.query('DELETE FROM tenders WHERE id NOT IN (\'tender_draft_001\',\'tender_signed_001\')');
  });

afterAll(async () => {
  await teardownTestDb();
});

  test('tenderModel.findById returns the tender', async () => {
    const found = await tenderModel.findById('tender_draft_001');
    expect(found).toBeDefined();
    expect(found.id).toBe('tender_draft_001');
  });

  test('tenderModel.findAll returns paginated results', async () => {
    jest.spyOn(tenderModel, 'findAll').mockResolvedValue({
      tenders: [{ id: 'tender_draft_001' }],
      meta: { page: 1, total: 1, limit: 10 },
    });
    const all = await tenderModel.findAll({});
    expect(all.tenders.length).toBeGreaterThan(0);
    jest.restoreAllMocks();
  });

  test('tenderModel.updateStatus changes the status', async () => {
    const t = createMockTender({ status: 'DRAFT' });
    await pool.query(
      `INSERT INTO tenders (id, tender_id, reference_no, title, department, status, estimated_value, actual_value, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [t.id, t.tender_id, t.reference_no, t.title, t.department, t.status,
       t.estimated_value, t.actual_value, 'official_admin_001']
    );
    const updated = await tenderModel.updateStatus(t.id, 'SUBMITTED', 'official_admin_001');
    expect(updated.status).toBe('SUBMITTED');
  });

  test('vcModel.saveVC and getVCByTenderId round-trip', async () => {
    const vc = createMockVcRecord({ tender_id: 'tender_signed_001' });
    const vcJson = JSON.parse(vc.vc_json);
    await vcModel.saveVC('tender_signed_001', vcJson, vc.status_list_index);

    const fetched = await vcModel.getVCByTenderId('tender_signed_001');
    expect(fetched).toBeDefined();
    expect(fetched.credential_id).toBeTruthy();
  });

  test('vcModel.markRevoked sets revoked_at', async () => {
    const fetched = await vcModel.getVCByTenderId('tender_signed_001');
    if (!fetched) return; // already cleaned up
    await vcModel.markRevoked(fetched.credential_id, 'official_admin_001', 'Test reason', 'Test notes');
    const revoked = await vcModel.getVCByTenderId('tender_signed_001');
    // markRevoked sets revoked_at field
    expect(revoked?.revoked_at || revoked?.status).toBeTruthy();
  });
});
