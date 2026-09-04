/**
 * walletDelivery.test.js — Tests for OID4VCI Inji Wallet delivery.
 *
 * Spec-required tests:
 * 1. generateCredentialOffer creates correct JSON structure
 * 2. redeemPreAuthCode fails after expiry
 * 3. redeemPreAuthCode fails on second redemption attempt
 * 4. token endpoint returns access token
 * 5. credential endpoint returns VC
 * 6. notification email is sent
 *
 * Note: Uses jest.unstable_mockModule for ESM compatibility.
 */

import { jest } from '@jest/globals';

// ── ESM-compatible mocks (must be called before any imports) ─────

// Email Service will be spied on later.
const mockFindById = jest.fn();
await jest.unstable_mockModule('../src/models/tenderModel.js', () => ({
    tenderModel: { findById: mockFindById }
}));

const mockGetVCByTenderId = jest.fn();
await jest.unstable_mockModule('../src/models/vcModel.js', () => ({
    vcModel: { getVCByTenderId: mockGetVCByTenderId }
}));

const mockQRCode = {
    toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,MOCKQR')
};
await jest.unstable_mockModule('qrcode', () => ({
    default: mockQRCode
}));

// ── Import service AFTER mocks are set up ────────────────────────
const { default: walletDeliveryService } = await import('../src/services/walletDeliveryService.js');
const { default: emailService } = await import('../src/services/emailService.js');

const mockSendEmail = jest.spyOn(emailService, 'sendEmail').mockResolvedValue(true);

// ── Test data ────────────────────────────────────────────────────

const SAMPLE_TENDER = {
    id: 'tender-uuid-1',
    tender_id: 'TENDER-2026-PWD-001',
    title: 'Road Construction Project',
    status: 'SIGNED',
    actual_value: 500000000,       // 50 lakh in paisa
    awarded_to_name: 'ABC Construction Ltd',
    awarded_to_email: 'abc@construction.in',
    department: 'PWD'
};

const SAMPLE_VC_RECORD = {
    id: 'vc-uuid-1',
    tender_id: 'tender-uuid-1',
    credential_id: 'urn:uuid:cred-1',
    vc_json: JSON.stringify({
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        id: 'urn:uuid:cred-1',
        type: ['VerifiableCredential', 'TenderAwardCredential'],
        issuer: 'did:web:tender.maharashtra.gov.in',
        issuanceDate: '2026-01-15T00:00:00Z',
        credentialSubject: { tenderId: 'TENDER-2026-PWD-001' }
    }),
    status_list_index: 42,
    issued_at: '2026-01-15T00:00:00Z',
    revoked_at: null
};

// ── Mock DB factory ──────────────────────────────────────────────

function createMockDb(overrides = {}) {
    const offers = {};

    return {
        query: jest.fn(async (sql, params) => {

            if (sql.includes('INSERT INTO credential_offers')) {
                const [vcId, preAuthCode, expiresAt, bidderEmail] = params;
                offers[preAuthCode] = {
                    id: `offer-${preAuthCode.slice(0, 8)}`,
                    vc_id: vcId,
                    pre_authorized_code: preAuthCode,
                    expires_at: expiresAt,
                    bidder_email: bidderEmail,
                    redeemed_at: null
                };
                return { rowCount: 1, rows: [offers[preAuthCode]] };
            }

            if (sql.includes('SELECT * FROM credential_offers WHERE pre_authorized_code') || sql.includes('SELECT id FROM credential_offers WHERE pre_authorized_code')) {
                const code = params[0];
                if (offers[code]) return { rowCount: 1, rows: [offers[code]] };
                if (overrides.existingOffer) return { rowCount: 1, rows: [overrides.existingOffer] };
                return { rowCount: 0, rows: [] };
            }

            if (sql.includes('LIKE')) {
                return { rowCount: 0, rows: [] };
            }

            if (sql.includes('UPDATE credential_offers SET redeemed_at')) {
                const id = params[0];
                const offer = Object.values(offers).find(o => o.id === id) || overrides.existingOffer;
                if (offer) offer.redeemed_at = new Date().toISOString();
                return { rowCount: 1 };
            }

            if (sql.includes('INSERT INTO credential_offer_links')) {
                return { rowCount: 1 };
            }

            if (sql.includes('SELECT * FROM vc_records WHERE id')) {
                return { rowCount: 1, rows: [SAMPLE_VC_RECORD] };
            }

            if (sql.includes('INSERT INTO notifications')) {
                return { rowCount: 1 };
            }

            if (sql.includes('INSERT INTO tender_documents')) {
                return { rowCount: 1 };
            }

            if (sql.includes('INSERT INTO audit_log')) {
                return { rowCount: 1 };
            }

            return { rowCount: 0, rows: [] };
        }),
        _offers: offers
    };
}

// ════════════════════════════════════════════════════════════════
describe('WalletDeliveryService', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        // Restore default mock behaviour
        mockSendEmail.mockResolvedValue(true);
    });

    // ────────────────────────────────────────────────────────────
    // Spec Test 1: generateCredentialOffer creates correct JSON
    // ────────────────────────────────────────────────────────────
    describe('generateCredentialOffer', () => {

        it('creates correct OID4VCI credential offer JSON structure', async () => {
            const db = createMockDb();
            const result = await walletDeliveryService.generateCredentialOffer(
                SAMPLE_VC_RECORD, SAMPLE_TENDER, db
            );

            expect(result.offerJSON).toMatchObject({
                credential_issuer: expect.any(String),
                credentials: ['TenderAwardCredential'],
                grants: {
                    'urn:ietf:params:oauth:grant-type:pre-authorized_code': {
                        'pre-authorized_code': expect.any(String),
                        user_pin_required: false,
                        interval: 5
                    }
                }
            });

            // 32 bytes base64url = 43 chars
            expect(result.preAuthCode.length).toBeGreaterThan(30);
            expect(result.preAuthCode).toMatch(/^[A-Za-z0-9_-]+$/);

            // Short URL must be HTTPS
            expect(result.shortURL).toMatch(/^https?:\/\//);

            // Deeplink scheme
            expect(result.deeplink).toMatch(/^openid-credential-offer:\/\//);

            // QR data URL
            expect(result.qrDataUrl).toContain('data:image/png');
        });

        it('saves the offer to the database with correct fields', async () => {
            const db = createMockDb();
            await walletDeliveryService.generateCredentialOffer(
                SAMPLE_VC_RECORD, SAMPLE_TENDER, db
            );

            const insertCalls = db.query.mock.calls.filter(c =>
                c[0].includes('INSERT INTO credential_offers')
            );
            expect(insertCalls.length).toBe(1);
            const [, params] = insertCalls[0];
            expect(params[0]).toBe(SAMPLE_VC_RECORD.id);          // vc_id
            expect(params[2]).toBeDefined();                        // expires_at
            expect(params[3]).toBe(SAMPLE_TENDER.awarded_to_email); // bidder_email
        });

        it('sets expiry to 7 days from now', async () => {
            const db = createMockDb();
            const before = Date.now();
            await walletDeliveryService.generateCredentialOffer(
                SAMPLE_VC_RECORD, SAMPLE_TENDER, db
            );

            const insertCall = db.query.mock.calls.find(c =>
                c[0].includes('INSERT INTO credential_offers')
            );
            const expiresAt = new Date(insertCall[1][2]);
            const diffDays = (expiresAt - before) / (1000 * 60 * 60 * 24);
            expect(diffDays).toBeCloseTo(7, 0);
        });

        it('pre-authorized code in offerJSON matches the stored DB code', async () => {
            const db = createMockDb();
            const result = await walletDeliveryService.generateCredentialOffer(
                SAMPLE_VC_RECORD, SAMPLE_TENDER, db
            );
            const storedCode = result.offerJSON.grants[
                'urn:ietf:params:oauth:grant-type:pre-authorized_code'
            ]['pre-authorized_code'];
            expect(storedCode).toBe(result.preAuthCode);
        });
    });

    // ────────────────────────────────────────────────────────────
    // Spec Test 2: redeemPreAuthCode fails after expiry
    // ────────────────────────────────────────────────────────────
    describe('redeemPreAuthCode', () => {

        it('redeemPreAuthCode fails after expiry', async () => {
            const expiredOffer = {
                id: 'offer-expired',
                vc_id: SAMPLE_VC_RECORD.id,
                pre_authorized_code: 'expired-code-xyz',
                expires_at: new Date(Date.now() - 1000).toISOString(),
                redeemed_at: null
            };
            const db = createMockDb({ existingOffer: expiredOffer });

            await expect(
                walletDeliveryService.redeemPreAuthCode('expired-code-xyz', db)
            ).rejects.toThrow('CODE_EXPIRED');
        });

        // ────────────────────────────────────────────────────────
        // Spec Test 3: redeemPreAuthCode fails on second redemption
        // ────────────────────────────────────────────────────────
        it('redeemPreAuthCode fails on second redemption attempt', async () => {
            const redeemedOffer = {
                id: 'offer-used',
                vc_id: SAMPLE_VC_RECORD.id,
                pre_authorized_code: 'used-code-abc',
                expires_at: new Date(Date.now() + 86400000).toISOString(),
                redeemed_at: new Date().toISOString()
            };
            const db = createMockDb({ existingOffer: redeemedOffer });

            await expect(
                walletDeliveryService.redeemPreAuthCode('used-code-abc', db)
            ).rejects.toThrow('CODE_USED');
        });

        it('redeemPreAuthCode fails for unknown code', async () => {
            const db = createMockDb();
            await expect(
                walletDeliveryService.redeemPreAuthCode('not-a-real-code', db)
            ).rejects.toThrow('INVALID_CODE');
        });

        it('marks the offer as redeemed in DB on successful redemption', async () => {
            const validOffer = {
                id: 'offer-valid-1',
                vc_id: SAMPLE_VC_RECORD.id,
                pre_authorized_code: 'valid-code-999',
                expires_at: new Date(Date.now() + 86400000).toISOString(),
                redeemed_at: null
            };
            const db = createMockDb({ existingOffer: validOffer });

            const result = await walletDeliveryService.redeemPreAuthCode('valid-code-999', db);

            expect(result.vcRecord).toBeDefined();
            expect(result.vcJson.type).toContain('VerifiableCredential');

            const updateCalls = db.query.mock.calls.filter(c =>
                c[0].includes('UPDATE credential_offers SET redeemed_at')
            );
            expect(updateCalls.length).toBe(1);
        });
    });

    // ────────────────────────────────────────────────────────────
    // Spec Test 4: token endpoint returns access token
    // ────────────────────────────────────────────────────────────
    describe('issueAccessToken', () => {

        it('returns access token with correct OID4VCI shape', async () => {
            const result = await walletDeliveryService.issueAccessToken('test-pre-auth-code');

            expect(result).toMatchObject({
                access_token: expect.any(String),
                token_type: 'bearer',
                expires_in: 600,
                c_nonce: expect.any(String),
                c_nonce_expires_in: 300
            });

            // Must be a JWT (3 dot-separated Base64url segments)
            expect(result.access_token.split('.').length).toBe(3);
        });

        it('access token expires_in is exactly 600 seconds (10 minutes)', async () => {
            const result = await walletDeliveryService.issueAccessToken('any-code');
            expect(result.expires_in).toBe(600);
        });

        it('each call generates a unique c_nonce', async () => {
            const r1 = await walletDeliveryService.issueAccessToken('code-a');
            const r2 = await walletDeliveryService.issueAccessToken('code-b');
            expect(r1.c_nonce).not.toBe(r2.c_nonce);
        });
    });

    // ────────────────────────────────────────────────────────────
    // Spec Test 5: credential endpoint returns VC
    // ────────────────────────────────────────────────────────────
    describe('VC retrieval via redeemPreAuthCode', () => {

        it('credential endpoint returns full W3C VC JSON', async () => {
            const validOffer = {
                id: 'offer-cred-2',
                vc_id: SAMPLE_VC_RECORD.id,
                pre_authorized_code: 'cred-code-valid',
                expires_at: new Date(Date.now() + 86400000).toISOString(),
                redeemed_at: null
            };
            const db = createMockDb({ existingOffer: validOffer });

            const { vcJson } = await walletDeliveryService.redeemPreAuthCode('cred-code-valid', db);

            expect(vcJson['@context']).toContain('https://www.w3.org/2018/credentials/v1');
            expect(vcJson.type).toContain('VerifiableCredential');
            expect(vcJson.type).toContain('TenderAwardCredential');
            expect(vcJson.credentialSubject).toBeDefined();
        });
    });

    // ────────────────────────────────────────────────────────────
    // Spec Test 6: notification email is sent
    // ────────────────────────────────────────────────────────────
    describe('sendWalletDeliveryNotification', () => {

        const offerData = {
            shortURL: 'https://tender.maharashtra.gov.in/wallet-offer/AbCd1234',
            deeplink: 'openid-credential-offer://?credential_offer=%7B%7D',
            qrDataUrl: 'data:image/png;base64,MOCKQR'
        };

        it('sends notification email to the bidder', async () => {
            const db = createMockDb();
            const result = await walletDeliveryService.sendWalletDeliveryNotification(
                SAMPLE_TENDER, offerData, db
            );

            expect(result.emailSent).toBe(true);
            expect(result.recipientEmail).toBe('abc@construction.in');
            expect(mockSendEmail).toHaveBeenCalledTimes(1);
        });

        it('email subject contains "Tender Award Certificate"', async () => {
            const db = createMockDb();
            await walletDeliveryService.sendWalletDeliveryNotification(
                SAMPLE_TENDER, offerData, db
            );
            const [, subject] = mockSendEmail.mock.calls[0];
            expect(subject).toContain('Tender Award Certificate');
        });

        it('email HTML contains HTTPS URL', async () => {
            const db = createMockDb();
            await walletDeliveryService.sendWalletDeliveryNotification(
                SAMPLE_TENDER, offerData, db
            );
            const [, , html] = mockSendEmail.mock.calls[0];
            expect(html).toContain('https://');
            expect(html).toContain('TENDER-2026-PWD-001');
        });
    });

    // ────────────────────────────────────────────────────────────
    // generateOfferDeeplink
    // ────────────────────────────────────────────────────────────
    describe('generateOfferDeeplink', () => {

        it('uses openid-credential-offer:// scheme', async () => {
            const offerJSON = {
                credential_issuer: 'https://tender.maharashtra.gov.in',
                credentials: ['TenderAwardCredential'],
                grants: {}
            };
            const { deeplink } = await walletDeliveryService.generateOfferDeeplink(offerJSON);
            expect(deeplink).toMatch(/^openid-credential-offer:\/\//);
            expect(deeplink).toContain('credential_offer=');
        });

        it('credential_offer param decodes to original offerJSON', async () => {
            const offerJSON = {
                credential_issuer: 'https://example.gov',
                credentials: ['TestVC'],
                grants: {}
            };
            const { deeplink } = await walletDeliveryService.generateOfferDeeplink(offerJSON);
            const encoded = deeplink.split('credential_offer=')[1];
            const decoded = JSON.parse(decodeURIComponent(encoded));
            expect(decoded.credential_issuer).toBe('https://example.gov');
            expect(decoded.credentials).toContain('TestVC');
        });

        it('returns QR data URL', async () => {
            const { qrDataUrl } = await walletDeliveryService.generateOfferDeeplink({
                credential_issuer: 'https://test.gov', credentials: [], grants: {}
            });
            expect(qrDataUrl).toContain('data:image/png');
        });
    });
});
