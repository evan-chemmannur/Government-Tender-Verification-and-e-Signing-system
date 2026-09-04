import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { tenderModel } from '../models/tenderModel.js';
import pdfService, { pdfJobs } from '../services/pdfService.js';
import { pool } from '../config/database.js';
import fs from 'fs/promises';
import path from 'path';

const router = Router();

/**
 * GET /api/tenders/:id/pdf
 * Download stamped PDF (auth required)
 */
router.get('/:id/pdf', requireAuth, async (req, res, next) => {
    try {
        const tenderId = req.params.id;
        const officialId = req.officer.id;

        const pdfPath = await pdfService.getPDFPath(tenderId, officialId, pool);

        if (!pdfPath) {
            return res.status(404).json({ error: 'PDF not found or not generated yet. Please generate it first.' });
        }

        const filename = path.basename(pdfPath);
        res.download(pdfPath, filename, (err) => {
            if (err) {
                next(err);
            }
        });
    } catch (err) {
        if (err.message.includes('PDF not available for unsigned tenders')) {
            return res.status(403).json({ error: err.message });
        }
        next(err);
    }
});

/**
 * POST /api/tenders/:id/pdf/generate
 * Trigger async PDF generation
 */
router.post('/:id/pdf/generate', requireAuth, async (req, res, next) => {
    try {
        const tenderId = req.params.id;
        const tender = await tenderModel.findById(tenderId);

        if (!tender) {
            return res.status(404).json({ error: 'Tender not found' });
        }

        if (!['SIGNED', 'AWARDED'].includes(tender.status)) {
            return res.status(403).json({ error: 'PDF can only be generated for SIGNED or AWARDED tenders' });
        }

        const existingJob = pdfJobs.get(tenderId);
        if (existingJob && existingJob.status === 'generating') {
            return res.json({ status: 'generating', jobId: tenderId, message: 'Job already in progress' });
        }

        // Trigger generation asynchronously. We do not await it.
        pdfService.processSignedTender(tenderId, pool).catch(err => {
            console.error(`Async PDF generation failed for ${tenderId}:`, err);
        });

        res.status(202).json({ status: 'generating', jobId: tenderId });
    } catch (err) {
        next(err);
    }
});

/**
 * GET /api/tenders/:id/pdf/status
 * Check if PDF is ready
 */
router.get('/:id/pdf/status', requireAuth, async (req, res, next) => {
    try {
        const tenderId = req.params.id;
        const job = pdfJobs.get(tenderId);

        if (!job) {
            // Check if it already exists on disk
            const pdfPath = await pdfService.getPDFPath(tenderId, req.officer.id, pool);
            if (pdfPath) {
                return res.json({ ready: true, path: pdfPath });
            }
            return res.status(404).json({ error: 'No PDF generation job found for this tender' });
        }

        if (job.status === 'completed') {
            return res.json({ ready: true, path: job.path });
        } else if (job.status === 'failed') {
            return res.status(500).json({ ready: false, error: job.error });
        } else {
            return res.json({ ready: false, status: 'generating' });
        }
    } catch (err) {
        next(err);
    }
});

export default router;
