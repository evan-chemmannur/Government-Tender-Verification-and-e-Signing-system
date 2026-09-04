import crypto from 'crypto';
import fs from 'fs/promises';
import { SignJWT, importPKCS8 } from 'jose';

let cachedPrivateKey = null;

/**
 * Generates PKCE parameters for OIDC Authorization Code Flow
 * @returns {{codeVerifier: string, codeChallenge: string}}
 */
export function generatePKCE() {
  // RFC 7636: code_verifier must be at least 43 characters
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  
  // S256 hash
  const hash = crypto.createHash('sha256').update(codeVerifier).digest();
  const codeChallenge = hash.toString('base64url');
  
  return { codeVerifier, codeChallenge };
}

/**
 * Generates a random state string for CSRF protection
 * @returns {string} base64url encoded 16-byte string
 */
export function generateState() {
  return crypto.randomBytes(16).toString('base64url');
}

/**
 * Generates a random nonce for ID Token validation (replay protection)
 * @returns {string} base64url encoded 16-byte string
 */
export function generateNonce() {
  return crypto.randomBytes(16).toString('base64url');
}

/**
 * Loads and caches the private key for private_key_jwt auth
 * @returns {Promise<any>} The parsed jose KeyLike object
 */
export async function loadPrivateKey() {
  if (cachedPrivateKey) {
    return cachedPrivateKey;
  }

  const keyPath = process.env.PRIVATE_KEY_PATH;
  if (!keyPath) {
    throw new Error('PRIVATE_KEY_PATH environment variable is not set');
  }

  const pem = await fs.readFile(keyPath, 'utf-8');
  // Load PKCS8 formatted RSA key
  cachedPrivateKey = await importPKCS8(pem, 'RS256');
  return cachedPrivateKey;
}

/**
 * Wraps jose.SignJWT to create standard JWTs
 * @param {Object} payload 
 * @param {any} privateKey 
 * @param {Object} options 
 * @param {string} options.issuer
 * @param {string} options.audience
 * @param {string} options.subject
 * @param {string} options.jwtid
 * @param {string} options.expirationTime
 * @returns {Promise<string>} Signed JWT string
 */
export async function signJWT(payload, privateKey, options) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(options.issuer)
    .setAudience(options.audience)
    .setSubject(options.subject)
    .setJti(options.jwtid)
    .setIssuedAt()
    .setExpirationTime(options.expirationTime)
    .sign(privateKey);
}
