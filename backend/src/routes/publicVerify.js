/**
 * publicVerify.js — Public verification endpoints (NO AUTH required).
 *
 * GET /api/public/vc/:tenderId   — Returns VC JSON for a tender
 * GET /api/public/tender/:tenderId — Returns public tender summary
 */

import { Router } from 'express';
import { pool } from '../config/database.js';
import { vcModel } from '../models/vcModel.js';
import { tenderModel } from '../models/tenderModel.js';
import logger from '../utils/logger.js';

const router = Router();

// Public tenders that may have their VC fetched (only SIGNED or AWARDED)
const PUBLIC_STATUSES = ['SIGNED', 'AWARDED'];

/**
 * GET /api/public/vc/:tenderId
 * Returns the Verifiable Credential JSON for a given tender.
 * Only available once tender is SIGNED or AWARDED.
 * Cache-Control: public, max-age=60
 */
router.get('/vc/:tenderId', async (req, res, next) => {
    try {
        const { tenderId } = req.params;

        // Load tender to check status
        const tender = await tenderModel.findById(tenderId);
        if (!tender) {
            return res.status(404).json({ error: 'Tender not found' });
        }

        if (!PUBLIC_STATUSES.includes(tender.status)) {
            return res.status(403).json({
                error: 'Verification not available. Tender is not yet signed or awarded.'
            });
        }

        // Load VC
        const vcRecord = await vcModel.getVCByTenderId(tenderId);
        if (!vcRecord) {
            return res.status(404).json({ error: 'Verifiable Credential not yet issued for this tender' });
        }

        const vcJson = typeof vcRecord.vc_json === 'string'
            ? JSON.parse(vcRecord.vc_json)
            : vcRecord.vc_json;

        res.set({
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=60',
        });

        res.json({ vc: vcJson });
    } catch (err) {
        logger.error(`publicVerify /vc/:tenderId error: ${err.message}`);
        next(err);
    }
});

/**
 * GET /api/public/tender/:tenderId
 * Returns public-safe tender summary (no sensitive internal data).
 * Used by the Verify page to show context alongside the VC.
 */
router.get('/tender/:tenderId', async (req, res, next) => {
    try {
        const { tenderId } = req.params;

        const result = await pool.query(`
            SELECT
                t.id,
                t.tender_id,
                t.title,
                t.department,
                t.category,
                t.status,
                t.actual_value,
                t.estimated_value,
                t.awarded_to_name,
                t.awarded_to_gstin,
                t.contract_start_date,
                t.contract_end_date,
                t.updated_at,
                o.name          AS approved_by_name,
                o.designation   AS approved_by_designation,
                o.department    AS approved_by_department,
                vc.credential_id,
                vc.issued_at    AS vc_issued_at,
                vc.expires_at   AS vc_expires_at,
                vc.revoked_at   AS vc_revoked_at,
                vc.status_list_index,
                vc.status_list_url
            FROM tenders t
            LEFT JOIN officials o ON o.id = t.approved_by
            LEFT JOIN vc_records vc ON vc.tender_id = t.id
            WHERE t.id = $1 OR t.tender_id = $1
        `, [tenderId]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Tender not found' });
        }

        const row = result.rows[0];

        if (!PUBLIC_STATUSES.includes(row.status)) {
            return res.status(403).json({
                error: 'Tender details not publicly available at this stage'
            });
        }

        res.set('Cache-Control', 'public, max-age=60');
        res.json({
            tender: {
                id: row.id,
                tenderId: row.tender_id,
                title: row.title,
                department: row.department,
                category: row.category,
                status: row.status,
                actualValue: row.actual_value,
                estimatedValue: row.estimated_value,
                awardedToName: row.awarded_to_name,
                awardedToGstin: row.awarded_to_gstin,
                contractStart: row.contract_start_date,
                contractEnd: row.contract_end_date,
                approvedBy: {
                    name: row.approved_by_name,
                    designation: row.approved_by_designation,
                    department: row.approved_by_department,
                },
                vc: row.credential_id ? {
                    credentialId: row.credential_id,
                    issuedAt: row.vc_issued_at,
                    expiresAt: row.vc_expires_at,
                    revokedAt: row.vc_revoked_at,
                    statusListIndex: row.status_list_index,
                    statusListUrl: row.status_list_url,
                } : null,
            }
        });
    } catch (err) {
        logger.error(`publicVerify /tender/:tenderId error: ${err.message}`);
        next(err);
    }
});

export default router;
