import { pool } from '../config/database.js';
import { generateTenderId } from '../utils/tenderIdGenerator.js';
import logger from '../utils/logger.js';

export const tenderModel = {
  /**
   * Retrieves paginated, filtered, and sorted tenders.
   * Converts monetary values from Paisa to Rupees.
   */
  async findAll({ status, department, min_value, max_value, page = 1, limit = 10, sort = 'created_at', order = 'DESC' }) {
    const offset = (page - 1) * limit;
    const params = [];
    let whereClauses = [];

    if (status) {
      params.push(status);
      whereClauses.push(`status = $${params.length}`);
    }
    if (department) {
      params.push(department);
      whereClauses.push(`department = $${params.length}`);
    }
    if (min_value) {
      params.push(min_value * 100); // Convert filter to paisa
      whereClauses.push(`estimated_value >= $${params.length}`);
    }
    if (max_value) {
      params.push(max_value * 100);
      whereClauses.push(`estimated_value <= $${params.length}`);
    }

    const whereStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
    
    // Sort validation to prevent SQL injection
    const allowedSorts = ['created_at', 'estimated_value', 'status'];
    const sortField = allowedSorts.includes(sort) ? sort : 'created_at';
    const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    const query = `
      SELECT id, tender_id, title, department, category, 
             (estimated_value / 100.0) as estimated_value_inr, 
             status, submission_deadline, created_at, updated_at,
             (SELECT COUNT(*) FROM vc_records WHERE vc_records.tender_id = tenders.id) > 0 as has_vc
      FROM tenders
      ${whereStr}
      ORDER BY ${sortField} ${sortOrder}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    
    const countQuery = `SELECT COUNT(*) FROM tenders ${whereStr}`;

    try {
      const [dataRes, countRes] = await Promise.all([
        pool.query(query, [...params, limit, offset]),
        pool.query(countQuery, params)
      ]);

      return {
        data: dataRes.rows,
        meta: {
          page: Number(page),
          total: parseInt(countRes.rows[0].count, 10),
          limit: Number(limit)
        }
      };
    } catch (err) {
      logger.error(`Database error in findAll tenders: ${err.message}`);
      throw err;
    }
  },

  async findById(id) {
    try {
      const result = await pool.query(`
        SELECT t.id, t.tender_id, t.title, t.description, t.department, t.category,
               (t.estimated_value / 100.0) as estimated_value_inr,
               (t.actual_value / 100.0) as actual_value_inr,
               t.currency, t.status, t.submission_deadline,
               t.awarded_to_name, t.awarded_to_gstin, t.awarded_to_email,
               t.contract_start_date, t.contract_end_date, t.created_at, t.updated_at,
               c.name as created_by_name,
               r.name as reviewed_by_name,
               a.name as approved_by_name
        FROM tenders t
        LEFT JOIN officials c ON t.created_by = c.id
        LEFT JOIN officials r ON t.reviewed_by = r.id
        LEFT JOIN officials a ON t.approved_by = a.id
        WHERE t.id = $1
      `, [id]);
      
      const tender = result.rows[0];
      console.error("FINDBYID TENDER ID:", id, "FOUND:", tender ? tender.id : null, "ROWS:", result.rows.length);
      if (!tender) return null;

      // 5. GET /api/tenders/:id - Fetch documents and audit history
      const [docsRes, auditRes] = await Promise.all([
        pool.query('SELECT * FROM tender_documents WHERE tender_id = $1', [id]),
        pool.query(`
          SELECT a.id, a.action, a.old_value, a.new_value, a.timestamp, o.name as official_name
          FROM audit_log a
          LEFT JOIN officials o ON a.official_id = o.id
          WHERE a.tender_id = $1 ORDER BY a.timestamp DESC
        `, [id])
      ]);

      tender.documents = docsRes.rows;
      tender.audit_history = auditRes.rows;

      return tender;
    } catch (err) {
      logger.error(`Database error in findById for tender ${id}: ${err.message}`);
      throw err;
    }
  },

  async findWithVC(id) {
    try {
      const result = await pool.query(`
        SELECT t.*, v.credential_id, v.status_list_index, v.revoked_at, v.revoke_reason, v.vc_json
        FROM tenders t
        LEFT JOIN vc_records v ON t.id = v.tender_id
        WHERE t.id = $1
      `, [id]);
      return result.rows[0];
    } catch (err) {
      logger.error(`Database error in findWithVC for tender ${id}: ${err.message}`);
      throw err;
    }
  },

  async create(data, officialId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const tender_id = await generateTenderId(data.department, client);
      const estValuePaisa = Math.round(data.estimatedValue * 100);

      const res = await client.query(`
        INSERT INTO tenders (
          tender_id, title, description, department, category, 
          estimated_value, submission_deadline, awarded_to_name,
          awarded_to_gstin, awarded_to_email, contract_start_date,
          contract_end_date, created_by, status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'DRAFT')
        RETURNING id, tender_id, status, created_at
      `, [
        tender_id, data.title, data.description, data.department, data.category,
        estValuePaisa, data.submissionDeadline, data.awardedToName,
        data.awardedToGstin, data.awardedToEmail, data.contractStartDate || null,
        data.contractEndDate || null, officialId
      ]);

      const tender = res.rows[0];

      await client.query(`
        INSERT INTO audit_log (official_id, action, tender_id, new_value)
        VALUES ($1, $2, $3, $4)
      `, [officialId, 'TENDER_CREATED', tender.id, JSON.stringify(tender)]);

      await client.query('COMMIT');
      return tender;
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error(`Database error creating tender: ${err.message}`);
      throw err;
    } finally {
      client.release();
    }
  },

  async update(id, data, officialId) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const existing = await client.query('SELECT status FROM tenders WHERE id = $1 FOR UPDATE', [id]);
      if (existing.rowCount === 0) throw new Error('Tender not found');
      if (existing.rows[0].status !== 'DRAFT') throw new Error('Only DRAFT tenders can be updated');

      const fields = [];
      const values = [];
      let idx = 1;

      for (const [key, val] of Object.entries(data)) {
        // Exclude ID and status and department from update
        if (['id', 'status', 'department'].includes(key)) continue;
        
        // Map JS camelCase to DB snake_case
        const dbKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
        let dbVal = val;
        
        // Convert monetary
        if (key === 'estimatedValue' || key === 'actualValue') {
           dbVal = Math.round(val * 100);
        }

        fields.push(`${dbKey} = $${idx}`);
        values.push(dbVal);
        idx++;
      }

      if (fields.length === 0) {
         await client.query('ROLLBACK');
         return;
      }

      values.push(id); // Where param

      const res = await client.query(`
        UPDATE tenders SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *
      `, values);

      await client.query(`
        INSERT INTO audit_log (official_id, action, tender_id, new_value)
        VALUES ($1, $2, $3, $4)
      `, [officialId, 'TENDER_UPDATED', id, JSON.stringify(data)]);

      await client.query('COMMIT');
      return res.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error(`Database error updating tender ${id}: ${err.message}`);
      throw err;
    } finally {
      client.release();
    }
  },

  async updateStatus(id, newStatus, officialId, extraData = {}) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      
      const current = await client.query('SELECT status, reviewed_by, approved_by FROM tenders WHERE id = $1 FOR UPDATE', [id]);
      if (current.rowCount === 0) throw new Error('Tender not found');
      const oldStatus = current.rows[0].status;

      // Strict state transition validation
      const validTransitions = {
        'DRAFT': ['SUBMITTED'],
        'SUBMITTED': ['UNDER_REVIEW'],
        'UNDER_REVIEW': ['APPROVED_PENDING_SIGN', 'DRAFT'], // DRAFT if rejected
        'APPROVED_PENDING_SIGN': ['SIGNED'],
        'SIGNED': ['AWARDED', 'REVOKED'],
        'AWARDED': ['REVOKED', 'EXPIRED'],
        'REVOKED': [],
        'EXPIRED': []
      };

      if (!validTransitions[oldStatus]?.includes(newStatus)) {
        throw new Error(`Invalid transition from ${oldStatus} to ${newStatus}`);
      }

      let updateQuery = 'UPDATE tenders SET status = $1';
      let params = [newStatus, id];
      let paramIdx = 3;

      if (newStatus === 'UNDER_REVIEW') {
        updateQuery += `, reviewed_by = $${paramIdx}`;
        params.push(officialId);
        paramIdx++;
      } else if (newStatus === 'APPROVED_PENDING_SIGN') {
        updateQuery += `, approved_by = $${paramIdx}`;
        params.push(officialId);
        paramIdx++;
      }

      updateQuery += ' WHERE id = $2 RETURNING id, status';

      const res = await client.query(updateQuery, params);

      // Map newStatus to AUDIT log action
      let action = `TENDER_${newStatus}`;
      if (newStatus === 'UNDER_REVIEW') action = 'TENDER_REVIEW_STARTED';

      await client.query(`
        INSERT INTO audit_log (official_id, action, tender_id, old_value, new_value)
        VALUES ($1, $2, $3, $4, $5)
      `, [
        officialId, 
        action, 
        id, 
        JSON.stringify({ status: oldStatus }), 
        JSON.stringify({ status: newStatus, ...extraData })
      ]);

      await client.query('COMMIT');
      return res.rows[0];
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error(`Database error transitioning status for tender ${id}: ${err.message}`);
      throw err;
    } finally {
      client.release();
    }
  },

  async getStatistics() {
    try {
      const statusCounts = await pool.query('SELECT status, COUNT(*) as count FROM tenders GROUP BY status');
      const valueByDept = await pool.query(`
        SELECT department, SUM(estimated_value) / 100.0 as total_value_inr 
        FROM tenders GROUP BY department
      `);
      
      const recentActivity = await pool.query(`
        SELECT a.action, a.timestamp, t.tender_id, o.name as officer_name
        FROM audit_log a
        LEFT JOIN tenders t ON a.tender_id = t.id
        LEFT JOIN officials o ON a.official_id = o.id
        ORDER BY a.timestamp DESC LIMIT 10
      `);

      return {
        statusCounts: statusCounts.rows,
        valueByDepartment: valueByDept.rows,
        recentActivity: recentActivity.rows
      };
    } catch (err) {
      logger.error(`Database error in getStatistics: ${err.message}`);
      throw err;
    }
  }
};
