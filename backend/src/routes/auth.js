import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { generateState, generateNonce } from '../utils/crypto.js';
import { authService } from '../services/authService.js';
import { nonceStore } from '../services/nonceStore.js';
import { pool } from '../config/database.js';
import { requireAuth } from '../middleware/auth.js';
import logger from '../utils/logger.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts from this IP, please try again after 15 minutes' }
});

router.get('/login-url', loginLimiter, async (req, res) => {
  try {
    const requestedAcr = req.query.acr === 'otp' ? 'LOA_2_OTP' : 'LOA_3_BIOMETRIC';
    const { codeVerifier, codeChallenge } = authService.generatePKCE();
    const state = generateState();
    const nonce = generateNonce();

    // Store securely in DB
    await nonceStore.storeNonce(nonce);

    req.session.codeVerifier = codeVerifier;
    req.session.state = state;
    req.session.nonce = nonce;
    req.session.acrRequested = requestedAcr;

    const authUrl = authService.buildAuthorizationURL({
      acr_values: requestedAcr,
      state,
      nonce,
      codeChallenge
    });

    logger.info(`Login URL generated for IP ${req.ip}`);
    res.json({ url: authUrl });
  } catch (error) {
    logger.error(`Login URL generation failed: ${error.message}`);
    res.status(500).json({ error: 'internal_error' });
  }
});

router.get('/login', loginLimiter, async (req, res) => {
  try {
    const requestedAcr = req.query.acr === 'otp' ? 'LOA_2_OTP' : 'LOA_3_BIOMETRIC';
    const { codeVerifier, codeChallenge } = authService.generatePKCE();
    const state = generateState();
    const nonce = generateNonce();

    await nonceStore.storeNonce(nonce);

    req.session.codeVerifier = codeVerifier;
    req.session.state = state;
    req.session.nonce = nonce;
    req.session.acrRequested = requestedAcr;

    const authUrl = authService.buildAuthorizationURL({
      acr_values: requestedAcr,
      state,
      nonce,
      codeChallenge
    });

    logger.info(`Login initiated for IP ${req.ip}`);
    res.redirect(302, authUrl);
  } catch (error) {
    logger.error(`Login initiation failed: ${error.message}`);
    res.redirect('/login?error=internal_error');
  }
});

router.get('/callback', async (req, res) => {
  try {
    const { state, code, error, error_description } = req.query;

    if (error) {
      logger.warn(`eSignet returned error: ${error} - ${error_description}`);
      return res.redirect(`/login?error=${encodeURIComponent(error)}`);
    }

    if (!state || state !== req.session.state) {
      return res.redirect('/login?error=invalid_state');
    }

    if (!code) {
      return res.redirect('/login?error=missing_code');
    }

    const { codeVerifier, nonce, acrRequested } = req.session;

    if (!codeVerifier || !nonce) {
      return res.redirect('/login?error=session_expired');
    }

    // Verify nonce hasn't been replayed
    const isValidNonce = await nonceStore.isValid(nonce);
    if (!isValidNonce) {
      logger.warn(`Replay attack detected or nonce expired: ${nonce}`);
      return res.redirect('/login?error=invalid_nonce');
    }

    const tokens = await authService.exchangeCodeForTokens(code, codeVerifier);
    const claims = await authService.validateIdToken(tokens.id_token, nonce);

    // Mark nonce as used permanently
    await nonceStore.markUsed(nonce);

    let returnedAcr = 'LOA_2_OTP';
    if (claims.acr === 'LOA_3_BIOMETRIC' || claims.acr === 'bio') {
      returnedAcr = 'LOA_3_BIOMETRIC';
    }
    
    if (acrRequested === 'LOA_3_BIOMETRIC' && returnedAcr !== 'LOA_3_BIOMETRIC') {
      return res.redirect('/login?error=insufficient_loa');
    }

    const officer = await authService.getOrCreateOfficer(claims, pool);

    await pool.query(
      `INSERT INTO audit_log (official_id, action, ip_address, user_agent, session_id) VALUES ($1, $2, $3, $4, $5)`,
      [officer.id, 'LOGIN_SUCCESS', req.ip, req.headers['user-agent'], req.sessionID]
    );

    req.session.regenerate((err) => {
      if (err) throw err;
      req.session.officerId = officer.id;
      req.session.officerName = officer.name;
      req.session.loa = officer.loa_level;
      req.session.role = officer.role;
      req.session.loginAt = new Date().toISOString();
      req.session.lastActivity = Date.now();

      logger.info(`Officer ${officer.id} logged in successfully`);
      res.redirect('/dashboard');
    });

  } catch (err) {
    logger.error(`Callback processing failed: ${err.message}`, err);
    res.redirect('/login?error=auth_failed');
  }
});

router.post('/logout', requireAuth, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO audit_log (official_id, action, ip_address, user_agent, session_id) VALUES ($1, $2, $3, $4, $5)`,
      [req.officer.id, 'LOGOUT', req.ip, req.headers['user-agent'], req.sessionID]
    );

    req.session.destroy((err) => {
      if (err) logger.error(`Session destruction failed: ${err.message}`);
      res.clearCookie('tender.sid');
      res.json({ success: true, message: 'Logged out successfully' });
    });
  } catch (error) {
    logger.error(`Logout failed: ${error.message}`);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({
    id: req.officer.id,
    name: req.officer.name,
    role: req.officer.role,
    loa: req.officer.loa,
    loginAt: req.session.loginAt
  });
});

router.get('/status', (req, res) => {
  if (!req.session || !req.session.officerId) {
    return res.json({ authenticated: false });
  }

  const IDLE_TIMEOUT = 30 * 60 * 1000;
  const ABSOLUTE_MAX = 8 * 60 * 60 * 1000;
  const now = Date.now();

  const sessionCreatedAt = new Date(req.session.loginAt).getTime();
  const lastActivity = req.session.lastActivity || sessionCreatedAt;

  const timeSinceActivity = now - lastActivity;
  const timeSinceLogin = now - sessionCreatedAt;

  const idleExpiresIn = IDLE_TIMEOUT - timeSinceActivity;
  const absoluteExpiresIn = ABSOLUTE_MAX - timeSinceLogin;
  
  // Whichever is smaller
  const expiresIn = Math.min(idleExpiresIn, absoluteExpiresIn);

  if (expiresIn <= 0) {
    return res.json({ authenticated: false });
  }

  res.json({
    authenticated: true,
    officerName: req.session.officerName,
    loa: req.session.loa,
    expiresIn
  });
});

router.post('/refresh', requireAuth, (req, res) => {
  const IDLE_TIMEOUT = 30 * 60 * 1000;
  const now = Date.now();
  const sessionCreatedAt = new Date(req.session.loginAt).getTime();

  // If within 5 minutes of idle expiry, extend it
  const timeSinceActivity = now - req.session.lastActivity;
  if (IDLE_TIMEOUT - timeSinceActivity <= 5 * 60 * 1000) {
    req.session.lastActivity = now;
    req.session.touch();
    logger.info(`Session extended manually for officer ${req.session.officerId}`);
    return res.json({ success: true, message: 'Session extended' });
  }

  res.json({ success: true, message: 'Session does not need extension yet' });
});

// Demo / Dev login (enabled for testing/evaluation)
if (process.env.ENABLE_DEV_LOGIN !== 'false') {
  router.post('/dev-login', async (req, res) => {
    const { aadhaar_sub, role, loa_level } = req.body;
    
    // Validate inputs
    const validRoles = ['VIEWER', 'OFFICER', 'SENIOR_OFFICER', 'ADMIN', 'SUPER_ADMIN'];
    const validLoAs = ['LOA_2_OTP', 'LOA_2_DEMOGRAPHIC', 'LOA_3_BIOMETRIC'];
    
    if (!aadhaar_sub || !validRoles.includes(role) || !validLoAs.includes(loa_level)) {
      return res.status(400).json({ error: 'Invalid dev-login params' });
    }
    
    // Upsert official
    const { rows } = await pool.query(`
      INSERT INTO officials (aadhaar_sub, name, role, loa_level, is_active)
      VALUES ($1, $2, $3, $4, true)
      ON CONFLICT (aadhaar_sub) DO UPDATE 
        SET role = EXCLUDED.role, loa_level = EXCLUDED.loa_level, last_login_at = NOW()
      RETURNING *
    `, [aadhaar_sub, ('Dev ' + role), role, loa_level]);
    
    const officer = rows[0];
    
    // Create session
    req.session.regenerate((err) => {
      if (err) return res.status(500).json({ error: 'Session error' });
      req.session.officerId = officer.id;
      req.session.officerName = officer.name;
      req.session.loa = loa_level;
      req.session.role = role;
      req.session.loginAt = new Date().toISOString();
      
      res.json({ 
        success: true, 
        officer: { id: officer.id, name: officer.name, role, loa_level },
        message: 'DEV ONLY — not for production use'
      });
    });
  });
}

export default router;
