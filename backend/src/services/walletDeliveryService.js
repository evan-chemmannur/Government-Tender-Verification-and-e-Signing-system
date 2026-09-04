/**
 * walletDeliveryService.js — OpenID4VCI Inji Wallet credential delivery.
 *
 * Spec: OID4VCI Pre-Authorized Code Flow
 * - Generates credential offer with pre-authorized_code
 * - Creates short URL for email-friendly links
 * - Generates deeplink QR for Inji Wallet app
 * - Sends notification email with both deeplink + HTTPS URL
 * - Tracks offer redemption (single-use, 7-day expiry)
 *
 * Constraints:
 * - Pre-authorized code: single use only
 * - Pre-authorized code expiry: 7 days
 * - Access token: 10 minutes only
 * - Never log access tokens or private keys
 */

import crypto from 'crypto';
import QRCode from 'qrcode';
import { SignJWT, importPKCS8 } from 'jose';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import { vcModel } from '../models/vcModel.js';
import { tenderModel } from '../models/tenderModel.js';
import logger from '../utils/logger.js';

const ISSUER_BASE_URL = process.env.INJI_CERTIFY_BASE_URL || 'https://tender.maharashtra.gov.in';
const PORTAL_BASE_URL = process.env.PORTAL_BASE_URL || 'https://tender.maharashtra.gov.in';
const SIGNING_KEY_PATH = process.env.STATUS_LIST_SIGNING_KEY_PATH || '';
const PRE_AUTH_EXPIRY_DAYS = 7;
const ACCESS_TOKEN_EXPIRY_SECONDS = 600; // 10 minutes
const C_NONCE_EXPIRY_SECONDS = 300;      // 5 minutes

class WalletDeliveryService {

    // ─────────────────────────────────────────────────────────
    // generateCredentialOffer(vcRecord, tender, db)
    // Creates a pre-authorized credential offer for OID4VCI.
    // Returns { preAuthCode, offerJSON, shortURL, deeplink, qrDataUrl }
    // ─────────────────────────────────────────────────────────
    async generateCredentialOffer(vcRecord, tender, db) {
        // 32 random bytes → base64url (single-use pre-authorized code)
        const preAuthCode = crypto.randomBytes(32).toString('base64url');
        const expiresAt = new Date(Date.now() + PRE_AUTH_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

        const offerJSON = {
            credential_issuer: ISSUER_BASE_URL,
            credentials: ['TenderAwardCredential'],
            grants: {
                'urn:ietf:params:oauth:grant-type:pre-authorized_code': {
                    'pre-authorized_code': preAuthCode,
                    user_pin_required: false,
                    interval: 5
                }
            }
        };

        // Save to credential_offers table
        await db.query(`
            INSERT INTO credential_offers
            (vc_id, pre_authorized_code, expires_at, bidder_email)
            VALUES ($1, $2, $3, $4)
        `, [
            vcRecord.id,
            preAuthCode,
            expiresAt.toISOString(),
            tender.awarded_to_email || null
        ]);

        logger.info(`Credential offer created for tender ${tender.tender_id}. Expiry: ${expiresAt.toISOString()}`);

        // Build short URL and deeplink
        const { shortCode, shortURL } = await this.createShortURL(offerJSON, db);
        const { deeplink, qrDataUrl } = await this.generateOfferDeeplink(offerJSON);

        return { preAuthCode, offerJSON, shortURL, shortCode, deeplink, qrDataUrl };
    }

    // ─────────────────────────────────────────────────────────
    // createShortURL(offerJSON, db)
    // Stores the offer under an 8-char alphanumeric short code.
    // Returns { shortCode, shortURL }
    // ─────────────────────────────────────────────────────────
    async createShortURL(offerJSON, db) {
        // 8-char alphanumeric short code (URL-safe, no ambiguous chars)
        const CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
        let shortCode;

        const preAuthCode = offerJSON.grants?.['urn:ietf:params:oauth:grant-type:pre-authorized_code']?.['pre-authorized_code'];
        const existing = await db.query(
            'SELECT id FROM credential_offers WHERE pre_authorized_code = $1',
            [preAuthCode]
        );

        if (existing.rowCount === 0) {
            throw new Error('Offer not found for pre-authorized code');
        }
        const offerId = existing.rows[0].id;

        // Retry on collision (astronomically unlikely with 8 chars from 55-char alphabet)
        for (let attempt = 0; attempt < 5; attempt++) {
            shortCode = Array.from(crypto.randomBytes(8))
                .map(b => CHARS[b % CHARS.length])
                .join('');

            try {
                await db.query(
                    'INSERT INTO credential_offer_links (offer_id, short_code) VALUES ($1, $2)',
                    [offerId, shortCode]
                );
                break;
            } catch (err) {
                if (err.code === '23505' && attempt < 4) continue; // unique constraint violation, retry
                throw err;
            }
        }

        const shortURL = `${PORTAL_BASE_URL}/wallet-offer/${shortCode}`;
        logger.info(`Short URL created: ${shortURL}`);
        return { shortCode, shortURL };
    }

    // ─────────────────────────────────────────────────────────
    // generateOfferDeeplink(offerJSON)
    // Returns the openid-credential-offer:// deeplink and QR PNG data URL.
    // ─────────────────────────────────────────────────────────
    async generateOfferDeeplink(offerJSON) {
        const encoded = encodeURIComponent(JSON.stringify(offerJSON));
        const deeplink = `openid-credential-offer://?credential_offer=${encoded}`;

        // QR code — Error Correction H for scannable at 300 DPI
        const qrDataUrl = await QRCode.toDataURL(deeplink, {
            errorCorrectionLevel: 'H',
            width: 400,
            margin: 2,
            color: { dark: '#0a0f1e', light: '#ffffff' }
        });

        return { deeplink, qrDataUrl };
    }

    // ─────────────────────────────────────────────────────────
    // redeemPreAuthCode(preAuthCode, db)
    // Validates and marks the pre-authorized code as redeemed (single-use).
    // Returns { vcRecord, offerRow }
    // ─────────────────────────────────────────────────────────
    async redeemPreAuthCode(preAuthCode, db) {
        const offerRes = await db.query(
            'SELECT * FROM credential_offers WHERE pre_authorized_code = $1',
            [preAuthCode]
        );

        if (offerRes.rowCount === 0) {
            throw new Error('INVALID_CODE: Pre-authorized code not found');
        }

        const offer = offerRes.rows[0];

        if (new Date(offer.expires_at) < new Date()) {
            throw new Error('CODE_EXPIRED: Pre-authorized code has expired');
        }

        if (offer.redeemed_at) {
            throw new Error('CODE_USED: Pre-authorized code has already been redeemed');
        }

        // Mark as redeemed — single use enforced
        await db.query(
            'UPDATE credential_offers SET redeemed_at = NOW() WHERE id = $1',
            [offer.id]
        );

        // Load the VC
        const vcRes = await db.query(
            'SELECT * FROM vc_records WHERE id = $1',
            [offer.vc_id]
        );

        const vcRecord = vcRes.rows[0];
        const vcJson = typeof vcRecord.vc_json === 'string'
            ? JSON.parse(vcRecord.vc_json)
            : vcRecord.vc_json;

        logger.info(`Pre-authorized code redeemed for VC ${vcRecord.id}. Wallet delivery complete.`);

        return { vcRecord, vcJson, offerRow: offer };
    }

    // ─────────────────────────────────────────────────────────
    // issueAccessToken(preAuthCode)
    // Issues a short-lived JWT access token for the OID4VCI flow.
    // Returns { access_token, c_nonce, expires_in }
    // ─────────────────────────────────────────────────────────
    async issueAccessToken(preAuthCode) {
        const c_nonce = crypto.randomBytes(16).toString('base64url');

        let accessToken;
        try {
            let keyPem = await fs.readFile(SIGNING_KEY_PATH, 'utf-8').catch(() => null);

            if (keyPem) {
                const privateKey = await importPKCS8(keyPem, 'EdDSA');
                accessToken = await new SignJWT({
                    sub: preAuthCode,
                    iss: ISSUER_BASE_URL,
                    aud: `${ISSUER_BASE_URL}/api/wallet`,
                    c_nonce,
                    jti: uuidv4()
                })
                    .setProtectedHeader({ alg: 'EdDSA' })
                    .setIssuedAt()
                    .setExpirationTime(`${ACCESS_TOKEN_EXPIRY_SECONDS}s`)
                    .sign(privateKey);
            } else {
                // Development: HMAC-signed token (no private key configured)
                const secret = new TextEncoder().encode(
                    process.env.SESSION_SECRET || 'dev-only-secret-change-in-production'
                );
                const { SignJWT: SignJWTCompat } = await import('jose');
                accessToken = await new SignJWTCompat({
                    sub: preAuthCode,
                    iss: ISSUER_BASE_URL,
                    c_nonce,
                    jti: uuidv4()
                })
                    .setProtectedHeader({ alg: 'HS256' })
                    .setIssuedAt()
                    .setExpirationTime(`${ACCESS_TOKEN_EXPIRY_SECONDS}s`)
                    .sign(secret);
            }
        } catch (err) {
            logger.error(`Token signing failed: ${err.message}`);
            throw new Error('TOKEN_SIGN_FAILED: Could not issue access token');
        }

        // NEVER log the access token
        logger.info(`Access token issued for pre-auth code [REDACTED]. Expires in ${ACCESS_TOKEN_EXPIRY_SECONDS}s.`);

        return {
            access_token: accessToken,
            token_type: 'bearer',
            expires_in: ACCESS_TOKEN_EXPIRY_SECONDS,
            c_nonce,
            c_nonce_expires_in: C_NONCE_EXPIRY_SECONDS
        };
    }

    // ─────────────────────────────────────────────────────────
    // sendWalletDeliveryNotification(tender, bidder, offerData, db)
    // ─────────────────────────────────────────────────────────
    async sendWalletDeliveryNotification(tender, offerData, db) {
        const recipientEmail = tender.awarded_to_email;
        if (!recipientEmail) {
            logger.warn(`No awarded_to_email found for tender ${tender.id}. Cannot send notification.`);
            return { emailSent: false };
        }

        const bidder = {
            name: tender.awarded_to_name || 'Valued Bidder',
            email: recipientEmail
        };

        const pdfURL = `https://tender.maharashtra.gov.in/api/tenders/${tender.id}/documents/award`;

        let emailSent = false;
        try {
            const emailService = (await import('./emailService.js')).default;
            await emailService.sendAwardNotification(tender, bidder, offerData.shortURL, pdfURL, db);
            emailSent = true;
        } catch (err) {
            logger.error(`Failed to send wallet delivery email via emailService: ${err.message}`);
        }

        return { emailSent, recipientEmail };
    }

    // ─────────────────────────────────────────────────────────
    // deliverWallet(tenderId, db)
    // Orchestration: load tender + VC → generate offer → notify.
    // Returns { offered: true, notificationSent: bool, shortURL, deeplink }
    // ─────────────────────────────────────────────────────────
    async deliverWallet(tenderId, db) {
        // Load tender
        const tender = await tenderModel.findById(tenderId);
        if (!tender) throw new Error(`Tender ${tenderId} not found`);

        if (!['SIGNED', 'AWARDED'].includes(tender.status)) {
            throw new Error(`Tender ${tenderId} is not in SIGNED or AWARDED state (current: ${tender.status})`);
        }

        // Load VC
        const vcRecord = await vcModel.getVCByTenderId(tenderId);
        if (!vcRecord) throw new Error(`No VC found for tender ${tenderId}`);

        // Generate credential offer
        const offerData = await this.generateCredentialOffer(vcRecord, tender, db);

        // Send notification
        const { emailSent } = await this.sendWalletDeliveryNotification(tender, offerData, db);

        // Update tender_documents with wallet offer details
        await db.query(`
            INSERT INTO tender_documents 
            (tender_id, document_type, original_filename, stored_path, file_size, mime_type)
            VALUES ($1, $2, $3, $4, $5, $6)
        `, [
            tender.id,
            'OTHER',
            'wallet_offer.json',
            offerData.shortURL,
            JSON.stringify(offerData.offerJSON).length,
            'application/json'
        ]);

        // Audit log
        await db.query(`
            INSERT INTO audit_log (official_id, action, tender_id, vc_id, new_value)
            VALUES ($1, $2, $3, $4, $5)
        `, [
            null, // system action
            'WALLET_OFFER_GENERATED',
            tender.id,
            vcRecord.id,
            JSON.stringify({
                shortURL: offerData.shortURL,
                offerExpiry: new Date(Date.now() + PRE_AUTH_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
                emailSent
            })
        ]);

        logger.info(`Wallet delivery complete for tender ${tenderId}. Email sent: ${emailSent}`);

        return {
            offered: true,
            notificationSent: emailSent,
            shortURL: offerData.shortURL,
            deeplink: offerData.deeplink
        };
    }
}

export default new WalletDeliveryService();
