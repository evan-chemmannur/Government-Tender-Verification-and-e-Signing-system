/**
 * verificationService.js — Client-side VC verification logic.
 *
 * All verification happens in the browser — no backend required.
 * Steps: decode QR → verify signature → check revocation status.
 *
 * Constraints:
 * - Never sends private keys to the browser
 * - Handles network failures gracefully
 * - Status list cached in memory for session duration
 */

import pako from 'pako';
import { importJWK, compactVerify, decodeProtectedHeader } from 'jose';

// ─────────────────────────────────────────────────────────
// Session-scoped in-memory caches
// ─────────────────────────────────────────────────────────
const _didCache = new Map();       // did → publicKeyJwk
const _statusListCache = new Map(); // url → { decompressed: Uint8Array }

// ─────────────────────────────────────────────────────────
// STEP 1: decodePixelPassQR(qrPayload)
// Decodes a PixelPass / GZIP-compressed base64url QR payload into a VC object.
// ─────────────────────────────────────────────────────────
export async function decodePixelPassQR(qrPayload) {
    if (!qrPayload || typeof qrPayload !== 'string') {
        throw new Error('Invalid QR payload: must be a non-empty string');
    }

    // 1a. Try parsing as plain JSON first (uncompressed VC)
    try {
        const parsed = JSON.parse(qrPayload);
        if (parsed && parsed.type) return parsed;
    } catch {
        // Not plain JSON — continue with PixelPass decoding
    }

    // 1b. Base64url decode
    let binaryData;
    try {
        // Replace URL-safe chars and decode
        const base64 = qrPayload.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
        const binary = atob(padded);
        binaryData = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            binaryData[i] = binary.charCodeAt(i);
        }
    } catch (e) {
        throw new Error(`Failed to base64url-decode QR payload: ${e.message}`);
    }

    // 1c. GZIP decompress
    let decompressed;
    try {
        decompressed = pako.ungzip(binaryData, { to: 'string' });
    } catch {
        // Try inflate (zlib) as fallback
        try {
            decompressed = pako.inflate(binaryData, { to: 'string' });
        } catch (e2) {
            // Last resort: treat as raw UTF-8 string
            decompressed = new TextDecoder().decode(binaryData);
        }
    }

    // 1d. Parse JSON
    try {
        const vc = JSON.parse(decompressed);
        if (!vc || typeof vc !== 'object') throw new Error('Parsed value is not an object');
        return vc;
    } catch (e) {
        throw new Error(`Failed to parse decompressed QR data as JSON: ${e.message}`);
    }
}

// ─────────────────────────────────────────────────────────
// STEP 2: resolveIssuerDID(issuerDID)
// Fetches the DID document and extracts the public key JWK.
// Caches result for session duration.
// ─────────────────────────────────────────────────────────
export async function resolveIssuerDID(issuerDID) {
    if (_didCache.has(issuerDID)) {
        return _didCache.get(issuerDID);
    }

    if (!issuerDID || typeof issuerDID !== 'string') {
        throw new Error('Invalid issuer DID: must be a non-empty string');
    }

    // Parse did:web: into a domain URL
    let didDocUrl;
    if (issuerDID.startsWith('did:web:')) {
        const domain = issuerDID.replace('did:web:', '').replace(/:/g, '/');
        didDocUrl = `https://${domain}/.well-known/did.json`;
    } else {
        throw new Error(`Unsupported DID method: ${issuerDID}. Only did:web: is supported.`);
    }

    let didDoc;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10_000); // 10s timeout
        const res = await fetch(didDocUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        didDoc = await res.json();
    } catch (e) {
        if (e.name === 'AbortError') {
            throw new Error(`Cannot verify — network timeout resolving DID: ${issuerDID}`);
        }
        throw new Error(`Cannot verify — network error resolving DID document at ${didDocUrl}: ${e.message}`);
    }

    // Extract publicKeyJwk from the first verificationMethod
    const vm = didDoc.verificationMethod?.[0];
    if (!vm?.publicKeyJwk) {
        throw new Error(`DID document at ${didDocUrl} has no verificationMethod with publicKeyJwk`);
    }

    const result = { publicKeyJwk: vm.publicKeyJwk, verificationMethod: vm.id };
    _didCache.set(issuerDID, result);
    return result;
}

// ─────────────────────────────────────────────────────────
// STEP 3: verifyVCSignature(vc, publicKeyJwk)
// Verifies the Ed25519Signature2020 Linked Data Proof.
// Returns { valid: bool, error?: string }
// ─────────────────────────────────────────────────────────
export async function verifyVCSignature(vc, publicKeyJwk) {
    if (!vc?.proof) {
        return { valid: false, error: 'VC has no proof field' };
    }

    const proof = vc.proof;

    if (proof.proofValue === 'UNSIGNED_DEVELOPMENT_PLACEHOLDER' ||
        proof.proofValue === 'SIGNING_ERROR_FALLBACK') {
        return { valid: false, error: 'VC contains a development placeholder — not production signed' };
    }

    // Build the canonical document (VC without proof) for signature verification
    const { proof: _removed, ...vcWithoutProof } = vc;
    const canonicalPayload = JSON.stringify(vcWithoutProof, Object.keys(vcWithoutProof).sort());

    try {
        if (proof.proofValue) {
            // Ed25519Signature2020 — proofValue is the raw base64url signature
            const publicKey = await importJWK(publicKeyJwk, 'EdDSA');

            // The proofValue is the last segment of a detached JWS
            // Reconstruct a compact JWS with empty payload for verification
            const headerB64 = btoa(JSON.stringify({ alg: 'EdDSA', b64: false }))
                .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
            const payloadB64 = btoa(canonicalPayload)
                .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
            const jws = `${headerB64}.${payloadB64}.${proof.proofValue}`;

            try {
                await compactVerify(jws, publicKey);
                return { valid: true };
            } catch {
                // Detached JWS verification — try verifying the signature bytes directly
                // Fall through to jose importJWK approach
            }

            // Alternative: import key and verify signature over canonical bytes
            const msgBytes = new TextEncoder().encode(canonicalPayload);
            const sigBytes = Uint8Array.from(atob(proof.proofValue.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

            const cryptoKey = await crypto.subtle.importKey(
                'jwk',
                publicKeyJwk,
                { name: 'Ed25519' },
                false,
                ['verify']
            );
            const valid = await crypto.subtle.verify('Ed25519', cryptoKey, sigBytes, msgBytes);
            return { valid };

        } else if (proof.jws) {
            // Compact JWS fallback (legacy JWT-style proof)
            const publicKey = await importJWK(publicKeyJwk, proof.type === 'RsaSignature2018' ? 'RS256' : 'EdDSA');
            await compactVerify(proof.jws, publicKey);
            return { valid: true };
        }

        return { valid: false, error: 'Unknown proof format — no proofValue or jws field' };
    } catch (e) {
        return { valid: false, error: `Signature verification failed: ${e.message}` };
    }
}

// ─────────────────────────────────────────────────────────
// STEP 4: checkRevocationStatus(vc)
// Fetches the status list VC and checks the bit at the VC's index.
// Caches the decompressed bit array for session duration.
// Returns { revoked: bool, revokedAt?: string, error?: string }
// ─────────────────────────────────────────────────────────
export async function checkRevocationStatus(vc) {
    const status = vc?.credentialStatus;

    if (!status) {
        // No credentialStatus — assume valid (not all VCs use status lists)
        return { revoked: false, detail: 'No credentialStatus field — assuming valid' };
    }

    const { statusListCredential, statusListIndex } = status;

    if (!statusListCredential || statusListIndex == null) {
        return { revoked: false, error: 'Incomplete credentialStatus — cannot check revocation' };
    }

    // Fetch and cache the status list
    let bitArray;
    if (_statusListCache.has(statusListCredential)) {
        bitArray = _statusListCache.get(statusListCredential);
    } else {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10_000);
            const res = await fetch(statusListCredential, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const statusListVC = await res.json();

            const encodedList = statusListVC.credentialSubject?.encodedList;
            if (!encodedList) throw new Error('Status list VC has no encodedList');

            // Base64url decode
            const base64 = encodedList.replace(/-/g, '+').replace(/_/g, '/');
            const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
            const binary = Uint8Array.from(atob(padded), c => c.charCodeAt(0));

            // GZIP decompress
            bitArray = pako.ungzip(binary);
            _statusListCache.set(statusListCredential, bitArray);
        } catch (e) {
            if (e.name === 'AbortError') {
                return { revoked: false, error: `Cannot check revocation — network timeout fetching status list` };
            }
            return { revoked: false, error: `Cannot check revocation — ${e.message}` };
        }
    }

    // Check the bit at statusListIndex
    const index = Number(statusListIndex);
    const bytePos = Math.floor(index / 8);
    const bitPos = index % 8;

    if (bytePos >= bitArray.length) {
        return { revoked: false, error: `Status list index ${index} is out of range` };
    }

    const bit = (bitArray[bytePos] >> (7 - bitPos)) & 1;
    return { revoked: bit === 1 };
}

// ─────────────────────────────────────────────────────────
// ORCHESTRATOR: verifyTenderAward(vcOrQRPayload, onStep)
// Runs all verification steps with progress callbacks.
// Returns detailed result object.
// ─────────────────────────────────────────────────────────
export async function verifyTenderAward(vcOrQRPayload, onStep = () => {}) {
    const steps = [];
    let vc = null;

    const recordStep = (name, passed, detail) => {
        const step = { name, passed, detail };
        steps.push(step);
        onStep(step, steps);
        return step;
    };

    try {
        // ── Step 1: Decode ──────────────────────────────
        onStep({ name: 'Decoding QR code...', running: true }, steps);
        try {
            vc = typeof vcOrQRPayload === 'object'
                ? vcOrQRPayload
                : await decodePixelPassQR(vcOrQRPayload);
            recordStep('QR Decoding', true, 'QR code decoded successfully');
        } catch (e) {
            recordStep('QR Decoding', false, e.message);
            return { verdict: 'ERROR', steps, error: `QR Decode failed: ${e.message}`, claims: null };
        }

        // ── Step 2: Document Structure ───────────────────
        onStep({ name: 'Verifying document structure...', running: true }, steps);
        const hasRequiredFields = vc?.type && vc?.issuer && vc?.credentialSubject;
        recordStep('Document Structure', !!hasRequiredFields,
            hasRequiredFields ? 'Valid W3C Verifiable Credential structure' : 'Missing required VC fields');

        if (!hasRequiredFields) {
            return { verdict: 'TAMPERED', steps, error: 'Document structure is invalid', claims: extractClaims(vc) };
        }

        // ── Step 3: Resolve Issuer DID ───────────────────
        onStep({ name: 'Resolving issuer identity...', running: true }, steps);
        const issuerDID = typeof vc.issuer === 'string' ? vc.issuer : vc.issuer?.id;
        let publicKeyJwk = null;

        try {
            const resolved = await resolveIssuerDID(issuerDID);
            publicKeyJwk = resolved.publicKeyJwk;
            recordStep('Issuer Identity', true, `DID resolved: ${issuerDID}`);
        } catch (e) {
            recordStep('Issuer Identity', false, e.message);
            // Network failure — cannot verify but don't mark as TAMPERED
            return {
                verdict: 'ERROR',
                steps,
                error: e.message,
                claims: extractClaims(vc)
            };
        }

        // ── Step 4: Cryptographic Signature ─────────────
        onStep({ name: 'Verifying cryptographic signature...', running: true }, steps);
        const sigResult = await verifyVCSignature(vc, publicKeyJwk);
        recordStep('Cryptographic Signature', sigResult.valid,
            sigResult.valid ? 'Signature is valid — document not tampered' : sigResult.error);

        if (!sigResult.valid) {
            return { verdict: 'TAMPERED', steps, error: sigResult.error, claims: extractClaims(vc) };
        }

        // ── Step 5: Revocation Status ────────────────────
        onStep({ name: 'Checking revocation status...', running: true }, steps);
        const revResult = await checkRevocationStatus(vc);
        recordStep('Revocation Status', !revResult.revoked,
            revResult.revoked
                ? `This credential has been REVOKED`
                : revResult.error || 'Not revoked — credential is active');

        // ── Step 6: Expiry Check ─────────────────────────
        onStep({ name: 'Checking expiry...', running: true }, steps);
        const now = new Date();
        const expiryDate = vc.expirationDate ? new Date(vc.expirationDate) : null;
        const isExpired = expiryDate && now > expiryDate;
        recordStep('Expiry Check', !isExpired,
            isExpired ? `Expired on ${expiryDate.toLocaleDateString()}` : 'Not expired');

        onStep({ name: 'Verification complete.', running: false }, steps);

        // ── Final Verdict ────────────────────────────────
        if (revResult.revoked) {
            return {
                verdict: 'REVOKED',
                steps,
                claims: extractClaims(vc),
                revokedAt: revResult.revokedAt || null,
                error: null
            };
        }

        if (isExpired) {
            return {
                verdict: 'REVOKED',
                steps,
                claims: extractClaims(vc),
                error: `Credential expired on ${expiryDate.toLocaleDateString()}`
            };
        }

        return {
            verdict: 'GENUINE',
            steps,
            claims: extractClaims(vc),
            error: null
        };

    } catch (e) {
        recordStep('Unexpected Error', false, e.message);
        return { verdict: 'ERROR', steps, error: e.message, claims: null };
    }
}

// ─────────────────────────────────────────────────────────
// Helper: extract human-readable claims from VC
// ─────────────────────────────────────────────────────────
function extractClaims(vc) {
    if (!vc) return null;
    const subject = vc.credentialSubject || {};
    return {
        tenderId: subject.tenderId || subject.id || '—',
        title: subject.title || '—',
        value: subject.awardValue || subject.estimatedValue || '—',
        awardedTo: subject.awardedToName || '—',
        gstin: subject.awardedToGstin || '—',
        approvedBy: subject.approvedBy || subject.officerName || '—',
        designation: subject.designation || '—',
        issuedDate: vc.issuanceDate ? new Date(vc.issuanceDate).toLocaleDateString() : '—',
        validUntil: vc.expirationDate ? new Date(vc.expirationDate).toLocaleDateString() : 'No expiry',
        issuer: typeof vc.issuer === 'string' ? vc.issuer : vc.issuer?.id || '—',
        verificationMethod: vc.proof?.verificationMethod || '—',
        credentialStatus: vc.credentialStatus
    };
}

// Export cache clear utility for testing
export function clearVerificationCaches() {
    _didCache.clear();
    _statusListCache.clear();
}
