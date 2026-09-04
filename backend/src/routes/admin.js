import express from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { pool } from '../config/database.js';
import fs from 'fs/promises';
import path from 'path';

const router = express.Router();

router.use(requireAuth, requireRole('ADMIN'));

// GET /api/admin/statistics
router.get('/statistics', async (req, res) => {
  try {
    // Total Tenders
    const totalTendersRes = await pool.query('SELECT COUNT(*) FROM tenders');
    
    // Signed This Month
    const signedThisMonthRes = await pool.query(`
      SELECT COUNT(*) FROM tenders 
      WHERE status = 'SIGNED' 
      AND updated_at >= date_trunc('month', CURRENT_DATE)
    `);
    
    // Revoked
    const revokedRes = await pool.query(`SELECT COUNT(*) FROM tenders WHERE status = 'REVOKED'`);
    
    // Pending Action
    const pendingRes = await pool.query(`
      SELECT COUNT(*) FROM tenders 
      WHERE status IN ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED_PENDING_SIGN')
    `);
    
    // By Department (Bar Chart)
    const deptRes = await pool.query(`
      SELECT department as name, COUNT(*)::int as value 
      FROM tenders 
      GROUP BY department
    `);
    
    // Value By Month (Line Chart) - last 12 months roughly
    const valueRes = await pool.query(`
      SELECT to_char(created_at, 'YYYY-MM') as name, SUM(estimated_value)::bigint as value 
      FROM tenders 
      GROUP BY name 
      ORDER BY name
    `);
    
    // Recent Activity feed
    const activityRes = await pool.query(`
      SELECT a.id, a.action, a.new_value, a.timestamp, o.name as official_name, t.title as tender_title
      FROM audit_log a
      LEFT JOIN officials o ON a.official_id = o.id
      LEFT JOIN tenders t ON a.tender_id = t.id
      ORDER BY a.timestamp DESC
      LIMIT 20
    `);
    
    // Alerts (stalled > 7 days)
    const alertsRes = await pool.query(`
      SELECT id, tender_id, title, status, updated_at 
      FROM tenders 
      WHERE status NOT IN ('SIGNED', 'REVOKED', 'AWARDED')
      AND updated_at < NOW() - INTERVAL '7 days'
      ORDER BY updated_at ASC
    `);

    res.json({
      cards: {
        totalTenders: parseInt(totalTendersRes.rows[0].count),
        signedThisMonth: parseInt(signedThisMonthRes.rows[0].count),
        revoked: parseInt(revokedRes.rows[0].count),
        pendingAction: parseInt(pendingRes.rows[0].count)
      },
      departmentStats: deptRes.rows,
      monthlyValueStats: valueRes.rows,
      recentActivity: activityRes.rows,
      alerts: alertsRes.rows
    });
  } catch (error) {
    console.error('Admin stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/audit-log
router.get('/audit-log', async (req, res) => {
  try {
    const { page = 1, limit = 50, action, official, from, to } = req.query;
    
    let query = `
      SELECT a.*, o.name as official_name, t.title as tender_title
      FROM audit_log a
      LEFT JOIN officials o ON a.official_id = o.id
      LEFT JOIN tenders t ON a.tender_id = t.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (action) {
      query += ` AND a.action = $${paramIndex++}`;
      params.push(action);
    }
    if (official) {
      query += ` AND (o.name ILIKE $${paramIndex} OR a.official_id = $${paramIndex})`;
      params.push(`%${official}%`);
      paramIndex++;
    }
    if (from) {
      query += ` AND a.timestamp >= $${paramIndex++}`;
      params.push(from);
    }
    if (to) {
      query += ` AND a.timestamp <= $${paramIndex++}`;
      params.push(to);
    }

    // Get total count
    const countQuery = `SELECT COUNT(*) FROM (${query}) AS subquery`;
    const countRes = await pool.query(countQuery, params);
    const total = parseInt(countRes.rows[0].count);

    query += ` ORDER BY a.timestamp DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

    const rowsRes = await pool.query(query, params);

    res.json({
      data: rowsRes.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Audit log error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/audit-log/export
router.get('/audit-log/export', async (req, res) => {
  try {
    const { action, official, from, to } = req.query;
    
    let query = `
      SELECT a.timestamp, a.action, a.new_value, o.name as official_name, t.title as tender_title, a.ip_address
      FROM audit_log a
      LEFT JOIN officials o ON a.official_id = o.id
      LEFT JOIN tenders t ON a.tender_id = t.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (action) {
      query += ` AND a.action = $${paramIndex++}`;
      params.push(action);
    }
    if (official) {
      query += ` AND (o.name ILIKE $${paramIndex} OR a.official_id = $${paramIndex})`;
      params.push(`%${official}%`);
      paramIndex++;
    }
    if (from) {
      query += ` AND a.timestamp >= $${paramIndex++}`;
      params.push(from);
    }
    if (to) {
      query += ` AND a.timestamp <= $${paramIndex++}`;
      params.push(to);
    }

    query += ` ORDER BY a.timestamp DESC`;

    const rowsRes = await pool.query(query, params);
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=audit-log-export.csv');

    // Create CSV
    const headers = ['Timestamp', 'Action', 'Details', 'Official', 'Tender', 'IP Address'];
    const escapeCsv = (str) => {
      if (!str) return '';
      const stringified = String(str);
      if (stringified.includes(',') || stringified.includes('"') || stringified.includes('\n')) {
        return `"${stringified.replace(/"/g, '""')}"`;
      }
      return stringified;
    };

    let csvContent = headers.join(',') + '\n';
    
    for (const row of rowsRes.rows) {
      csvContent += [
        row.timestamp ? new Date(row.timestamp).toISOString() : '',
        row.action,
        JSON.stringify(row.new_value),
        row.official_name,
        row.tender_title,
        row.ip_address
      ].map(escapeCsv).join(',') + '\n';
    }

    res.send(csvContent);
  } catch (error) {
    console.error('Audit log export error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/officials
router.get('/officials', async (req, res) => {
  try {
    const rowsRes = await pool.query(`
      SELECT id, name, email, department, designation, role, loa_level, is_active, last_login_at 
      FROM officials 
      ORDER BY name ASC
    `);
    res.json(rowsRes.rows);
  } catch (error) {
    console.error('Officials fetch error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/officials/:id/role
router.put('/officials/:id/role', async (req, res) => {
  try {
    const { role } = req.body;
    if (!['ADMIN', 'OFFICER'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }
    
    const rowsRes = await pool.query(
      `UPDATE officials SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING id, role`,
      [role, req.params.id]
    );

    if (rowsRes.rowCount === 0) {
      return res.status(404).json({ error: 'Official not found' });
    }
    
    // Add audit log
    await pool.query(`
      INSERT INTO audit_log (official_id, action, new_value, ip_address, user_agent, timestamp)
      VALUES ($1, $2, $3, $4, $5, NOW())
    `, [req.session.officerId, 'OFFICIAL_ROLE_UPDATE', JSON.stringify({ official_id: req.params.id, role }), req.ip, req.headers['user-agent']]);

    res.json(rowsRes.rows[0]);
  } catch (error) {
    console.error('Update role error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/admin/officials/:id/status
router.put('/officials/:id/status', async (req, res) => {
  try {
    const { is_active } = req.body;
    
    const rowsRes = await pool.query(
      `UPDATE officials SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id, is_active`,
      [!!is_active, req.params.id]
    );

    if (rowsRes.rowCount === 0) {
      return res.status(404).json({ error: 'Official not found' });
    }
    
    // Add audit log
    await pool.query(`
      INSERT INTO audit_log (official_id, action, new_value, ip_address, user_agent, timestamp)
      VALUES ($1, $2, $3, $4, $5, NOW())
    `, [req.session.officerId, 'OFFICIAL_STATUS_UPDATE', JSON.stringify({ official_id: req.params.id, is_active: !!is_active }), req.ip, req.headers['user-agent']]);

    res.json(rowsRes.rows[0]);
  } catch (error) {
    console.error('Update status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/system-health
router.get('/system-health', async (req, res) => {
  try {
    let dbStatus = 'ok';
    try {
      await pool.query('SELECT 1');
    } catch (e) {
      dbStatus = 'error';
    }

    let pdfCount = 0;
    try {
      const storagePath = process.env.STORAGE_DIR || path.join(process.cwd(), 'storage');
      const files = await fs.readdir(storagePath);
      pdfCount = files.filter(f => f.endsWith('.pdf')).length;
    } catch (e) {
      // Ignore if dir doesn't exist
    }

    res.json({
      db: dbStatus,
      storage: { pdfCount },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('System health error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/admin/officials/:id/login-history
router.get('/officials/:id/login-history', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        a.id,
        a.action,
        a.ip_address,
        a.user_agent,
        a.timestamp,
        a.new_value
      FROM audit_log a
      WHERE a.official_id = $1
        AND a.action IN ('LOGIN', 'LOGOUT', 'LOGIN_FAILED', 'DEV_LOGIN', 'SESSION_REFRESH')
      ORDER BY a.timestamp DESC
      LIMIT 50
    `, [req.params.id]);

    res.json({ data: result.rows, meta: { total: result.rowCount } });
  } catch (error) {
    console.error('Login history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
