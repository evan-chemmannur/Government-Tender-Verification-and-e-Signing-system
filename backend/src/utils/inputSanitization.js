/**
 * inputSanitization.js — Server-Side Input Sanitization Utilities
 *
 * Provides:
 *  - sanitizeString: trim, null-byte removal, length cap, XSS stripping
 *  - sanitizeTenderId: validate government tender ID format
 *  - sanitizeGSTIN: validate 15-char GSTIN
 *  - sanitizeEmail: validate and normalize email
 *  - sanitizePhone: validate Indian phone numbers
 *  - sanitizeHtml: XSS-safe plain-text extraction (no DOM required)
 *  - sanitizeObject: recursively sanitize all string fields in an object
 *
 * Note: Uses only xss (pure Node.js) for XSS stripping — no DOM required.
 *       DOMPurify is intentionally avoided because it requires a DOM environment
 *       and creates Jest ESM compatibility issues.
 */

import validator from 'validator';
import xss from 'xss';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_STRING_LENGTH = 10_000;
const MAX_SHORT_STRING  = 500;

// Government of Maharashtra Tender ID format: XX-XXXX-YYYY-NNNN
// e.g., PW-ROAD-2024-0042 or GR-IT-2025-1234
const TENDER_ID_REGEX = /^[A-Z]{2}-[A-Z]{2,4}-[0-9]{4}-[0-9]{4}$/;

// GSTIN: 2-digit state + 10-char PAN + entity type + Z + checksum
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

// Indian phone: +91 or 0 prefix, then 10 digits (6xxx-9xxx)
const PHONE_REGEX = /^(\+91|0)?[6-9][0-9]{9}$/;

// ── XSS config: strip ALL tags + dangerous attributes ─────────────────────────

const XSS_OPTS = {
  whiteList: {},              // allow zero tags
  stripIgnoreTag: true,       // strip unknown tags entirely
  stripIgnoreTagBody: ['script', 'style', 'noscript', 'iframe', 'object'],
  onIgnoreTagAttr: () => '',  // strip all attributes on ignored tags
};

/**
 * Strip HTML tags and XSS payloads using the xss library (pure Node.js).
 * Also removes event handler attributes, javascript: URIs, and data: URIs.
 */
function stripXSS(str) {
  // First pass: xss library strips tags and dangerous content
  let clean = xss(str, XSS_OPTS);

  // Second pass: manually remove any remaining javascript: and data: URIs
  clean = clean.replace(/javascript\s*:/gi, '');
  clean = clean.replace(/vbscript\s*:/gi, '');
  clean = clean.replace(/data\s*:[^,]{0,50},/gi, '');

  // Remove any remaining on* event fragments that escaped the first pass
  clean = clean.replace(/on\w+\s*=/gi, '');

  return clean;
}

// ── Core Utilities ────────────────────────────────────────────────────────────

/**
 * Sanitize a generic string:
 *  1. Coerce to string
 *  2. Remove null bytes (\0)
 *  3. Trim whitespace
 *  4. Truncate to maxLength
 *  5. Strip XSS payloads (optional)
 *
 * @param {*}       value
 * @param {object}  opts
 * @param {number}  [opts.maxLength=10000]
 * @param {boolean} [opts.stripXss=true]
 * @returns {string}
 */
export function sanitizeString(value, opts = {}) {
  if (value === null || value === undefined) return '';

  const { maxLength = MAX_STRING_LENGTH, stripXss = true } = opts;

  let str = String(value);
  str = str.replace(/\0/g, '');  // Remove null bytes
  str = str.trim();
  if (str.length > maxLength) str = str.slice(0, maxLength);
  if (stripXss) str = stripXSS(str);

  return str;
}

/**
 * Sanitize and validate a Tender ID.
 * Format: [A-Z]{2}-[A-Z]{2,4}-[0-9]{4}-[0-9]{4}
 * Example: PW-ROAD-2024-0042
 *
 * @param {string} id
 * @returns {{ valid: boolean, value: string, error?: string }}
 */
export function sanitizeTenderId(id) {
  const cleaned = sanitizeString(id, { maxLength: 20, stripXss: false })
    .toUpperCase()
    .replace(/\s/g, '');

  if (!cleaned) {
    return { valid: false, value: '', error: 'Tender ID is required' };
  }
  if (!TENDER_ID_REGEX.test(cleaned)) {
    return {
      valid: false,
      value: cleaned,
      error: 'Invalid Tender ID format. Expected: XX-XXXX-YYYY-NNNN (e.g., PW-ROAD-2024-0042)',
    };
  }
  return { valid: true, value: cleaned };
}

/**
 * Sanitize and validate a GSTIN.
 * 15 characters: 2-digit state code + 10-char PAN + entity + Z + checksum
 * Example: 27AABCU9603R1ZX
 *
 * @param {string} gstin
 * @returns {{ valid: boolean, value: string, error?: string }}
 */
export function sanitizeGSTIN(gstin) {
  const cleaned = sanitizeString(gstin, { maxLength: 15, stripXss: false })
    .toUpperCase()
    .replace(/\s/g, '');

  if (!cleaned) {
    return { valid: false, value: '', error: 'GSTIN is required' };
  }
  if (cleaned.length !== 15) {
    return { valid: false, value: cleaned, error: `GSTIN must be exactly 15 characters (got ${cleaned.length})` };
  }
  if (!GSTIN_REGEX.test(cleaned)) {
    return { valid: false, value: cleaned, error: 'Invalid GSTIN format' };
  }
  return { valid: true, value: cleaned };
}

/**
 * Sanitize and validate an email address.
 *
 * @param {string} email
 * @returns {{ valid: boolean, value: string, error?: string }}
 */
export function sanitizeEmail(email) {
  const cleaned = sanitizeString(email, { maxLength: 254, stripXss: false }).toLowerCase();

  if (!cleaned) {
    return { valid: false, value: '', error: 'Email is required' };
  }
  if (!validator.isEmail(cleaned, { allow_utf8_local_part: false })) {
    return { valid: false, value: cleaned, error: 'Invalid email address' };
  }

  const normalized = validator.normalizeEmail(cleaned, {
    gmail_remove_dots: false,
    outlookdotcom_remove_subaddress: false,
  });

  return { valid: true, value: normalized || cleaned };
}

/**
 * Sanitize and validate an Indian phone number.
 * Accepts: +91XXXXXXXXXX, 0XXXXXXXXXX, or XXXXXXXXXX (10 digits starting 6-9)
 *
 * @param {string} phone
 * @returns {{ valid: boolean, value: string, error?: string }}
 */
export function sanitizePhone(phone) {
  const cleaned = sanitizeString(phone, { maxLength: 15, stripXss: false })
    .replace(/[\s\-().]/g, '');

  if (!cleaned) {
    return { valid: false, value: '', error: 'Phone number is required' };
  }
  if (!PHONE_REGEX.test(cleaned)) {
    return {
      valid: false,
      value: cleaned,
      error: 'Invalid Indian phone number. Must be 10 digits starting with 6-9 (optionally prefixed with +91 or 0)',
    };
  }

  // Normalize to +91XXXXXXXXXX
  let normalized = cleaned;
  if (normalized.startsWith('0')) {
    normalized = '+91' + normalized.slice(1);
  } else if (!normalized.startsWith('+91')) {
    normalized = '+91' + normalized;
  }
  return { valid: true, value: normalized };
}

/**
 * Strip all HTML tags from a string and return plain text.
 * Use for any user-supplied content rendered in documents or emails.
 * Pure Node.js — no DOM environment required.
 *
 * @param {string} html
 * @param {number} [maxLength=10000]
 * @returns {string}
 */
export function sanitizeHtml(html, maxLength = MAX_STRING_LENGTH) {
  if (!html) return '';
  const stripped = xss(String(html), XSS_OPTS);
  // Remove any residual tags via regex (belt-and-suspenders)
  const plainText = stripped.replace(/<[^>]*>/g, '').trim();
  return plainText.slice(0, maxLength);
}

/**
 * Recursively sanitize all string values in an object or array.
 *
 * @param {object|Array} obj
 * @param {object}       [opts] — passed to sanitizeString
 * @returns {object|Array}
 */
export function sanitizeObject(obj, opts = {}) {
  if (Array.isArray(obj)) {
    return obj.map((item) => sanitizeObject(item, opts));
  }
  if (obj !== null && typeof obj === 'object') {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = sanitizeObject(value, opts);
    }
    return result;
  }
  if (typeof obj === 'string') {
    return sanitizeString(obj, opts);
  }
  return obj;
}

// ── Express Middleware ────────────────────────────────────────────────────────

/**
 * Express middleware that sanitizes req.body and req.query.
 * Apply after body-parsing middleware.
 */
export function sanitizeRequestBody(req, _res, next) {
  if (req.body && typeof req.body === 'object') {
    req.body = sanitizeObject(req.body, { maxLength: MAX_SHORT_STRING });
  }
  if (req.query && typeof req.query === 'object') {
    req.query = sanitizeObject(req.query, { maxLength: 200 });
  }
  next();
}
