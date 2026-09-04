import { createRemoteJWKSet } from 'jose';
import logger from '../utils/logger.js';

let jwksCache = null;

export const jwksService = {
  /**
   * Returns a function capable of fetching and validating signing keys.
   * Uses jose's highly optimized, production-tested HTTP caching 
   * via createRemoteJWKSet() to lazily load and cache keys.
   */
  getSigningKey() {
    if (!jwksCache) {
      const baseUrl = process.env.ESIGNET_BASE_URL || 'https://esignet.mosip.net';
      const jwksUri = process.env.ESIGNET_JWKS_URI || `${baseUrl}/.well-known/jwks.json`;
      
      logger.info(`Initializing JWKS remote key set from ${jwksUri}`);
      
      // Native jose remote key set with built-in caching and rotation support
      jwksCache = createRemoteJWKSet(new URL(jwksUri), {
        cacheMaxAge: 5 * 60 * 1000, // 5 minutes cache
        cooldownDuration: 30 * 1000, // 30s cooldown between failed fetches
      });
    }
    return jwksCache;
  }
};
