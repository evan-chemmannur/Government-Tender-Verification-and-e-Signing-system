/**
 * did.js — DID Document endpoint.
 *
 * GET /.well-known/did.json
 * - Public (no auth)
 * - Returns the DID document with publicKeyJwk
 * - Cache-Control: public, max-age=3600
 */

import { Router } from 'express';
import fs from 'fs/promises';
import logger from '../utils/logger.js';

const router = Router();

const ISSUER_DID = process.env.ISSUER_DID || 'did:web:tender.maharashtra.gov.in';
const PUBLIC_KEY_JWK_PATH = process.env.PUBLIC_KEY_JWK_PATH || '';

/**
 * GET /.well-known/did.json
 * Public endpoint — no authentication required.
 */
router.get('/did.json', async (req, res, next) => {
    try {
        let publicKeyJwk;

        // Try loading from environment first (JSON string)
        if (process.env.PUBLIC_KEY_JWK) {
            try {
                publicKeyJwk = JSON.parse(process.env.PUBLIC_KEY_JWK);
            } catch (e) {
                logger.warn('PUBLIC_KEY_JWK env var is not valid JSON');
            }
        }

        // Fallback: try loading from file
        if (!publicKeyJwk && PUBLIC_KEY_JWK_PATH) {
            try {
                const raw = await fs.readFile(PUBLIC_KEY_JWK_PATH, 'utf-8');
                publicKeyJwk = JSON.parse(raw);
            } catch (e) {
                logger.warn(`Could not load public key from ${PUBLIC_KEY_JWK_PATH}: ${e.message}`);
            }
        }

        // Final fallback: placeholder for development
        if (!publicKeyJwk) {
            publicKeyJwk = {
                kty: 'OKP',
                crv: 'Ed25519',
                x: 'DEVELOPMENT_PLACEHOLDER_KEY'
            };
        }

        const didDocument = {
            '@context': ['https://www.w3.org/ns/did/v1'],
            id: ISSUER_DID,
            verificationMethod: [{
                id: `${ISSUER_DID}#key-1`,
                type: 'JsonWebKey2020',
                controller: ISSUER_DID,
                publicKeyJwk: publicKeyJwk
            }],
            assertionMethod: [`${ISSUER_DID}#key-1`]
        };

        res.set({
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600'
        });

        res.json(didDocument);
    } catch (err) {
        next(err);
    }
});

export default router;
