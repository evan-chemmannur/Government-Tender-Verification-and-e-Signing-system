import logger from '../utils/logger.js';
import { pool } from '../config/database.js';

const ABSOLUTE_SESSION_MAX_AGE = 8 * 60 * 60 * 1000; // 8 hours absolute cap
const IDLE_TIMEOUT = 30 * 60 * 1000; // 30 minutes idle timeout

/**
 * Monitors and enforces session limits.
 * Extends session on activity unless absolute cap is reached.
 */
export const sessionMonitor = async (req, res, next) => {
  if (!req.session || !req.session.officerId) {
    return next();
  }

  const now = Date.now();
  
  // Attach SAFE session info to Winston logger context (Security fix 3)
  // We only log a shortened session ID to prevent exposing sensitive tokens
  const safeSessionId = req.sessionID ? req.sessionID.substring(0, 8) + '...' : 'none';
  logger.defaultMeta = { ...logger.defaultMeta, session_id: safeSessionId, officer_id: req.session.officerId };

  // 1. Enforce Absolute Session Cap (Security fix 2)
  const sessionCreatedAt = new Date(req.session.loginAt).getTime();
  if (now - sessionCreatedAt > ABSOLUTE_SESSION_MAX_AGE) {
    logger.warn('Absolute session cap reached. Forcing re-authentication.');
    
    // Explicitly audit the absolute timeout (Security Fix 2)
    try {
      await pool.query(
        `INSERT INTO audit_log (official_id, action, ip_address, session_id) VALUES ($1, $2, $3, $4)`,
        [req.session.officerId, 'SESSION_FORCE_TERMINATED_ABSOLUTE_TIMEOUT', req.ip, req.sessionID]
      );
    } catch (err) {
      logger.error(`Failed to write audit log for session timeout: ${err.message}`);
    }

    req.session.destroy();
    res.clearCookie('tender.sid');
    return res.status(401).json({ error: 'Absolute session limit reached', redirect: '/auth/login' });
  }

  // 2. Enforce Idle Timeout
  const lastActivity = req.session.lastActivity || sessionCreatedAt;
  if (now - lastActivity > IDLE_TIMEOUT) {
    logger.warn('Session idle timeout reached. Destroying session.');
    
    // Audit the idle timeout as well for complete compliance
    try {
      await pool.query(
        `INSERT INTO audit_log (official_id, action, ip_address, session_id) VALUES ($1, $2, $3, $4)`,
        [req.session.officerId, 'SESSION_EXPIRED_IDLE', req.ip, req.sessionID]
      );
    } catch (err) {
      logger.error(`Failed to write audit log for idle timeout: ${err.message}`);
    }

    req.session.destroy();
    res.clearCookie('tender.sid');
    return res.status(401).json({ error: 'Session expired due to inactivity', redirect: '/auth/login' });
  }

  // 3. Extend Session Idle Timeout
  req.session.lastActivity = now;
  req.session.touch();

  next();
};
