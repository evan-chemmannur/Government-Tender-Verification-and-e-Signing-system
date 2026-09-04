/**
 * vcModel.js — Database access layer for the vc_records table.
 *
 * Spec-required methods:
 *   saveVC(tenderId, credential, statusListIndex)
 *   getVCByTenderId(tenderId)
 *   getVCByCredentialId(credentialId)
 *   markRevoked(credentialId, officialId, reason, notes)
 *
 * Internal helpers for PENDING_ISSUANCE workflow:
 *   createPendingVC(tenderId)
 *   updateToIssued(vcDbId, credentialId, vcJson, statusListUrl, statusListIndex)
 *   allocateStatusListIndex(client)
 */

import { pool } from '../config/database.js';
import logger from '../utils/logger.js';

export const vcModel = {

  // ─────────────────────────────────────────────────────────
  // SPEC-REQUIRED: saveVC(tenderId, credential, statusListIndex)
  // High-level convenience method that wraps the PENDING workflow.
  // Creates a record and immediately finalises it in one call.
  // ─────────────────────────────────────────────────────────
  async saveVC(tenderId, credential, statusListIndex) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Idempotency: if a VC already exists for this tender, return it
      const existing = await client.query(
        'SELECT * FROM vc_records WHERE tender_id = $1', [tenderId]
      );
      if (existing.rowCount > 0 && !existing.rows[0].credential_id.startsWith('PENDING-')) {
        await client.query('COMMIT');
        return existing.rows[0];
      }

      const credentialId = credential.id || `VC-${tenderId}-${Date.now()}`;
      const issuerDid = credential.issuer?.id || credential.issuer || null;
      const holderDid = credential.credentialSubject?.id || null;
      const statusListUrl = credential.credentialStatus?.statusListCredential || null;
      const vcFormat = credential.format || 'ldp_vc';

      let vcDbId;
      if (existing.rowCount > 0) {
        // Update the existing PENDING record
        vcDbId = existing.rows[0].id;
      } else {
        // Insert fresh
        const insertRes = await client.query(`
          INSERT INTO vc_records (tender_id, credential_id, vc_json, vc_format, issuer_did,
                                  holder_did, status_list_url, status_list_index, issued_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          RETURNING id
        `, [tenderId, credentialId, JSON.stringify(credential), vcFormat,
            issuerDid, holderDid, statusListUrl, statusListIndex]);
        vcDbId = insertRes.rows[0].id;
        await client.query('COMMIT');
        return (await client.query('SELECT * FROM vc_records WHERE id = $1', [vcDbId])).rows[0];
      }

      // Finalise PENDING record
      const res = await client.query(`
        UPDATE vc_records
        SET credential_id   = $1,
            vc_json         = $2,
            vc_format       = $3,
            issuer_did      = $4,
            holder_did      = $5,
            status_list_url = $6,
            status_list_index = $7,
            issued_at       = NOW()
        WHERE id = $8
        RETURNING *
      `, [credentialId, JSON.stringify(credential), vcFormat,
          issuerDid, holderDid, statusListUrl, statusListIndex, vcDbId]);

      await client.query('COMMIT');
      return res.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error(`vcModel.saveVC failed: ${err.message}`);
      throw err;
    } finally {
      client.release();
    }
  },

  // ─────────────────────────────────────────────────────────
  // SPEC-REQUIRED: getVCByTenderId(tenderId)
  // ─────────────────────────────────────────────────────────
  async getVCByTenderId(tenderId) {
    const res = await pool.query('SELECT * FROM vc_records WHERE tender_id = $1', [tenderId]);
    return res.rows[0] || null;
  },

  // ─────────────────────────────────────────────────────────
  // SPEC-REQUIRED: getVCByCredentialId(credentialId)
  // ─────────────────────────────────────────────────────────
  async getVCByCredentialId(credentialId) {
    const res = await pool.query('SELECT * FROM vc_records WHERE credential_id = $1', [credentialId]);
    return res.rows[0] || null;
  },

  // ─────────────────────────────────────────────────────────
  // SPEC-REQUIRED: markRevoked(credentialId, officialId, reason, notes)
  // ─────────────────────────────────────────────────────────
  async markRevoked(credentialId, officialId, reason, notes) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const res = await client.query(`
        UPDATE vc_records
        SET revoked_at    = NOW(),
            revoked_by    = $1,
            revoke_reason = $2,
            revoke_notes  = $3
        WHERE credential_id = $4 AND revoked_at IS NULL
        RETURNING *
      `, [officialId, reason, notes, credentialId]);

      if (res.rowCount === 0) {
        await client.query('ROLLBACK');
        throw new Error(`VC not found or already revoked: ${credentialId}`);
      }

      const vc = res.rows[0];

      // Append-only audit log entry
      await client.query(`
        INSERT INTO audit_log (official_id, action, tender_id, vc_id, new_value)
        VALUES ($1, $2, $3, $4, $5)
      `, [officialId, 'VC_REVOKED', vc.tender_id, vc.id,
          JSON.stringify({ reason, notes, credentialId })]);

      await client.query('COMMIT');
      return vc;
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error(`vcModel.markRevoked failed: ${err.message}`);
      throw err;
    } finally {
      client.release();
    }
  },

  // ─────────────────────────────────────────────────────────
  // INTERNAL: createPendingVC(tenderId)
  // Inserts a PENDING_ISSUANCE row BEFORE the Inji API call
  // so we never produce ghost credentials.
  // ─────────────────────────────────────────────────────────
  async createPendingVC(tenderId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Idempotency: check if a record already exists
      const existing = await client.query(
        'SELECT id, credential_id FROM vc_records WHERE tender_id = $1', [tenderId]
      );
      if (existing.rowCount > 0) {
        await client.query('COMMIT');
        return existing.rows[0];
      }

      const dummyId = `PENDING-${tenderId}-${Date.now()}`;

      const res = await client.query(`
        INSERT INTO vc_records (tender_id, credential_id, vc_json)
        VALUES ($1, $2, $3)
        RETURNING id, credential_id
      `, [tenderId, dummyId, JSON.stringify({ status: 'PENDING_ISSUANCE' })]);

      await client.query('COMMIT');
      return res.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error(`vcModel.createPendingVC failed: ${err.message}`);
      throw err;
    } finally {
      client.release();
    }
  },

  // ─────────────────────────────────────────────────────────
  // INTERNAL: updateToIssued(...)
  // Finalises a PENDING record with real credential data.
  // ─────────────────────────────────────────────────────────
  async updateToIssued(vcDbId, credentialId, vcJson, statusListUrl, statusListIndex) {
    const res = await pool.query(`
      UPDATE vc_records
      SET credential_id   = $1,
          vc_json         = $2,
          status_list_url = $3,
          status_list_index = $4,
          issuer_did      = $5,
          issued_at       = NOW()
      WHERE id = $6
      RETURNING *
    `, [
      credentialId,
      JSON.stringify(vcJson),
      statusListUrl,
      statusListIndex,
      vcJson.issuer?.id || vcJson.issuer || null,
      vcDbId
    ]);
    return res.rows[0];
  },

  // ─────────────────────────────────────────────────────────
  // INTERNAL: allocateStatusListIndex(client)
  // Atomically claims the next available status list index
  // using SELECT ... FOR UPDATE to prevent duplicates.
  // ─────────────────────────────────────────────────────────
  async allocateStatusListIndex(client) {
    const res = await client.query(`
      SELECT id, list_id, next_available_index
      FROM status_list_credentials
      WHERE next_available_index < capacity
      ORDER BY year DESC
      LIMIT 1
      FOR UPDATE
    `);

    if (res.rowCount === 0) {
      // Create a brand-new status list
      const listId = `https://certify.gov.in/status-list/${Date.now()}`;
      const year = new Date().getFullYear();
      const encodedList = 'eA=='; // empty GZIP-compressed base64url bitstring

      const insertRes = await client.query(`
        INSERT INTO status_list_credentials (list_id, year, encoded_list, next_available_index, capacity)
        VALUES ($1, $2, $3, 1, 100000)
        RETURNING id, list_id
      `, [listId, year, encodedList]);

      return { list_id: insertRes.rows[0].list_id, index: 0 };
    }

    const row = res.rows[0];
    const index = row.next_available_index;

    await client.query(`
      UPDATE status_list_credentials
      SET next_available_index = next_available_index + 1, updated_at = NOW()
      WHERE id = $1
    `, [row.id]);

    return { list_id: row.list_id, index };
  }
};
