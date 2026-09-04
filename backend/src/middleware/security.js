/**
 * security.js — Comprehensive Security Middleware for Government Tender Portal
 *
 * Implements:
 *  1. Content Security Policy (CSP) via helmet
 *  2. Request validation (suspicious headers, SQL injection, Content-Type)
 *  3. IP-based rate limiting per route group
 *  4. JTI replay prevention with in-memory TTL store
 *  5. Audit logging middleware (never logs passwords/tokens/keys)
 */

import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import logger from '../utils/logger.js';
import { FRONTEND_URL, NODE_ENV } from '../config/constants.js';

// ── 1. Content Security Policy (CSP) ─────────────────────────────────────────

const ESIGNET_DOMAIN = process.env.ESIGNET_BASE_URL || 'https://sandbox.esignet.io';
const INJI_DOMAIN    = process.env.INJI_CERTIFY_BASE_URL || 'https://api.certify.mosip.net';

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'", ESIGNET_DOMAIN, "'strict-dynamic'"],
      styleSrc:       ["'self'", "'unsafe-inline'"], // inline styles required by React
      imgSrc:         ["'self'", 'data:', 'blob:'],
      fontSrc:        ["'self'", 'data:'],
      connectSrc:     ["'self'", ESIGNET_DOMAIN, INJI_DOMAIN],
      frameSrc:       ["'none'"],
      frameAncestors: ["'none'"], // Prevents clickjacking
      objectSrc:      ["'none'"],
      baseUri:        ["'self'"],
      formAction:     ["'self'"],
      upgradeInsecureRequests: NODE_ENV === 'production' ? [] : null,
    },
    reportOnly: false,
  },
  crossOriginOpenerPolicy:   { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-site' },
  referrerPolicy:            { policy: 'strict-origin-when-cross-origin' },
  hsts: {
    maxAge: 31_536_000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  noSniff: true,
  xssFilter: true,
  hidePoweredBy: true,
});

// ── 2. Request Validation Middleware ─────────────────────────────────────────

/**
 * SQL injection patterns to block in URL path + query string.
 * Covers the most common UNION-based, boolean-blind, and stacked-query attacks.
 */
const SQL_INJECTION_PATTERNS = [
  /(\bUNION\b.*\bSELECT\b)/i,
  /(\bSELECT\b.*\bFROM\b)/i,
  /(\bDROP\b.*\bTABLE\b)/i,
  /(\bINSERT\b.*\bINTO\b)/i,
  /(\bDELETE\b.*\bFROM\b)/i,
  /(\bOR\b\s+\b1\b\s*=\s*\b1\b)/i,
  /(\bAND\b\s+\b1\b\s*=\s*\b1\b)/i,
  /(--\s*$)/m,
  /(;\s*(DROP|DELETE|UPDATE|INSERT|CREATE|ALTER)\b)/i,
  /(\bEXEC\b|\bEXECUTE\b)\s*\(/i,
  /\bxp_cmdshell\b/i,
  /\bINFORMATION_SCHEMA\b/i,
];

/** Suspicious request headers that may indicate probing / fingerprinting */
const SUSPICIOUS_HEADERS = [
  'x-forwarded-host',    // Host header injection
  'x-original-url',     // URL override attack
  'x-rewrite-url',
  'x-custom-ip-authorization',
];

/**
 * Validates incoming requests for:
 *  - Suspicious headers
 *  - SQL injection in URL
 *  - Correct Content-Type on POST/PUT/PATCH
 *  - Request size already handled by express.json({ limit: '10mb' })
 */
export function requestValidator(req, res, next) {
  // Check for suspicious headers (except in development for easier testing)
  if (NODE_ENV === 'production') {
    for (const h of SUSPICIOUS_HEADERS) {
      if (req.headers[h]) {
        logger.warn(`[Security] Suspicious header detected: ${h} from IP ${req.ip}`);
        return res.status(400).json({ error: 'Bad request' });
      }
    }
  }

  // SQL injection check on the full URL (path + query string)
  const fullUrl = decodeURIComponent(req.url);
  for (const pattern of SQL_INJECTION_PATTERNS) {
    if (pattern.test(fullUrl)) {
      logger.warn(`[Security] SQL injection pattern detected in URL: ${req.url} from IP ${req.ip}`);
      return res.status(400).json({ error: 'Bad request' });
    }
  }

  // Enforce Content-Type for state-changing requests
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const ct = req.headers['content-type'] || '';
    const isMultipart   = ct.startsWith('multipart/form-data');
    const isJson        = ct.includes('application/json');
    const isUrlEncoded  = ct.includes('application/x-www-form-urlencoded');

    // Only enforce if there's actually a body
    if (req.headers['content-length'] && req.headers['content-length'] !== '0') {
      if (!isJson && !isMultipart && !isUrlEncoded) {
        logger.warn(`[Security] Invalid Content-Type: "${ct}" on ${req.method} ${req.path} from IP ${req.ip}`);
        return res.status(415).json({ error: 'Unsupported Media Type' });
      }
    }
  }

  next();
}

// ── 3. IP-Based Rate Limiters ────────────────────────────────────────────────

/** /auth/login: 5 attempts per 15 minutes per IP */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  handler: (req, res) => {
    logger.warn(`[Security] Login rate limit exceeded for IP ${req.ip}`);
    res.status(429).json({
      error: 'Too many login attempts. Please try again after 15 minutes.',
      retryAfter: Math.ceil(15 * 60),
    });
  },
});

/** /api/*: 100 requests per minute per IP */
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  handler: (req, res) => {
    logger.warn(`[Security] API rate limit exceeded for IP ${req.ip} on ${req.path}`);
    res.status(429).json({
      error: 'Too many requests. Please slow down.',
      retryAfter: 60,
    });
  },
});

/** /verify (public): 1000 requests per minute — must be permissive for QR scans */
export const verifyRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip,
  handler: (req, res) => {
    res.status(429).json({ error: 'Verification rate limit exceeded. Please try again shortly.' });
  },
});

// ── 4. JTI Replay Prevention ─────────────────────────────────────────────────

/**
 * In-memory JTI store with per-entry expiry.
 * For production at scale, swap this map for a Redis SET with TTL.
 */
const _jtiStore = new Map(); // jti → expiresAt (ms timestamp)

/** Called during OIDC token validation to prevent JTI replay attacks */
export function jtiReplayPrevention(jti, expiresInSeconds = 600) {
  const now = Date.now();

  // Reject already-used JTIs
  if (_jtiStore.has(jti)) {
    const exp = _jtiStore.get(jti);
    if (exp > now) {
      logger.warn(`[Security] JTI replay attack detected: ${jti}`);
      return false; // REJECT
    }
    // If it's expired, allow it to be cleaned up and continue
  }

  // Mark JTI as used with expiry
  _jtiStore.set(jti, now + expiresInSeconds * 1000);
  return true; // ALLOW
}

/** Cleanup expired JTIs every 10 minutes to prevent unbounded memory growth */
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const [jti, exp] of _jtiStore.entries()) {
    if (exp <= now) {
      _jtiStore.delete(jti);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    logger.debug(`[Security] JTI store cleanup: removed ${cleaned} expired entries. Remaining: ${_jtiStore.size}`);
  }
}, 10 * 60 * 1000);

// ── 5. Audit Logging Middleware ───────────────────────────────────────────────

/** Fields that must NEVER appear in audit logs */
const SENSITIVE_FIELDS = new Set([
  'password', 'token', 'access_token', 'refresh_token', 'id_token',
  'private_key', 'secret', 'authorization', 'cookie', 'session',
  'client_secret', 'passphrase', 'pin', 'otp', 'jti',
]);

/** Suspicious patterns in request that should be flagged */
const SUSPICIOUS_AUDIT_PATTERNS = [
  { pattern: /\.\.(\/|\\)/, label: 'path traversal' },
  { pattern: /<script[\s>]/i, label: 'XSS attempt' },
  { pattern: /javascript:/i, label: 'JS injection' },
  { pattern: /\beval\s*\(/i, label: 'eval injection' },
];

/**
 * Strips sensitive fields from an object (shallow).
 */
function redactSensitive(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = SENSITIVE_FIELDS.has(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return result;
}

/**
 * Audit logging middleware.
 * Logs: method, path, IP, user-agent, user (if authed), status, duration.
 * Flags suspicious patterns.
 * Never logs passwords, tokens, or private keys.
 */
export function auditLogger(req, res, next) {
  const startAt = process.hrtime.bigint();

  // Sanitise headers for logging — redact auth/cookie
  const safeHeaders = redactSensitive({
    'user-agent':  req.headers['user-agent'],
    'content-type': req.headers['content-type'],
    'x-request-id': req.headers['x-request-id'],
  });

  // Check for suspicious patterns in the raw URL
  const urlToCheck = decodeURIComponent(req.url);
  const flags = [];
  for (const { pattern, label } of SUSPICIOUS_AUDIT_PATTERNS) {
    if (pattern.test(urlToCheck)) {
      flags.push(label);
    }
  }

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startAt) / 1_000_000;
    const userId = req.session?.user?.id || req.user?.id || 'anonymous';

    const logEntry = {
      method:   req.method,
      path:     req.path,
      query:    Object.keys(req.query).length ? redactSensitive(req.query) : undefined,
      ip:       req.ip,
      userId,
      status:   res.statusCode,
      duration: `${durationMs.toFixed(2)}ms`,
      headers:  safeHeaders,
    };

    if (flags.length > 0) {
      logEntry.flags = flags;
      logger.warn(`[AUDIT][SUSPICIOUS] ${req.method} ${req.path}`, logEntry);
    } else if (res.statusCode >= 500) {
      logger.error(`[AUDIT] ${req.method} ${req.path} → ${res.statusCode}`, logEntry);
    } else if (res.statusCode >= 400) {
      logger.warn(`[AUDIT] ${req.method} ${req.path} → ${res.statusCode}`, logEntry);
    } else {
      logger.info(`[AUDIT] ${req.method} ${req.path} → ${res.statusCode}`, logEntry);
    }
  });

  next();
}
