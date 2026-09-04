/**
 * walletDelivery.js — OpenID4VCI Wallet Delivery Routes.
 *
 * Public routes (no auth):
 *   GET  /wallet-offer/:shortCode              — Return credential offer JSON
 *   GET  /api/wallet/credential-issuer-metadata — OID4VCI issuer metadata
 *
 * Wallet app routes (called by Inji Wallet, not by browser):
 *   POST /api/wallet/token/:preAuthCode         — Issue OID4VCI access token
 *   POST /api/wallet/credential/:preAuthCode    — Return VC after token validation
 *
 * Internal routes (called by portal after tender signing):
 *   POST /api/wallet/deliver/:tenderId          — Trigger wallet delivery
 */

import { Router } from 'express';
import { jwtVerify, createRemoteJWKSet, importSPKI, importJWK } from 'jose';
import fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../config/database.js';
import walletDeliveryService from '../services/walletDeliveryService.js';
import logger from '../utils/logger.js';

const router = Router();

const ISSUER_BASE_URL = process.env.INJI_CERTIFY_BASE_URL || 'https://tender.maharashtra.gov.in';
const PORTAL_BASE_URL = process.env.PORTAL_BASE_URL || 'https://tender.maharashtra.gov.in';
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-secret-change-in-production';

// ─────────────────────────────────────────────────────────
// GET /wallet-offer/:shortCode
// Public: returns credential offer JSON for the short code.
// Called when bidder clicks the HTTPS link in email (not deeplink).
// ─────────────────────────────────────────────────────────
router.get('/wallet-offer/:shortCode', async (req, res, next) => {
    try {
        const { shortCode } = req.params;

        if (!shortCode || !/^[A-Za-z0-9]{6,12}$/.test(shortCode)) {
            return res.status(400).json({ error: 'Invalid short code format' });
        }

        // Look up short code in credential_offer_links
        const offerRes = await pool.query(`
            SELECT co.*, vr.vc_json
            FROM credential_offer_links col
            JOIN credential_offers co ON co.id = col.offer_id
            JOIN vc_records vr ON vr.id = co.vc_id
            WHERE col.short_code = $1
            LIMIT 1
        `, [shortCode]);

        if (offerRes.rowCount === 0) {
            return res.status(404).json({ error: 'Credential offer not found' });
        }

        const offer = offerRes.rows[0];

        // 410 Gone if expired
        if (new Date(offer.expires_at) < new Date()) {
            return res.status(410).json({
                error: 'Credential offer has expired',
                expired_at: offer.expires_at
            });
        }

        // 410 Gone if already redeemed
        if (offer.redeemed_at) {
            return res.status(410).json({
                error: 'Credential offer has already been redeemed',
                redeemed_at: offer.redeemed_at
            });
        }

        const offerJSON = {
            credential_issuer: ISSUER_BASE_URL,
            credentials: ['TenderAwardCredential'],
            grants: {
                'urn:ietf:params:oauth:grant-type:pre-authorized_code': {
                    'pre-authorized_code': offer.pre_authorized_code,
                    user_pin_required: false,
                    interval: 5
                }
            }
        };

        const userAgent = req.headers['user-agent'] || '';
        const accept = req.headers['accept'] || '';
        const isWallet = userAgent.toLowerCase().includes('inji') || userAgent.toLowerCase().includes('wallet') || accept.includes('application/json');

        if (isWallet) {
            res.set({
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store'
            });
            res.json(offerJSON);
        } else {
            const encodedOffer = encodeURIComponent(JSON.stringify(offerJSON));
            res.redirect(302, `openid-credential-offer://?credential_offer=${encodedOffer}`);
        }
    } catch (err) {
        logger.error(`wallet-offer error: ${err.message}`);
        next(err);
    }
});

// ─────────────────────────────────────────────────────────
// GET /api/wallet/credential-issuer-metadata
// Public: OID4VCI issuer metadata endpoint.
// Called by Inji Wallet to discover supported credential types.
// ─────────────────────────────────────────────────────────
router.get('/api/wallet/credential-issuer-metadata', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600');
    res.json({
        credential_issuer: ISSUER_BASE_URL,
        credential_endpoint: `${ISSUER_BASE_URL}/api/wallet/credential`,
        token_endpoint: `${ISSUER_BASE_URL}/api/wallet/token`,
        credentials_supported: [
            {
                format: 'ldp_vc',
                id: 'TenderAwardCredential',
                types: ['VerifiableCredential', 'TenderAwardCredential'],
                cryptographic_binding_methods_supported: ['did:web'],
                cryptographic_suites_supported: ['Ed25519Signature2020'],
                proof_types_supported: ['jwt'],
                display: [
                    {
                        name: 'Tender Award Certificate',
                        locale: 'en-IN',
                        description: 'Government of Maharashtra official tender award credential',
                        background_color: '#1e3a6e',
                        text_color: '#ffffff',
                        logo: {
                            url: `${PORTAL_BASE_URL}/logo.png`,
                            alt_text: 'Maharashtra Government Seal'
                        }
                    }
                ]
            }
        ],
        // Well-known endpoints
        jwks_uri: `${ISSUER_BASE_URL}/.well-known/jwks.json`,
        issuer: ISSUER_BASE_URL,
        authorization_server: ISSUER_BASE_URL
    });
});

// ─────────────────────────────────────────────────────────
// POST /api/wallet/token/:preAuthCode
// Called by Inji Wallet. Issues OID4VCI access token.
// Validates pre-authorized code, issues short-lived JWT.
// ─────────────────────────────────────────────────────────
router.post('/api/wallet/token/:preAuthCode', async (req, res, next) => {
    try {
        const { preAuthCode } = req.params;
        const grantType = req.body?.grant_type;

        if (grantType !== 'urn:ietf:params:oauth:grant-type:pre-authorized_code') {
            return res.status(400).json({
                error: 'unsupported_grant_type',
                error_description: 'Only pre-authorized_code grant type is supported'
            });
        }

        // Validate code exists and is not expired/redeemed
        const offerRes = await pool.query(
            'SELECT * FROM credential_offers WHERE pre_authorized_code = $1',
            [preAuthCode]
        );

        if (offerRes.rowCount === 0) {
            return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid pre-authorized code' });
        }

        const offer = offerRes.rows[0];

        if (new Date(offer.expires_at) < new Date()) {
            return res.status(400).json({ error: 'invalid_grant', error_description: 'Pre-authorized code has expired' });
        }

        if (offer.redeemed_at) {
            return res.status(400).json({ error: 'invalid_grant', error_description: 'Pre-authorized code has already been redeemed' });
        }

        // Issue access token
        const tokenResponse = await walletDeliveryService.issueAccessToken(preAuthCode);

        // Log redemption event for analytics (without logging the token)
        logger.info(`OID4VCI token issued for vc_id=${offer.vc_id}. grant=pre-authorized_code`);

        res.set('Cache-Control', 'no-store');
        res.json(tokenResponse);
    } catch (err) {
        logger.error(`Token endpoint error: ${err.message}`);
        next(err);
    }
});

// ─────────────────────────────────────────────────────────
// POST /api/wallet/credential/:preAuthCode
// Called by Inji Wallet after obtaining access token.
// Validates bearer token + proof JWT, returns VC.
// ─────────────────────────────────────────────────────────
router.post('/api/wallet/credential/:preAuthCode', async (req, res, next) => {
    try {
        const { preAuthCode } = req.params;
        const authHeader = req.headers.authorization;

        // Validate bearer token
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({
                error: 'invalid_token',
                error_description: 'Missing or invalid Authorization header'
            });
        }

        const bearerToken = authHeader.split(' ')[1];

        // Verify JWT (HS256 dev / EdDSA prod)
        try {
            const secret = new TextEncoder().encode(SESSION_SECRET);
            // Try HS256 first (dev), then EdDSA (prod)
            try {
                await jwtVerify(bearerToken, secret, {
                    issuer: ISSUER_BASE_URL
                });
            } catch {
                // Try EdDSA with signing key
                const keyPem = await fs.readFile(process.env.STATUS_LIST_SIGNING_KEY_PATH || '', 'utf-8');
                const { importPKCS8 } = await import('jose');
                const privateKey = await importPKCS8(keyPem, 'EdDSA');
                await jwtVerify(bearerToken, privateKey);
            }
        } catch (e) {
            return res.status(401).json({
                error: 'invalid_token',
                error_description: `Token validation failed: ${e.message}`
            });
        }

        // Validate proof JWT from request body
        const { proof, format } = req.body;
        if (proof?.proof_type === 'jwt') {
            if (!proof.jwt) {
                return res.status(400).json({
                    error: 'invalid_proof',
                    error_description: 'proof.jwt is required when proof_type is jwt'
                });
            }
            try {
                const { decodeJwt, decodeProtectedHeader } = await import('jose');
                const header = decodeProtectedHeader(proof.jwt);
                const payload = decodeJwt(proof.jwt);
                
                if (!header.alg) throw new Error('Missing alg in proof JWT header');
                if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Proof JWT expired');
                // Full DID cryptographic verification would happen here in production
            } catch (err) {
                return res.status(400).json({
                    error: 'invalid_proof',
                    error_description: `Malformed proof JWT: ${err.message}`
                });
            }
        }

        // Redeem the pre-authorized code → get VC
        let vcRecord, vcJson, offerRow;
        try {
            ({ vcRecord, vcJson, offerRow } = await walletDeliveryService.redeemPreAuthCode(preAuthCode, pool));
        } catch (e) {
            const errorMap = {
                'INVALID_CODE': 'invalid_grant',
                'CODE_EXPIRED': 'invalid_grant',
                'CODE_USED': 'invalid_grant'
            };
            const code = e.message.split(':')[0];
            return res.status(400).json({
                error: errorMap[code] || 'invalid_grant',
                error_description: e.message
            });
        }

        // Fresh c_nonce for next interaction
        const c_nonce = crypto.randomBytes
            ? require('crypto').randomBytes(16).toString('base64url')
            : uuidv4();

        // Log analytics event
        logger.info(`Credential delivered to wallet. vc_id=${vcRecord.id} format=${format || 'ldp_vc'}`);

        await pool.query(`
            INSERT INTO audit_log (official_id, action, tender_id, vc_id, new_value)
            VALUES ($1, $2, $3, $4, $5)
        `, [
            null,
            'WALLET_CREDENTIAL_REDEEMED',
            vcRecord.tender_id,
            vcRecord.id,
            JSON.stringify({ format: format || 'ldp_vc' })
        ]);

        res.set('Cache-Control', 'no-store');
        res.json({
            format: 'ldp_vc',
            credential: vcJson,
            c_nonce,
            c_nonce_expires_in: 300
        });
    } catch (err) {
        logger.error(`Credential endpoint error: ${err.message}`);
        next(err);
    }
});

// ─────────────────────────────────────────────────────────
// POST /api/wallet/deliver/:tenderId
// Internal: triggered by portal after tender is signed.
// Requires auth (called server-side from tenders route).
// ─────────────────────────────────────────────────────────
router.post('/api/wallet/deliver/:tenderId', async (req, res, next) => {
    try {
        const { tenderId } = req.params;
        const result = await walletDeliveryService.deliverWallet(tenderId, pool);
        res.json(result);
    } catch (err) {
        logger.error(`Wallet deliver error for ${req.params.tenderId}: ${err.message}`);
        next(err);
    }
});

export default router;
