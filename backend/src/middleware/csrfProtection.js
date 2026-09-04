/**
 * csrfProtection.js — CSRF Token Middleware for Government Tender Portal
 *
 * Strategy: Synchronizer Token Pattern (double-submit per session)
 *  - Token is generated per session and stored server-side in req.session
 *  - Client must send it via X-CSRF-Token header or _csrf body field
 *  - Verifies on every state-changing request (POST, PUT, DELETE, PATCH)
 *
 * Exemptions (OIDC callback + wallet deeplink must be exempt):
 *  - /auth/callback    — OIDC redirect, no session token yet
 *  - /api/wallet/*     — Inji Wallet app (native app, no session)
 *  - /.well-known/*    — Public metadata endpoints
 *  - /wallet-offer/*   — Pre-authorized code redemption
 *  - /health           — Health check
 */

import crypto from 'crypto';
import logger from '../utils/logger.js';

// ── Exempt paths (exact prefix match) ────────────────────────────────────────

const EXEMPT_PREFIXES = [
  '/auth/callback',
  '/auth/login',
  '/auth/dev-login',
  '/auth/logout',
  '/api/wallet',
  '/.well-known',
  '/wallet-offer',
  '/health',
  '/api/public',
];
// Methods that require CSRF protection
const PROTECTED_METHODS = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

// ── Token generation ──────────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure CSRF token (32 bytes = 64 hex chars).
 */
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Constant-time token comparison to prevent timing attacks.
 */
function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

// ── Main middleware ───────────────────────────────────────────────────────────

/**
 * CSRF protection middleware.
 *
 * Usage in app.js — mount AFTER session middleware:
 *   app.use(csrfProtection);
 *
 * Frontend usage:
 *   1. GET /auth/csrf-token → { csrfToken: "..." }
 *   2. Include on all mutations: Header X-CSRF-Token: <token>
 *      OR body field: _csrf: <token>
 */
export function csrfProtection(req, res, next) {
  // Skip for exempt paths
  const path = req.path;
  for (const prefix of EXEMPT_PREFIXES) {
    if (path.startsWith(prefix)) {
      return next();
    }
  }

  // Ensure session exists
  if (!req.session) {
    logger.error('[CSRF] No session found — session middleware must run before CSRF');
    return res.status(500).json({ error: 'Internal configuration error' });
  }

  // Generate token if session doesn't have one yet
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateToken();
  }

  // Attach token getter to res.locals for templates / JSON responses
  res.locals.csrfToken = req.session.csrfToken;

  // GET, HEAD, OPTIONS are safe — no verification needed
  if (!PROTECTED_METHODS.has(req.method)) {
    return next();
  }

  // Extract submitted token from header or body
  const submittedToken =
    req.headers['x-csrf-token'] ||
    req.headers['x-xsrf-token'] ||
    req.body?._csrf ||
    '';

  if (!submittedToken) {
    logger.warn(`[CSRF] Missing token on ${req.method} ${req.path} from IP ${req.ip}`);
    return res.status(403).json({
      error: 'CSRF token missing',
      hint: 'Include X-CSRF-Token header or _csrf body field',
    });
  }

  // Validate token length before comparison (prevent timing oracle on short input)
  if (submittedToken.length !== 64) {
    logger.warn(`[CSRF] Invalid token length on ${req.method} ${req.path} from IP ${req.ip}`);
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }

  // Constant-time comparison
  if (!safeCompare(submittedToken, req.session.csrfToken)) {
    logger.warn(`[CSRF] Token mismatch on ${req.method} ${req.path} from IP ${req.ip} (user: ${req.session?.user?.id || 'anonymous'})`);
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }

  // Token is valid — rotate it for the next request (optional but stronger)
  // Commented out as it breaks multi-tab usage; enable for highest-security flows:
  // req.session.csrfToken = generateToken();

  next();
}

// ── CSRF Token Endpoint ───────────────────────────────────────────────────────

/**
 * Express router handler to expose the CSRF token to the frontend.
 * Mount at:  GET /auth/csrf-token
 *
 * The frontend should call this once per page load and store the token
 * in memory (NOT localStorage) for use in subsequent API calls.
 */
export function csrfTokenHandler(req, res) {
  if (!req.session) {
    return res.status(500).json({ error: 'Session not available' });
  }

  // Ensure token exists
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateToken();
  }

  // Set SameSite cookie as additional layer (defence-in-depth)
  res.cookie('XSRF-TOKEN', req.session.csrfToken, {
    httpOnly: false,   // Must be readable by JS for Angular/Axios auto-read
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000, // 1 day
  });

  return res.json({ csrfToken: req.session.csrfToken });
}
