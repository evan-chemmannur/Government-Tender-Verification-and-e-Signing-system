/**
 * statusList.js — Public endpoint for W3C BitString Status List.
 *
 * GET /.well-known/statuslist/:year
 * - Public (no auth)
 * - Returns the Status List VC JSON
 * - Cache-Control: public, max-age=300
 * - ETag + If-None-Match for 304 responses
 */

import { Router } from 'express';
import crypto from 'crypto';
import statusListService from '../services/statusListService.js';
import { pool } from '../config/database.js';

const router = Router();

/**
 * GET /.well-known/statuslist/:year
 * Public endpoint — no authentication required.
 */
router.get('/:year', async (req, res, next) => {
    try {
        const year = parseInt(req.params.year, 10);
        if (isNaN(year) || year < 2020 || year > 2100) {
            return res.status(400).json({ error: 'Invalid year parameter' });
        }

        const result = await statusListService.getPublicStatusList(year, pool);

        if (!result) {
            return res.status(404).json({ error: `No status list found for year ${year}` });
        }

        // Generate ETag from the encodedList content
        const etag = `"${crypto.createHash('sha256').update(result.encodedList).digest('hex').slice(0, 16)}"`;

        // Handle If-None-Match (304 Not Modified)
        if (req.headers['if-none-match'] === etag) {
            return res.status(304).end();
        }

        res.set({
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=300',
            'ETag': etag
        });

        res.json(result.vc);
    } catch (err) {
        next(err);
    }
});

export default router;
