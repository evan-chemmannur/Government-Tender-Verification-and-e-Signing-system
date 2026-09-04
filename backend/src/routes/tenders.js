import { Router } from 'express';
import { requireAuth, requireRole, requireLoA } from '../middleware/auth.js';
import { validateBody, CreateTenderSchema, UpdateTenderSchema, RevokeReasonSchema } from '../middleware/validation.js';
import { tenderModel } from '../models/tenderModel.js';
import logger from '../utils/logger.js';
import { pool } from '../config/database.js';
import walletDeliveryService from '../services/walletDeliveryService.js';
import pdfService from '../services/pdfService.js';
import { vcModel } from '../models/vcModel.js';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Local VC issuance — creates a real vc_records row without needing Inji Certify
async function issueLocalVC(tender) {
  const credentialId = `urn:uuid:${uuidv4()}`;
  const now = new Date().toISOString();

  // Atomically grab the next status list index directly (bypass broken DB function)
  const year = new Date().getFullYear();
  const statusListId = `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/status-list/${year}`;

  // Upsert the status list row, then atomically increment and return the index
  await pool.query(
    `INSERT INTO status_list_credentials (list_id, year, encoded_list, next_available_index, capacity)
     VALUES ($1, $2, '', 0, 100000)
     ON CONFLICT (list_id) DO NOTHING`,
    [statusListId, year]
  );
  const idxRes = await pool.query(
    `UPDATE status_list_credentials
     SET next_available_index = next_available_index + 1
     WHERE list_id = $1
     RETURNING next_available_index - 1 AS idx`,
    [statusListId]
  );
  const statusListIndex = idxRes.rows[0].idx;

  const vcJson = {
    '@context': ['https://www.w3.org/2018/credentials/v1'],
    id: credentialId,
    type: ['VerifiableCredential', 'TenderAwardCredential'],
    issuer: process.env.ISSUER_DID || `did:web:${process.env.BACKEND_URL || 'localhost'}`,
    issuanceDate: now,
    credentialSubject: {
      id: `urn:tender:${tender.tender_id}`,
      tenderId: tender.tender_id,
      title: tender.title,
      department: tender.department,
      category: tender.category,
      estimatedValueInr: tender.estimated_value_inr,
      awardedTo: tender.awarded_to_name,
      awardedToGstin: tender.awarded_to_gstin,
      contractStartDate: tender.contract_start_date,
      contractEndDate: tender.contract_end_date,
      signedAt: now,
    },
    credentialStatus: {
      id: `${statusListId}#${statusListIndex}`,
      type: 'BitstringStatusListEntry',
      statusPurpose: 'revocation',
      statusListIndex: String(statusListIndex),
      statusListCredential: statusListId
    }
  };

  // Insert into vc_records (idempotent: delete old PENDING if any)
  await pool.query(`DELETE FROM vc_records WHERE tender_id = $1`, [tender.id]);
  await pool.query(
    `INSERT INTO vc_records (tender_id, credential_id, vc_json, status_list_index, status_list_url, issued_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [tender.id, credentialId, JSON.stringify(vcJson), statusListIndex, statusListId]
  );

  logger.info(`Local VC issued: ${credentialId} for tender ${tender.tender_id}`);
  return { credential_id: credentialId, status_list_index: statusListIndex, vc_json: vcJson };
}

// Notification stub
const notificationService = { notifyBidder: async (email, reason) => true };


/**
 * GET /api/tenders/statistics
 * ADMIN only. Must be registered BEFORE /:id
 */
router.get('/statistics', requireAuth, requireRole('ADMIN', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const stats = await tenderModel.getStatistics();
    res.json({ data: stats, meta: null });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tenders
 */
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const filters = {
      status: req.query.status,
      department: req.query.department,
      min_value: req.query.min_value ? Number(req.query.min_value) : undefined,
      max_value: req.query.max_value ? Number(req.query.max_value) : undefined,
      page: req.query.page || 1,
      limit: req.query.limit || 10,
      sort: req.query.sort,
      order: req.query.order
    };
    
    const result = await tenderModel.findAll(filters);
    res.json(result); // Already has { data, meta } envelope
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tenders/:id
 */
router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const tender = await tenderModel.findWithVC(req.params.id);
    if (!tender) return res.status(404).json({ error: 'Tender not found' });
    
    // Also fetch the full relational view (officer names etc)
    const fullTender = await tenderModel.findById(req.params.id);
    
    // Merge vc record info
    res.json({ 
      data: { ...fullTender, vc_record: tender.credential_id ? { credential_id: tender.credential_id, revoked_at: tender.revoked_at } : null },
      meta: null 
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/tenders
 */
router.post('/', requireAuth, requireRole('ADMIN', 'SENIOR_OFFICER'), validateBody(CreateTenderSchema), async (req, res, next) => {
  try {
    const newTender = await tenderModel.create(req.body, req.officer.id);
    res.status(201).json({ data: newTender, meta: null });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/tenders/:id
 */
router.put('/:id', requireAuth, requireRole('OFFICER', 'SENIOR_OFFICER', 'ADMIN'), validateBody(UpdateTenderSchema), async (req, res, next) => {
  try {
    const updated = await tenderModel.update(req.params.id, req.body, req.officer.id);
    if (!updated) return res.status(400).json({ error: 'Update failed or no fields provided' });
    res.json({ data: updated, meta: null });
  } catch (err) {
    if (err.message.includes('DRAFT tenders can be updated')) return res.status(400).json({ error: err.message });
    next(err);
  }
});

/**
 * DELETE /api/tenders/:id
 * Only DRAFT tenders can be deleted.
 */
router.delete('/:id', requireAuth, requireRole('OFFICER', 'SENIOR_OFFICER', 'ADMIN'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tenderRes = await client.query('SELECT id, status, title FROM tenders WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (tenderRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Tender not found' });
    }
    if (tenderRes.rows[0].status !== 'DRAFT') {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Only DRAFT tenders can be deleted' });
    }

    // Insert audit record FIRST (while tender_id FK still resolves)
    await client.query(
      `INSERT INTO audit_log (official_id, action, tender_id, new_value, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        req.officer.id,
        'TENDER_DELETED',
        req.params.id,
        JSON.stringify({ title: tenderRes.rows[0].title, deleted_by: req.officer.name }),
        req.ip,
        req.headers['user-agent']
      ]
    );

    // Now delete — audit row already inserted in same txn
    await client.query('DELETE FROM tenders WHERE id = $1', [req.params.id]);

    await client.query('COMMIT');
    res.json({ data: { success: true }, meta: null });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
});

/**
 * POST /api/tenders/:id/submit
 */
router.post('/:id/submit', requireAuth, requireRole('OFFICER', 'SENIOR_OFFICER', 'ADMIN'), async (req, res, next) => {
  try {
    // Check if required fields exist
    const tender = await tenderModel.findById(req.params.id);
    if (!tender) return res.status(404).json({ error: 'Not found' });
    if (!tender.title || !tender.estimated_value_inr) return res.status(400).json({ error: 'Missing required fields' });

    const result = await tenderModel.updateStatus(req.params.id, 'SUBMITTED', req.officer.id);
    res.json({ data: result, meta: null });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/tenders/:id/start-review
 */
router.post('/:id/start-review', requireAuth, requireRole('SENIOR_OFFICER'), async (req, res, next) => {
  try {
    const result = await tenderModel.updateStatus(req.params.id, 'UNDER_REVIEW', req.officer.id);
    res.json({ data: result, meta: null });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/tenders/:id/approve
 */
router.post('/:id/approve', requireAuth, requireRole('SENIOR_OFFICER', 'ADMIN'), requireLoA('loa2'), async (req, res, next) => {
  try {
    const result = await tenderModel.updateStatus(req.params.id, 'APPROVED_PENDING_SIGN', req.officer.id);
    res.json({ data: result, meta: null });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/tenders/:id/sign
 * MANDATORY LoA 3 (Biometric)
 */
router.post('/:id/sign', requireAuth, requireRole('SENIOR_OFFICER', 'ADMIN'), requireLoA('loa3'), async (req, res, next) => {
  try {
    const tender = await tenderModel.findById(req.params.id);
    if (!tender || tender.status !== 'APPROVED_PENDING_SIGN') {
      return res.status(400).json({ error: 'Tender is not in APPROVED_PENDING_SIGN status' });
    }

    // Update status to SIGNED
    await tenderModel.updateStatus(req.params.id, 'SIGNED', req.officer.id);

    try {
      // 1. Issue VC locally (Inji Certify integration requires external setup)
      const vcRecord = await issueLocalVC(tender);

      // 2. Generate PDF asynchronously (fires and forgets — client polls /pdf/status)
      pdfService.processSignedTender(req.params.id, pool).catch(err => {
        logger.error(`Async PDF generation failed for ${req.params.id}: ${err.message}`);
      });

      // 3. Notify wallet if email available
      if (tender.awarded_to_email) {
        walletDeliveryService.deliverWallet(tender.id, pool).catch(err => {
          logger.warn(`Wallet delivery failed: ${err.message}`);
        });
      }

      res.json({
        data: { status: 'signed', credential_id: vcRecord.credential_id, pdfStatus: 'generating' },
        meta: null
      });
    } catch (integrationErr) {
      logger.error(`Integration failed during sign for ${req.params.id}: ${integrationErr.message}`);
      
      // Rollback status via direct UPDATE to bypass state machine strict backwards transition rules
      await pool.query('UPDATE tenders SET status = $1 WHERE id = $2', ['APPROVED_PENDING_SIGN', req.params.id]);
      await pool.query(
        `INSERT INTO audit_log (tender_id, official_id, action, new_value, ip_address) VALUES ($1, $2, $3, $4, $5)`,
        [req.params.id, req.officer.id, 'STATUS_ROLLBACK', JSON.stringify({ notes: 'Rolled back: ' + integrationErr.message }), req.ip]
      );

      return res.status(500).json({ error: 'Signing integration failed. Status rolled back.', details: integrationErr.message });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/tenders/:id/revoke
 * MANDATORY LoA 3
 */
router.post('/:id/revoke', requireAuth, requireRole('ADMIN'), requireLoA('loa3'), validateBody(RevokeReasonSchema), async (req, res, next) => {
  try {
    const tender = await tenderModel.findById(req.params.id);
    if (!tender) return res.status(404).json({ error: 'Not found' });
    if (!['SIGNED', 'AWARDED'].includes(tender.status)) {
      return res.status(400).json({ error: 'Only SIGNED or AWARDED tenders can be revoked' });
    }

    const result = await tenderModel.updateStatus(req.params.id, 'REVOKED', req.officer.id, req.body);
    
    // Revocation triggers
    if (tender.awarded_to_email) {
      await notificationService.notifyBidder(tender.awarded_to_email, req.body.reason);
    }

    res.json({ data: result, meta: null });
  } catch (err) {
    next(err);
  }
});



/**
 * GET /api/tenders/:id/vc
 */
router.get('/:id/vc', requireAuth, async (req, res, next) => {
  try {
    const tender = await tenderModel.findWithVC(req.params.id);
    if (!tender) return res.status(404).json({ error: 'Not found' });
    if (!['SIGNED', 'AWARDED', 'REVOKED'].includes(tender.status)) {
      return res.status(403).json({ error: 'VC not issued yet' });
    }
    
    res.json({ 
      data: { 
        credential_id: tender.credential_id, 
        status_list_index: tender.status_list_index,
        vc_json: tender.vc_json 
      }, 
      meta: null 
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/tenders/:id/audit
 */
router.get('/:id/audit', requireAuth, requireRole('ADMIN'), async (req, res, next) => {
  try {
    const { pool } = await import('../config/database.js');
    const auditLogs = await pool.query(`
      SELECT a.id, a.action, a.old_value, a.new_value, a.timestamp, o.name as official_name
      FROM audit_log a
      LEFT JOIN officials o ON a.official_id = o.id
      WHERE a.tender_id = $1
      ORDER BY a.timestamp DESC
    `, [req.params.id]);

    res.json({ data: auditLogs.rows, meta: { total: auditLogs.rowCount } });
  } catch (err) {
    next(err);
  }
});

export default router;
