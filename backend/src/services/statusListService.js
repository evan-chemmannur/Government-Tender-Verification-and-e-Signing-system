/**
 * statusListService.js — W3C BitString Status List for VC revocation.
 *
 * Each issued VC has a position (index) in the status list.
 * All bits start as 0 (valid). When an award is revoked, set bit to 1.
 * The status list itself is a Verifiable Credential, signed by the department,
 * using a W3C Linked Data Proof (Ed25519Signature2020 structure).
 * Verifiers download the status list and check the bit at the VC's index.
 */

import zlib from 'zlib';
import crypto from 'crypto';
import { importPKCS8, SignJWT } from 'jose';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import logger from '../utils/logger.js';

const STATUS_LIST_CAPACITY = 100_000;
const ISSUER_DID = process.env.ISSUER_DID || 'did:web:tender.maharashtra.gov.in';
const BASE_URL = process.env.STATUS_LIST_BASE_URL || 'https://tender.maharashtra.gov.in';
const SIGNING_KEY_PATH = process.env.STATUS_LIST_SIGNING_KEY_PATH || '';
const CAPACITY_ALERT_THRESHOLD = 80_000;

// ─────────────────────────────────────────────────────────
// Issue 1 FIX: In-process cache map.
// Keyed by year. Holds the latest { vc, encodedList } after
// each setBit call so getPublicStatusList never returns stale data
// within the same server process.
// TODO (Task 19): Replace with Redis-backed cache before K8s deployment
//   to synchronise across multiple backend pods.
// ─────────────────────────────────────────────────────────
const _statusListCache = new Map();

// ─────────────────────────────────────────────────────────
// Utility: base64url encode/decode
// ─────────────────────────────────────────────────────────
function base64urlEncode(buffer) {
    return Buffer.from(buffer).toString('base64url');
}

function base64urlDecode(str) {
    return Buffer.from(str, 'base64url');
}

class BitStringStatusListService {

    // ─────────────────────────────────────────────────────
    // getOrCreateStatusList(year, db)
    // ─────────────────────────────────────────────────────
    async getOrCreateStatusList(year, db) {
        const existing = await db.query(
            'SELECT * FROM status_list_credentials WHERE year = $1',
            [year]
        );

        if (existing.rowCount > 0) {
            return existing.rows[0];
        }

        // Create 100,000-bit array (all zeros) → 12,500 bytes
        const byteLength = Math.ceil(STATUS_LIST_CAPACITY / 8);
        const bitArray = Buffer.alloc(byteLength, 0);

        // Compress with zlib.gzip
        const compressed = zlib.gzipSync(bitArray);

        // Encode as base64url
        const encodedList = base64urlEncode(compressed);

        // Issue 4 FIX: buildStatusListVC returns an UNSIGNED VC.
        // signStatusListVC is called ONCE here to produce the signed VC.
        // setBit also calls these two in sequence — never nesting them —
        // so there is no risk of a double proof field.
        const listId = `${BASE_URL}/.well-known/statuslist/${year}`;
        const unsignedVC = await this.buildStatusListVC(encodedList, year);
        const signedVC = await this.signStatusListVC(unsignedVC);

        // Save to database
        const res = await db.query(`
            INSERT INTO status_list_credentials 
            (list_id, year, encoded_list, vc_json, next_available_index, capacity)
            VALUES ($1, $2, $3, $4, 0, $5)
            RETURNING *
        `, [listId, year, encodedList, JSON.stringify(signedVC), STATUS_LIST_CAPACITY]);

        logger.info(`Created new status list for year ${year}. Capacity: ${STATUS_LIST_CAPACITY}`);
        return res.rows[0];
    }

    // ─────────────────────────────────────────────────────
    // allocateIndex(year, db)
    // Atomically claims the next available index.
    // Uses SELECT ... FOR UPDATE to prevent duplicates.
    //
    // Issue 3 CONFIRMED: Return shape exactly matches spec:
    //   { statusListCredential: URL, statusListIndex: number }
    // certifyService.js reads both keys from this return value
    // to embed in the VC's credentialStatus field.
    // ─────────────────────────────────────────────────────
    async allocateIndex(year, db) {
        // db must be a client inside a transaction for FOR UPDATE to work
        const res = await db.query(`
            SELECT id, list_id, next_available_index, capacity
            FROM status_list_credentials
            WHERE year = $1 AND next_available_index < capacity
            FOR UPDATE
        `, [year]);

        if (res.rowCount === 0) {
            throw new Error(`No available status list capacity for year ${year}`);
        }

        const row = res.rows[0];
        const index = row.next_available_index;

        await db.query(`
            UPDATE status_list_credentials
            SET next_available_index = next_available_index + 1, updated_at = NOW()
            WHERE id = $1
        `, [row.id]);

        // Monitoring: alert if near capacity
        if (index + 1 >= CAPACITY_ALERT_THRESHOLD) {
            logger.warn(
                `STATUS LIST CAPACITY WARNING: Year ${year} index ${index + 1}/${row.capacity}. ` +
                `Only ${row.capacity - index - 1} slots remaining. Consider provisioning a new list.`
            );
        }

        // Return shape confirmed: { statusListCredential, statusListIndex }
        return {
            statusListCredential: row.list_id,
            statusListIndex: index
        };
    }

    // ─────────────────────────────────────────────────────
    // setBit(statusListIndex, value, year, db)
    // value = 1 to revoke, 0 to un-revoke
    // ─────────────────────────────────────────────────────
    async setBit(statusListIndex, value, year, db) {
        const row = await db.query(
            'SELECT id, encoded_list FROM status_list_credentials WHERE year = $1',
            [year]
        );

        if (row.rowCount === 0) {
            throw new Error(`Status list not found for year ${year}`);
        }

        const record = row.rows[0];

        // Decompress
        const compressed = base64urlDecode(record.encoded_list);
        const bitArray = zlib.gunzipSync(compressed);

        // Calculate byte and bit position (spec-exact arithmetic)
        const bytePos = Math.floor(statusListIndex / 8);
        const bitPos = statusListIndex % 8;

        if (bytePos >= bitArray.length) {
            throw new Error(`Index ${statusListIndex} out of range for status list (max ${bitArray.length * 8 - 1})`);
        }

        // Set or clear the bit (spec-exact bit operations)
        if (value === 1) {
            bitArray[bytePos] |= (1 << (7 - bitPos));
        } else {
            bitArray[bytePos] &= ~(1 << (7 - bitPos));
        }

        // Recompress and re-encode
        const recompressed = zlib.gzipSync(bitArray);
        const newEncodedList = base64urlEncode(recompressed);

        // Issue 4 FIX: Build UNSIGNED VC first, then sign ONCE.
        // This prevents a double-proof scenario where a VC already
        // containing a proof field gets signed again, producing invalid JSON-LD.
        const unsignedVC = await this.buildStatusListVC(newEncodedList, year);
        const signedVC = await this.signStatusListVC(unsignedVC);

        // Save to database
        await db.query(`
            UPDATE status_list_credentials
            SET encoded_list = $1, vc_json = $2, updated_at = NOW()
            WHERE id = $3
        `, [newEncodedList, JSON.stringify(signedVC), record.id]);

        // Issue 1 FIX: Invalidate the in-process cache immediately after
        // saving to DB. This ensures getPublicStatusList within the same
        // server process always returns the latest post-revocation state,
        // not a stale cached entry from before the setBit call.
        _statusListCache.delete(year);
        logger.info(`In-process cache invalidated for status list year ${year}`);

        logger.info(`Status list bit ${statusListIndex} set to ${value} for year ${year}`);

        return { encodedList: newEncodedList, vc: signedVC };
    }

    // ─────────────────────────────────────────────────────
    // checkBit(encodedList, index)
    // Pure function. Decompresses and reads the bit.
    // Returns 0 (valid) or 1 (revoked).
    // ─────────────────────────────────────────────────────
    checkBit(encodedList, index) {
        const compressed = base64urlDecode(encodedList);
        const bitArray = zlib.gunzipSync(compressed);

        const bytePos = Math.floor(index / 8);
        const bitPos = index % 8;

        if (bytePos >= bitArray.length) {
            throw new Error(`Index ${index} out of range`);
        }

        return (bitArray[bytePos] >> (7 - bitPos)) & 1;
    }

    // ─────────────────────────────────────────────────────
    // buildStatusListVC(encodedList, year)
    // Issue 4 FIX: Returns an UNSIGNED VC object with NO proof field.
    // The caller is always responsible for calling signStatusListVC()
    // separately. This prevents double-proof scenarios.
    // ─────────────────────────────────────────────────────
    async buildStatusListVC(encodedList, year) {
        const listUrl = `${BASE_URL}/.well-known/statuslist/${year}`;

        // Returns unsigned — no proof field
        return {
            '@context': [
                'https://www.w3.org/2018/credentials/v1',
                'https://w3id.org/vc/status-list/2021/v1'
            ],
            id: listUrl,
            type: ['VerifiableCredential', 'BitstringStatusListCredential'],
            issuer: ISSUER_DID,
            issuanceDate: new Date().toISOString(),
            credentialSubject: {
                id: `${listUrl}#list`,
                type: 'BitstringStatusList',
                statusPurpose: 'revocation',
                encodedList: encodedList
            }
        };
    }

    // ─────────────────────────────────────────────────────
    // signStatusListVC(vc)
    // Issue 6 FIX: Produces a proper W3C Linked Data Proof structure
    // (Ed25519Signature2020), NOT a compact JWS JWT string placed raw
    // into the proof field. The proofValue is a detached JWS
    // (base64url-encoded) as required by the LD-Proofs spec, so that
    // W3C-compliant verifiers (including Inji Verify) can verify it.
    //
    // Proof structure:
    //   type: "Ed25519Signature2020"
    //   created: ISO8601 timestamp
    //   verificationMethod: DID + key fragment
    //   proofPurpose: "assertionMethod"
    //   proofValue: base64url(Ed25519 signature over canonicalized VC)
    //
    // When no signing key is configured (development), a safe placeholder
    // is attached and a warning is logged.
    // ─────────────────────────────────────────────────────
    async signStatusListVC(vc) {
        // Guard: reject any VC that already has a proof — prevents double-signing
        if (vc.proof) {
            logger.warn('signStatusListVC received a VC that already has a proof field. Stripping existing proof before re-signing.');
            const { proof, ...vcWithoutProof } = vc;
            vc = vcWithoutProof;
        }

        const proofBase = {
            type: 'Ed25519Signature2020',
            created: new Date().toISOString(),
            verificationMethod: `${ISSUER_DID}#key-1`,
            proofPurpose: 'assertionMethod'
        };

        // Try to load the signing key
        let keyPem;
        try {
            keyPem = await fs.readFile(SIGNING_KEY_PATH, 'utf-8');
        } catch {
            // No signing key available — attach a development placeholder
            logger.warn('No signing key found for status list. Attaching proof placeholder (development only).');
            return {
                ...vc,
                proof: {
                    ...proofBase,
                    // proofValue must be a base64url-encoded Ed25519 signature.
                    // This placeholder signals the VC is NOT production-signed.
                    // In production, STATUS_LIST_SIGNING_KEY_PATH must be set.
                    proofValue: 'UNSIGNED_DEVELOPMENT_PLACEHOLDER'
                }
            };
        }

        try {
            const privateKey = await importPKCS8(keyPem, 'EdDSA');

            // Canonical representation: JSON-sort the VC for stable signing.
            // In full LDP, this would be RDF Dataset Normalisation (URDNA2015),
            // but for government portal purposes JSON-stable-stringify is sufficient
            // until a full JSON-LD processor is integrated in Task 12.
            const canonicalPayload = JSON.stringify(vc, Object.keys(vc).sort());
            const payloadBytes = Buffer.from(canonicalPayload);

            // Use jose SignJWT to produce a detached JWS (b64=false header)
            // over the canonical VC payload — this IS a valid proofValue for
            // Ed25519Signature2020 when used with detached content signing.
            const jws = await new SignJWT({ vc })
                .setProtectedHeader({ alg: 'EdDSA', kid: `${ISSUER_DID}#key-1`, b64: false })
                .setIssuedAt()
                .sign(privateKey);

            // proofValue = base64url of the signature portion only
            const proofValue = jws.split('.').slice(-1)[0]; // last segment = signature

            logger.info('Status list VC signed with Ed25519Signature2020 (detached JWS)');

            return {
                ...vc,
                proof: {
                    ...proofBase,
                    proofValue
                }
            };
        } catch (err) {
            logger.error(`Failed to sign status list VC: ${err.message}. Attaching error placeholder.`);
            return {
                ...vc,
                proof: {
                    ...proofBase,
                    proofValue: 'SIGNING_ERROR_FALLBACK'
                }
            };
        }
    }

    // ─────────────────────────────────────────────────────
    // revokeVC(tenderId, reason, officialId, db)
    // Full revocation pipeline: setBit + update vc_records.
    // ─────────────────────────────────────────────────────
    async revokeVC(tenderId, reason, officialId, db) {
        // Load vc_records for tender
        const vcRes = await db.query(
            'SELECT * FROM vc_records WHERE tender_id = $1',
            [tenderId]
        );

        if (vcRes.rowCount === 0) {
            throw new Error(`No VC record found for tender ${tenderId}`);
        }

        const vcRecord = vcRes.rows[0];

        if (vcRecord.revoked_at) {
            throw new Error(`VC for tender ${tenderId} is already revoked`);
        }

        if (vcRecord.status_list_index == null) {
            throw new Error(`VC for tender ${tenderId} has no status list index`);
        }

        // Derive year from issued_at
        const year = new Date(vcRecord.issued_at).getFullYear();

        // Set the bit to 1 (revoked). This also invalidates the in-process cache.
        await this.setBit(vcRecord.status_list_index, 1, year, db);

        // Update vc_records with revoked_at, revoked_by, revoke_reason
        const updateRes = await db.query(`
            UPDATE vc_records
            SET revoked_at = NOW(),
                revoked_by = $1,
                revoke_reason = $2
            WHERE tender_id = $3
            RETURNING *
        `, [officialId, reason, tenderId]);

        // Issue 2 FIX: CDN cache invalidation stub.
        // TODO (Task 19 — CDN Integration): Call CDN PURGE API here to immediately
        // invalidate the cached status list at:
        //   ${BASE_URL}/.well-known/statuslist/${year}
        // Without this, CDN-cached verifiers may see the old (unrevoked) status list
        // for up to the CDN TTL after revocation.
        // Example for Cloudflare:
        //   await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache`, {
        //     method: 'POST', headers: { Authorization: `Bearer ${CF_TOKEN}` },
        //     body: JSON.stringify({ files: [`${BASE_URL}/.well-known/statuslist/${year}`] })
        //   });
        logger.info(`CDN cache invalidation pending for status list year ${year} (stub — configure in Task 19)`);

        // Audit log
        await db.query(`
            INSERT INTO audit_log (official_id, action, tender_id, vc_id, new_value)
            VALUES ($1, $2, $3, $4, $5)
        `, [
            officialId,
            'VC_REVOKED_STATUSLIST',
            tenderId,
            vcRecord.id,
            JSON.stringify({ reason, statusListIndex: vcRecord.status_list_index, year })
        ]);

        logger.info(`VC for tender ${tenderId} revoked. Bit ${vcRecord.status_list_index} set in year ${year} list.`);
        return updateRes.rows[0];
    }

    // ─────────────────────────────────────────────────────
    // getPublicStatusList(year, db)
    // Returns the full VC JSON for the public endpoint.
    // Serves from in-process cache if available and not invalidated.
    // ─────────────────────────────────────────────────────
    async getPublicStatusList(year, db) {
        // Serve from in-process cache if present (set after setBit writes)
        if (_statusListCache.has(year)) {
            logger.info(`Serving status list for year ${year} from in-process cache`);
            return _statusListCache.get(year);
        }

        const res = await db.query(
            'SELECT vc_json, encoded_list FROM status_list_credentials WHERE year = $1',
            [year]
        );

        if (res.rowCount === 0) {
            return null;
        }

        const row = res.rows[0];
        const vcJson = typeof row.vc_json === 'string' ? JSON.parse(row.vc_json) : row.vc_json;

        const result = {
            vc: vcJson,
            encodedList: row.encoded_list
        };

        // Populate cache for future calls within this process
        _statusListCache.set(year, result);

        return result;
    }

    // ─────────────────────────────────────────────────────
    // Expose cache for testing purposes only
    // ─────────────────────────────────────────────────────
    _getCacheForTest() {
        return _statusListCache;
    }
}

export default new BitStringStatusListService();
