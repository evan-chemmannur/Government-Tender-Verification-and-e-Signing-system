/**
 * verificationService.test.js — Tests for client-side VC verification.
 *
 * Spec-required tests:
 * 1. Decode PixelPass QR returns correct VC
 * 2. resolveIssuerDID fetches correct public key
 * 3. verifyVCSignature returns true for valid signature
 * 4. verifyVCSignature returns false for tampered VC
 * 5. checkRevocationStatus returns true for bit=1 (revoked)
 * 6. checkRevocationStatus returns false for bit=0 (valid)
 *
 * Additional coverage:
 * 7. decodePixelPassQR handles plain JSON VC directly
 * 8. decodePixelPassQR throws on invalid input
 * 9. resolveIssuerDID caches results (no duplicate fetches)
 * 10. resolveIssuerDID throws on network error
 * 11. checkRevocationStatus handles missing credentialStatus gracefully
 * 12. verifyTenderAward orchestrates all steps and returns correct verdict
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import pako from 'pako';

// ── vi.mock declarations (hoisted to top by vitest) ──────
vi.mock('jose', () => ({
    importJWK: vi.fn().mockResolvedValue({ type: 'public' }),
    compactVerify: vi.fn().mockRejectedValue(new Error('detached jws')),
    decodeProtectedHeader: vi.fn()
}));

// ── Mock fetch globally ──────────────────────────────────
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── Mock crypto.subtle (read-only in jsdom — use defineProperty) ──
const mockVerify = vi.fn();
const mockImportKey = vi.fn().mockResolvedValue({ type: 'public' });

Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: {
        subtle: {
            importKey: mockImportKey,
            verify: mockVerify,
        },
    },
});

// ── Mock pako (use real implementation for gzip round-trips) ──
// (pako is real — actual gzip compression is tested)


import {
    decodePixelPassQR,
    resolveIssuerDID,
    verifyVCSignature,
    checkRevocationStatus,
    verifyTenderAward,
    clearVerificationCaches
} from '../src/services/verificationService';

// ── Helpers ──────────────────────────────────────────────

/** Build a gzip-compressed base64url-encoded status list with specific bit set */
function buildStatusListEncodedList(revokeBitIndex = null) {
    const byteLength = Math.ceil(100_000 / 8);
    const bitArray = new Uint8Array(byteLength);
    if (revokeBitIndex !== null) {
        const bytePos = Math.floor(revokeBitIndex / 8);
        const bitPos = revokeBitIndex % 8;
        bitArray[bytePos] |= (1 << (7 - bitPos));
    }
    const compressed = pako.gzip(bitArray);
    return btoa(String.fromCharCode(...compressed))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/** Build a minimal valid VC object */
function buildVC(overrides = {}) {
    return {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        id: 'urn:uuid:test-vc-1',
        type: ['VerifiableCredential', 'TenderAwardCredential'],
        issuer: 'did:web:tender.maharashtra.gov.in',
        issuanceDate: '2026-01-15T00:00:00Z',
        credentialSubject: {
            tenderId: 'TENDER-2026-PWD-001',
            title: 'Road Construction Project',
            awardedToName: 'ABC Construction Ltd',
        },
        credentialStatus: {
            type: 'BitstringStatusListEntry',
            statusListCredential: 'https://tender.maharashtra.gov.in/.well-known/statuslist/2026',
            statusListIndex: 42
        },
        proof: {
            type: 'Ed25519Signature2020',
            created: '2026-01-15T00:00:00Z',
            verificationMethod: 'did:web:tender.maharashtra.gov.in#key-1',
            proofPurpose: 'assertionMethod',
            proofValue: 'dGVzdHNpZ25hdHVyZQ' // base64url of "testsignature"
        },
        ...overrides
    };
}

/** Mock DID document response */
const MOCK_DID_DOC = {
    '@context': ['https://www.w3.org/ns/did/v1'],
    id: 'did:web:tender.maharashtra.gov.in',
    verificationMethod: [{
        id: 'did:web:tender.maharashtra.gov.in#key-1',
        type: 'JsonWebKey2020',
        controller: 'did:web:tender.maharashtra.gov.in',
        publicKeyJwk: {
            kty: 'OKP',
            crv: 'Ed25519',
            x: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' // test key
        }
    }],
    assertionMethod: ['did:web:tender.maharashtra.gov.in#key-1']
};

/** Mock status list VC response */
function buildStatusListVC(revokeBitIndex = null) {
    return {
        '@context': ['https://www.w3.org/2018/credentials/v1'],
        type: ['VerifiableCredential', 'BitstringStatusListCredential'],
        credentialSubject: {
            type: 'BitstringStatusList',
            statusPurpose: 'revocation',
            encodedList: buildStatusListEncodedList(revokeBitIndex)
        }
    };
}

// ────────────────────────────────────────────────────────
// Reset caches and mocks before each test
// ────────────────────────────────────────────────────────
beforeEach(() => {
    clearVerificationCaches();
    mockFetch.mockReset();
    mockVerify.mockReset();
    vi.clearAllMocks();
});

// ════════════════════════════════════════════════════════
describe('verificationService', () => {

    // ──────────────────────────────────────────────────────
    // Spec Test 1: Decode PixelPass QR returns correct VC
    // ──────────────────────────────────────────────────────
    describe('decodePixelPassQR', () => {
        it('Decode PixelPass QR returns correct VC (gzip compressed)', async () => {
            const vc = buildVC();
            const json = JSON.stringify(vc);
            // Simulate PixelPass encoding: gzip → base64url
            const compressed = pako.gzip(json);
            const encoded = btoa(String.fromCharCode(...compressed))
                .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

            const decoded = await decodePixelPassQR(encoded);
            expect(decoded.id).toBe('urn:uuid:test-vc-1');
            expect(decoded.credentialSubject.tenderId).toBe('TENDER-2026-PWD-001');
        });

        it('should handle plain JSON VC directly (no compression)', async () => {
            const vc = buildVC();
            const decoded = await decodePixelPassQR(JSON.stringify(vc));
            expect(decoded.id).toBe(vc.id);
        });

        it('should throw on invalid/empty input', async () => {
            await expect(decodePixelPassQR('')).rejects.toThrow('Invalid QR payload');
            await expect(decodePixelPassQR(null)).rejects.toThrow('Invalid QR payload');
        });

        it('should throw on undecodable binary garbage', async () => {
            // Valid base64url but not valid gzip or JSON
            await expect(decodePixelPassQR('not-valid-anything-AAA')).rejects.toThrow();
        });
    });

    // ──────────────────────────────────────────────────────
    // Spec Test 2: resolveIssuerDID fetches correct public key
    // ──────────────────────────────────────────────────────
    describe('resolveIssuerDID', () => {
        it('resolveIssuerDID fetches correct public key from DID document', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => MOCK_DID_DOC
            });

            const result = await resolveIssuerDID('did:web:tender.maharashtra.gov.in');

            expect(mockFetch).toHaveBeenCalledWith(
                'https://tender.maharashtra.gov.in/.well-known/did.json',
                expect.objectContaining({ signal: expect.any(AbortSignal) })
            );
            expect(result.publicKeyJwk).toEqual(MOCK_DID_DOC.verificationMethod[0].publicKeyJwk);
            expect(result.verificationMethod).toBe('did:web:tender.maharashtra.gov.in#key-1');
        });

        it('should cache DID resolution — no duplicate fetches', async () => {
            mockFetch.mockResolvedValue({ ok: true, json: async () => MOCK_DID_DOC });

            await resolveIssuerDID('did:web:tender.maharashtra.gov.in');
            await resolveIssuerDID('did:web:tender.maharashtra.gov.in');

            expect(mockFetch).toHaveBeenCalledTimes(1); // cached second time
        });

        it('should throw "Cannot verify — network error" on fetch failure', async () => {
            mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
            await expect(resolveIssuerDID('did:web:tender.maharashtra.gov.in'))
                .rejects.toThrow('Cannot verify — network error');
        });

        it('should throw for non-did:web methods', async () => {
            await expect(resolveIssuerDID('did:key:z6Mkf1'))
                .rejects.toThrow('Unsupported DID method');
        });
    });

    // ──────────────────────────────────────────────────────
    // Spec Test 3: verifyVCSignature returns true for valid signature
    // ──────────────────────────────────────────────────────
    describe('verifyVCSignature', () => {
        const publicKeyJwk = MOCK_DID_DOC.verificationMethod[0].publicKeyJwk;

        it('verifyVCSignature returns true for valid signature', async () => {
            // crypto.subtle.verify returns true = valid signature
            mockVerify.mockResolvedValueOnce(true);

            const vc = buildVC();
            const result = await verifyVCSignature(vc, publicKeyJwk);

            expect(result.valid).toBe(true);
        });

        it('verifyVCSignature returns false for tampered VC (invalid signature)', async () => {
            // crypto.subtle.verify returns false = invalid
            mockVerify.mockResolvedValueOnce(false);

            const vc = buildVC();
            const result = await verifyVCSignature(vc, publicKeyJwk);

            expect(result.valid).toBe(false);
        });

        it('should return false for development placeholder proof', async () => {
            const vc = buildVC({
                proof: {
                    type: 'Ed25519Signature2020',
                    proofValue: 'UNSIGNED_DEVELOPMENT_PLACEHOLDER',
                    proofPurpose: 'assertionMethod',
                    verificationMethod: 'did:web:tender.maharashtra.gov.in#key-1'
                }
            });
            const result = await verifyVCSignature(vc, publicKeyJwk);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('placeholder');
        });

        it('should return false when VC has no proof field', async () => {
            const vc = buildVC({ proof: undefined });
            const result = await verifyVCSignature(vc, publicKeyJwk);
            expect(result.valid).toBe(false);
            expect(result.error).toContain('no proof');
        });
    });

    // ──────────────────────────────────────────────────────
    // Spec Test 5 & 6: checkRevocationStatus bit checks
    // ──────────────────────────────────────────────────────
    describe('checkRevocationStatus', () => {
        it('checkRevocationStatus returns revoked=true when bit=1 (credential revoked)', async () => {
            const revokedStatusVC = buildStatusListVC(42); // bit 42 set
            mockFetch.mockResolvedValueOnce({ ok: true, json: async () => revokedStatusVC });

            const vc = buildVC(); // has statusListIndex: 42
            const result = await checkRevocationStatus(vc);

            expect(result.revoked).toBe(true);
        });

        it('checkRevocationStatus returns revoked=false when bit=0 (credential valid)', async () => {
            const validStatusVC = buildStatusListVC(null); // no bits set
            mockFetch.mockResolvedValueOnce({ ok: true, json: async () => validStatusVC });

            const vc = buildVC(); // has statusListIndex: 42, but bit 42 is 0
            const result = await checkRevocationStatus(vc);

            expect(result.revoked).toBe(false);
        });

        it('should return revoked=false and error when fetch fails', async () => {
            mockFetch.mockRejectedValueOnce(new Error('Network failure'));

            const vc = buildVC();
            const result = await checkRevocationStatus(vc);

            expect(result.revoked).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('should handle missing credentialStatus gracefully (assume valid)', async () => {
            const vc = buildVC({ credentialStatus: undefined });
            const result = await checkRevocationStatus(vc);

            expect(result.revoked).toBe(false);
            expect(result.detail).toContain('assuming valid');
        });

        it('should cache status list — no duplicate fetches for same URL', async () => {
            const validStatusVC = buildStatusListVC(null);
            mockFetch.mockResolvedValue({ ok: true, json: async () => validStatusVC });

            const vc = buildVC();
            await checkRevocationStatus(vc);
            await checkRevocationStatus(vc); // second call should use cache

            expect(mockFetch).toHaveBeenCalledTimes(1);
        });
    });

    // ──────────────────────────────────────────────────────
    // Spec Test: verifyTenderAward orchestration
    // ──────────────────────────────────────────────────────
    describe('verifyTenderAward', () => {
        it('returns GENUINE verdict for valid, unrevoked, unexpired VC', async () => {
            // DID resolution
            mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_DID_DOC });
            // Status list
            mockFetch.mockResolvedValueOnce({ ok: true, json: async () => buildStatusListVC(null) });
            // Valid signature
            mockVerify.mockResolvedValueOnce(true);

            const vc = buildVC({
                expirationDate: '2030-01-01T00:00:00Z' // not expired
            });

            const steps = [];
            const result = await verifyTenderAward(vc, (step) => steps.push(step));

            expect(result.verdict).toBe('GENUINE');
            expect(result.claims.tenderId).toBe('TENDER-2026-PWD-001');
            expect(result.error).toBeNull();
        });

        it('returns TAMPERED verdict when signature is invalid', async () => {
            mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_DID_DOC });
            mockVerify.mockResolvedValueOnce(false); // invalid signature

            const vc = buildVC();
            const result = await verifyTenderAward(vc);

            expect(result.verdict).toBe('TAMPERED');
        });

        it('returns REVOKED verdict when status list bit=1', async () => {
            mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_DID_DOC });
            mockVerify.mockResolvedValueOnce(true); // valid signature
            mockFetch.mockResolvedValueOnce({ ok: true, json: async () => buildStatusListVC(42) }); // bit 42 set

            const vc = buildVC();
            const result = await verifyTenderAward(vc);

            expect(result.verdict).toBe('REVOKED');
        });

        it('returns ERROR verdict when DID cannot be resolved (network error)', async () => {
            mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

            const vc = buildVC();
            const result = await verifyTenderAward(vc);

            expect(result.verdict).toBe('ERROR');
            expect(result.error).toContain('Cannot verify');
        });

        it('calls onStep callback for each step in sequence', async () => {
            mockFetch.mockResolvedValueOnce({ ok: true, json: async () => MOCK_DID_DOC });
            mockFetch.mockResolvedValueOnce({ ok: true, json: async () => buildStatusListVC(null) });
            mockVerify.mockResolvedValueOnce(true);

            const stepNames = [];
            const vc = buildVC({ expirationDate: '2030-01-01T00:00:00Z' });
            await verifyTenderAward(vc, (step) => {
                if (step.running) stepNames.push(step.name);
            });

            expect(stepNames).toContain('Decoding QR code...');
            expect(stepNames).toContain('Verifying cryptographic signature...');
            expect(stepNames).toContain('Checking revocation status...');
        });
    });
});
