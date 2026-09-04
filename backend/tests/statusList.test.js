/**
 * statusList.test.js — Tests for W3C BitString Status List.
 *
 * Spec-required coverage:
 * 1. Initial status list: all bits are 0
 * 2. Set bit at index 0: bit 0 = 1, bit 1 = 0
 * 3. Set bit at index 4092: correct byte and bit position
 * 4. Clear bit: bit returns to 0
 * 5. Compress/decompress round-trip is lossless
 * 6. revokeVC updates database correctly (revoked_at, revoked_by, revoke_reason)
 * 7. Public endpoint returns correct Cache-Control header (route-level HTTP test)
 *
 * Additional coverage:
 * 8. In-process cache invalidated by setBit
 * 9. signStatusListVC produces LD Proof with proofValue (not raw JWS string)
 * 10. buildStatusListVC returns unsigned VC (no proof field)
 * 11. Double-proof guard: strips existing proof before re-signing
 * 12. allocateIndex return shape matches spec { statusListCredential, statusListIndex }
 */

import { jest } from '@jest/globals';
import zlib from 'zlib';
import statusListService from '../src/services/statusListService.js';

// ─────────────────────────────────────────────────────────
// Helper: create a fresh gzip-compressed base64url-encoded bit array
// ─────────────────────────────────────────────────────────
function createTestEncodedList(size = 100_000) {
    const byteLength = Math.ceil(size / 8);
    const bitArray = Buffer.alloc(byteLength, 0);
    const compressed = zlib.gzipSync(bitArray);
    return Buffer.from(compressed).toString('base64url');
}

// ─────────────────────────────────────────────────────────
// Mock DB factory — fresh instance per test, mirrors schema
// ─────────────────────────────────────────────────────────
function createMockDb() {
    const store = {}; // status_list_credentials — keyed by year

    const mockQuery = jest.fn(async (sql, params) => {
        // getOrCreateStatusList: SELECT *
        if (sql.includes('SELECT * FROM status_list_credentials WHERE year')) {
            const year = params[0];
            if (store[year]) return { rowCount: 1, rows: [store[year]] };
            return { rowCount: 0, rows: [] };
        }
        // getOrCreateStatusList: INSERT
        if (sql.includes('INSERT INTO status_list_credentials')) {
            const [listId, year, encodedList, vcJson, capacity] = params;
            store[year] = {
                id: `sl-${year}`,
                list_id: listId,
                year,
                encoded_list: encodedList,
                vc_json: vcJson,
                next_available_index: 0,
                capacity
            };
            return { rowCount: 1, rows: [store[year]] };
        }
        // allocateIndex: SELECT FOR UPDATE
        if (sql.includes('FOR UPDATE')) {
            const year = params[0];
            if (store[year] && store[year].next_available_index < store[year].capacity) {
                return { rowCount: 1, rows: [store[year]] };
            }
            return { rowCount: 0, rows: [] };
        }
        // allocateIndex: UPDATE next_available_index
        if (sql.includes('next_available_index = next_available_index + 1')) {
            const id = params[0];
            const year = Object.keys(store).find(k => store[k].id === id);
            if (year) store[year].next_available_index += 1;
            return { rowCount: 1 };
        }
        // setBit: SELECT id, encoded_list
        if (sql.includes('SELECT id, encoded_list FROM status_list_credentials')) {
            const year = params[0];
            if (store[year]) {
                return { rowCount: 1, rows: [{ id: store[year].id, encoded_list: store[year].encoded_list }] };
            }
            return { rowCount: 0, rows: [] };
        }
        // setBit: UPDATE encoded_list
        if (sql.includes('SET encoded_list')) {
            const [encodedList, vcJson, id] = params;
            const year = Object.keys(store).find(k => store[k].id === id);
            if (year) {
                store[year].encoded_list = encodedList;
                store[year].vc_json = vcJson;
            }
            return { rowCount: 1 };
        }
        // revokeVC: SELECT vc_records
        if (sql.includes('SELECT * FROM vc_records')) {
            return {
                rowCount: 1,
                rows: [{
                    id: 'vc-uuid-1',
                    tender_id: params[0],
                    credential_id: 'urn:uuid:cred-1',
                    status_list_index: 42,
                    issued_at: '2026-03-15T00:00:00Z',
                    revoked_at: null
                }]
            };
        }
        // revokeVC: UPDATE vc_records
        if (sql.includes('UPDATE vc_records')) {
            const [officialId, reason, tenderId] = params;
            return {
                rowCount: 1,
                rows: [{
                    id: 'vc-uuid-1',
                    tender_id: tenderId,
                    revoked_at: new Date().toISOString(),
                    revoked_by: officialId,
                    revoke_reason: reason
                }]
            };
        }
        // Audit log
        if (sql.includes('INSERT INTO audit_log')) {
            return { rowCount: 1 };
        }
        // getPublicStatusList: SELECT vc_json
        if (sql.includes('SELECT vc_json')) {
            const year = params[0];
            if (store[year]) {
                return { rowCount: 1, rows: [{ vc_json: store[year].vc_json, encoded_list: store[year].encoded_list }] };
            }
            return { rowCount: 0, rows: [] };
        }
        return { rowCount: 0, rows: [] };
    });

    return { query: mockQuery, _store: store };
}

// Clear in-process cache + restore all jest spies between every test
beforeEach(() => {
    statusListService._getCacheForTest().clear();
});
afterEach(() => {
    jest.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────
// Minimal test Express app for route-level tests.
// Avoids the full app.js which requires a live Postgres connection
// for session middleware. Only mounts the statusList router.
// ─────────────────────────────────────────────────────────
async function buildTestApp() {
    const { default: express } = await import('express');
    const { default: statusListRouter } = await import('../src/routes/statusList.js');
    const testApp = express();
    testApp.use(express.json());
    testApp.use('/', statusListRouter);
    return testApp;
}

// ═══════════════════════════════════════════════════════════
describe('BitString Status List Service', () => {
    const TEST_YEAR = 2026;

    // ─────────────────────────────────────────────────────
    // Spec test 1: Initial status list — all bits are 0
    // ─────────────────────────────────────────────────────
    describe('checkBit (pure function)', () => {
        it('Initial status list: all bits are 0', () => {
            const encodedList = createTestEncodedList();
            expect(statusListService.checkBit(encodedList, 0)).toBe(0);
            expect(statusListService.checkBit(encodedList, 1)).toBe(0);
            expect(statusListService.checkBit(encodedList, 99)).toBe(0);
            expect(statusListService.checkBit(encodedList, 4092)).toBe(0);
            expect(statusListService.checkBit(encodedList, 99_999)).toBe(0);
        });

        it('should throw for out-of-range index', () => {
            const encodedList = createTestEncodedList(8); // 1 byte only
            expect(() => statusListService.checkBit(encodedList, 8)).toThrow('out of range');
        });
    });

    // ─────────────────────────────────────────────────────
    // Spec tests 2, 3, 4
    // ─────────────────────────────────────────────────────
    describe('Bit manipulation round-trip', () => {
        it('Set bit at index 0: bit 0 = 1, bit 1 = 0', async () => {
            const db = createMockDb();
            await statusListService.getOrCreateStatusList(TEST_YEAR, db);
            await statusListService.setBit(0, 1, TEST_YEAR, db);

            const encodedList = db._store[TEST_YEAR].encoded_list;
            expect(statusListService.checkBit(encodedList, 0)).toBe(1);
            expect(statusListService.checkBit(encodedList, 1)).toBe(0);
        });

        it('Set bit at index 4092: correct byte and bit position', async () => {
            const db = createMockDb();
            await statusListService.getOrCreateStatusList(TEST_YEAR, db);
            await statusListService.setBit(4092, 1, TEST_YEAR, db);

            const encodedList = db._store[TEST_YEAR].encoded_list;
            // bytePos = Math.floor(4092/8) = 511, bitPos = 4092%8 = 4
            expect(statusListService.checkBit(encodedList, 4092)).toBe(1);
            expect(statusListService.checkBit(encodedList, 4091)).toBe(0);
            expect(statusListService.checkBit(encodedList, 4093)).toBe(0);
        });

        it('Clear bit: bit returns to 0', async () => {
            const db = createMockDb();
            await statusListService.getOrCreateStatusList(TEST_YEAR, db);

            await statusListService.setBit(100, 1, TEST_YEAR, db);
            expect(statusListService.checkBit(db._store[TEST_YEAR].encoded_list, 100)).toBe(1);

            await statusListService.setBit(100, 0, TEST_YEAR, db);
            expect(statusListService.checkBit(db._store[TEST_YEAR].encoded_list, 100)).toBe(0);
        });
    });

    // ─────────────────────────────────────────────────────
    // Spec test 5: lossless round-trip
    // ─────────────────────────────────────────────────────
    describe('Compress/decompress round-trip', () => {
        it('Compress/decompress round-trip is lossless', () => {
            const byteLength = Math.ceil(100_000 / 8);
            const original = Buffer.alloc(byteLength, 0);
            original[0] = 0b10101010;
            original[1000] = 0b11001100;
            original[byteLength - 1] = 0b00001111;

            const compressed = zlib.gzipSync(original);
            const encodedList = Buffer.from(compressed).toString('base64url');
            const decoded = Buffer.from(encodedList, 'base64url');
            const decompressed = zlib.gunzipSync(decoded);

            expect(Buffer.compare(original, decompressed)).toBe(0);
        });
    });

    // ─────────────────────────────────────────────────────
    // Spec test 6: revokeVC updates database correctly
    // Explicitly asserts revoked_at, revoked_by, revoke_reason
    // ─────────────────────────────────────────────────────
    describe('revokeVC', () => {
        it('revokeVC updates database correctly: revoked_at, revoked_by, revoke_reason', async () => {
            const db = createMockDb();
            await statusListService.getOrCreateStatusList(TEST_YEAR, db);

            const result = await statusListService.revokeVC(
                'tender-uuid-1', 'FRAUD_DETECTED', 'officer-uuid-1', db
            );

            // Explicit field assertions (spec-required)
            expect(result.revoked_at).toBeDefined();
            expect(new Date(result.revoked_at).toString()).not.toBe('Invalid Date');
            expect(result.revoked_by).toBe('officer-uuid-1');
            expect(result.revoke_reason).toBe('FRAUD_DETECTED');

            // Also verify the status list bit was set at index 42 (from mock VC)
            expect(statusListService.checkBit(db._store[TEST_YEAR].encoded_list, 42)).toBe(1);
        });

        it('should throw if VC is already revoked', async () => {
            const db = createMockDb();
            await statusListService.getOrCreateStatusList(TEST_YEAR, db);

            // Override the vc_records SELECT to simulate already-revoked state
            db.query = jest.fn(async (sql, params) => {
                if (sql.includes('SELECT * FROM vc_records')) {
                    return {
                        rowCount: 1,
                        rows: [{
                            id: 'vc-uuid-1',
                            tender_id: params[0],
                            status_list_index: 42,
                            issued_at: '2026-03-15T00:00:00Z',
                            revoked_at: '2026-03-20T00:00:00Z' // already revoked
                        }]
                    };
                }
                return { rowCount: 0, rows: [] };
            });

            await expect(
                statusListService.revokeVC('tender-uuid-1', 'FRAUD_DETECTED', 'officer-uuid-1', db)
            ).rejects.toThrow('already revoked');
        });
    });

    // ─────────────────────────────────────────────────────
    // Spec test 7: Public endpoint returns correct Cache-Control header
    // Uses a minimal test Express app (no DB/session dependency)
    // ─────────────────────────────────────────────────────
    describe('Public endpoint Cache-Control header (route-level)', () => {
        it('GET /:year returns Cache-Control: public, max-age=300', async () => {
            const { default: request } = await import('supertest');
            const testApp = await buildTestApp();

            const mockEncodedList = createTestEncodedList();
            const mockVC = {
                '@context': ['https://www.w3.org/2018/credentials/v1'],
                type: ['VerifiableCredential', 'BitstringStatusListCredential'],
                issuer: 'did:web:tender.maharashtra.gov.in',
                issuanceDate: new Date().toISOString(),
                credentialSubject: { type: 'BitstringStatusList', encodedList: mockEncodedList }
            };

            // Spy on the singleton method — properly restored in afterEach
            jest.spyOn(statusListService, 'getPublicStatusList')
                .mockResolvedValue({ vc: mockVC, encodedList: mockEncodedList });

            const response = await request(testApp)
                .get('/2026')
                .expect(200);

            // Spec-required header assertions
            expect(response.headers['cache-control']).toBe('public, max-age=300');
            expect(response.headers['content-type']).toMatch(/application\/json/);
            expect(response.headers['etag']).toBeDefined();
        });

        it('GET /:year returns 304 on matching If-None-Match', async () => {
            const { default: request } = await import('supertest');
            const testApp = await buildTestApp();

            const mockEncodedList = createTestEncodedList();

            jest.spyOn(statusListService, 'getPublicStatusList')
                .mockResolvedValue({ vc: {}, encodedList: mockEncodedList });

            // First request — capture ETag
            const firstRes = await request(testApp).get('/2026').expect(200);
            const etag = firstRes.headers['etag'];
            expect(etag).toBeDefined();

            // Second request with matching ETag — must return 304
            await request(testApp)
                .get('/2026')
                .set('If-None-Match', etag)
                .expect(304);
        });

        it('GET /:year returns 404 when no status list exists for year', async () => {
            const { default: request } = await import('supertest');
            const testApp = await buildTestApp();

            jest.spyOn(statusListService, 'getPublicStatusList')
                .mockResolvedValue(null);

            await request(testApp).get('/2099').expect(404);
        });

        it('GET /:year returns 400 for invalid year param', async () => {
            const { default: request } = await import('supertest');
            const testApp = await buildTestApp();

            await request(testApp).get('/notayear').expect(400);
        });
    });

    // ─────────────────────────────────────────────────────
    // In-process cache invalidation by setBit
    // ─────────────────────────────────────────────────────
    describe('In-process cache', () => {
        it('should be populated after getPublicStatusList and cleared by setBit', async () => {
            const db = createMockDb();
            await statusListService.getOrCreateStatusList(TEST_YEAR, db);

            // Cache should be empty before first access
            expect(statusListService._getCacheForTest().has(TEST_YEAR)).toBe(false);

            // Load into cache via getPublicStatusList (real method, real mock DB)
            const result = await statusListService.getPublicStatusList(TEST_YEAR, db);
            expect(result).not.toBeNull();
            expect(statusListService._getCacheForTest().has(TEST_YEAR)).toBe(true);

            // setBit must invalidate the cache
            await statusListService.setBit(5, 1, TEST_YEAR, db);
            expect(statusListService._getCacheForTest().has(TEST_YEAR)).toBe(false);
        });
    });

    // ─────────────────────────────────────────────────────
    // buildStatusListVC — must return UNSIGNED VC (no proof)
    // ─────────────────────────────────────────────────────
    describe('buildStatusListVC', () => {
        it('should produce an UNSIGNED W3C BitstringStatusListCredential (no proof field)', async () => {
            const encodedList = createTestEncodedList();
            const vc = await statusListService.buildStatusListVC(encodedList, TEST_YEAR);

            expect(vc['@context']).toContain('https://www.w3.org/2018/credentials/v1');
            expect(vc['@context']).toContain('https://w3id.org/vc/status-list/2021/v1');
            expect(vc.type).toContain('VerifiableCredential');
            expect(vc.type).toContain('BitstringStatusListCredential');
            expect(vc.credentialSubject.type).toBe('BitstringStatusList');
            expect(vc.credentialSubject.statusPurpose).toBe('revocation');
            expect(vc.credentialSubject.encodedList).toBe(encodedList);
            expect(vc.issuanceDate).toBeDefined();
            // Critical: must NOT have a proof field — signing is always a separate step
            expect(vc.proof).toBeUndefined();
        });
    });

    // ─────────────────────────────────────────────────────
    // signStatusListVC — LD Proof structure + double-proof guard
    // ─────────────────────────────────────────────────────
    describe('signStatusListVC', () => {
        it('should attach an Ed25519Signature2020 Linked Data Proof with proofValue (not raw JWS)', async () => {
            const vc = await statusListService.buildStatusListVC(createTestEncodedList(), TEST_YEAR);
            const signed = await statusListService.signStatusListVC(vc);

            expect(signed.proof).toBeDefined();
            expect(signed.proof.type).toBe('Ed25519Signature2020');
            expect(signed.proof.proofPurpose).toBe('assertionMethod');
            expect(signed.proof.verificationMethod).toContain('#key-1');
            expect(signed.proof.created).toBeDefined();
            // proofValue — required by LD-Proofs spec for Ed25519Signature2020
            expect(signed.proof.proofValue).toBeDefined();
            // Must NOT use 'jws' as the key — that would be a raw JWT, not an LD Proof
            expect(signed.proof).not.toHaveProperty('jws');
        });

        it('double-proof guard: stripping existing proof prevents duplicate proof accumulation', async () => {
            const vc = await statusListService.buildStatusListVC(createTestEncodedList(), TEST_YEAR);
            const firstSigned = await statusListService.signStatusListVC(vc);
            // Re-signing must strip the old proof and attach a fresh one — not nest proofs
            const reSigned = await statusListService.signStatusListVC(firstSigned);

            expect(Array.isArray(reSigned.proof)).toBe(false);
            expect(typeof reSigned.proof).toBe('object');
            expect(reSigned.proof.type).toBe('Ed25519Signature2020');
        });
    });

    // ─────────────────────────────────────────────────────
    // allocateIndex — return shape must match spec exactly
    // ─────────────────────────────────────────────────────
    describe('allocateIndex', () => {
        it('return shape matches spec exactly: { statusListCredential: URL, statusListIndex: number }', async () => {
            const db = createMockDb();
            await statusListService.getOrCreateStatusList(TEST_YEAR, db);

            const result = await statusListService.allocateIndex(TEST_YEAR, db);

            // Exact key names — certifyService.js reads these in Task 9
            expect(result).toHaveProperty('statusListCredential');
            expect(result).toHaveProperty('statusListIndex');
            expect(typeof result.statusListCredential).toBe('string');
            expect(typeof result.statusListIndex).toBe('number');
            expect(result.statusListIndex).toBe(0);
            expect(result.statusListCredential).toContain('statuslist');
        });

        it('should return sequential indices atomically', async () => {
            const db = createMockDb();
            await statusListService.getOrCreateStatusList(TEST_YEAR, db);

            const first = await statusListService.allocateIndex(TEST_YEAR, db);
            const second = await statusListService.allocateIndex(TEST_YEAR, db);
            expect(first.statusListIndex).toBe(0);
            expect(second.statusListIndex).toBe(1);
        });
    });

    // ─────────────────────────────────────────────────────
    // getOrCreateStatusList — idempotency
    // ─────────────────────────────────────────────────────
    describe('getOrCreateStatusList', () => {
        it('should create new status list with correct initial values', async () => {
            const db = createMockDb();
            const record = await statusListService.getOrCreateStatusList(TEST_YEAR, db);

            expect(record.year).toBe(TEST_YEAR);
            expect(record.next_available_index).toBe(0);
            expect(record.capacity).toBe(100_000);
            expect(record.encoded_list).toBeDefined();
        });

        it('should return existing list on second call without inserting again', async () => {
            const db = createMockDb();
            await statusListService.getOrCreateStatusList(TEST_YEAR, db);
            await statusListService.getOrCreateStatusList(TEST_YEAR, db);

            const insertCalls = db.query.mock.calls.filter(c =>
                c[0].includes('INSERT INTO status_list_credentials')
            );
            expect(insertCalls.length).toBe(1);
        });
    });

    // ─────────────────────────────────────────────────────
    // getPublicStatusList
    // ─────────────────────────────────────────────────────
    describe('getPublicStatusList', () => {
        it('should return the VC JSON and encodedList', async () => {
            const db = createMockDb();
            await statusListService.getOrCreateStatusList(TEST_YEAR, db);

            const result = await statusListService.getPublicStatusList(TEST_YEAR, db);
            expect(result).not.toBeNull();
            expect(result.vc).toBeDefined();
            expect(result.encodedList).toBeDefined();
        });

        it('should return null for non-existent year', async () => {
            const db = createMockDb();
            // No status list created for year 9999
            const result = await statusListService.getPublicStatusList(9999, db);
            expect(result).toBeNull();
        });
    });
});
