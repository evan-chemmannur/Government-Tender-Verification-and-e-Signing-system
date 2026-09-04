import express from 'express';
import session from 'express-session';
import request from 'supertest';
import { jest } from '@jest/globals';
import { sessionMiddleware } from '../src/config/session.js';
import { sessionMonitor } from '../src/middleware/sessionMiddleware.js';

// Setup environment
process.env.ESIGNET_BASE_URL = 'https://esignet.mosip.net';
process.env.CLIENT_ID = 'test-client';
process.env.REDIRECT_URI = 'http://localhost:3001/auth/callback';
process.env.PRIVATE_KEY_PATH = './fake-key.pem';
process.env.SESSION_SECRET = 'test-secret';

// Import nonceStore which uses the global pg-mem pool from setup.js
const { nonceStore } = await import('../src/services/nonceStore.js');
const { jwksService } = await import('../src/services/jwksCache.js');

import { setupTestDb, teardownTestDb } from './setup.js';

describe('Session & Security Services', () => {
  beforeAll(async () => {
    await setupTestDb();
  });
  afterAll(async () => {
    await teardownTestDb();
  });

  describe('nonceStore.js', () => {
    it('storeNonce stores a new nonce successfully', async () => {
      // Should resolve without error for a fresh nonce
      await expect(nonceStore.storeNonce(`nonce-fresh-${Date.now()}`)).resolves.toBeUndefined();
    });

    it('storeNonce prevents duplicates (replay prevention)', async () => {
      const duplicateNonce = `nonce-dup-${Date.now()}`;
      // Store once successfully
      await nonceStore.storeNonce(duplicateNonce);
      // Second store of same nonce should throw
      await expect(nonceStore.storeNonce(duplicateNonce)).rejects.toThrow('Nonce already exists');
    });

    it('markUsed prevents reusing the same nonce', async () => {
      const nonce = `nonce-mark-${Date.now()}`;
      await nonceStore.storeNonce(nonce);
      await nonceStore.markUsed(nonce);
      // Marking again should fail (already used)
      await expect(nonceStore.markUsed(nonce)).rejects.toThrow('Nonce not found or already used');
    });

    it('isValid returns true for unused nonces', async () => {
      const nonce = `nonce-valid-${Date.now()}`;
      await nonceStore.storeNonce(nonce);
      const valid = await nonceStore.isValid(nonce);
      expect(valid).toBe(true);
    });

    it('isValid returns false for used nonces', async () => {
      const nonce = `nonce-used-${Date.now()}`;
      await nonceStore.storeNonce(nonce);
      await nonceStore.markUsed(nonce);
      const valid = await nonceStore.isValid(nonce);
      expect(valid).toBe(false);
    });
  });

  describe('jwksCache.js', () => {
    it('returns a caching remote JWK set', () => {
      const getSigningKey = jwksService.getSigningKey();
      expect(typeof getSigningKey).toBe('function'); // createRemoteJWKSet returns a function
    });
  });

  describe('Session Middleware', () => {
    let testApp;

    beforeAll(() => {
      testApp = express();
      // Use a simple memory session for these middleware tests (not pg-mem)
      testApp.use(session({
        secret: 'test-secret',
        resave: false,
        saveUninitialized: false,
      }));
      testApp.use(sessionMonitor);
      testApp.get('/test', (req, res) => {
        req.session.officerId = 'usr_test';
        req.session.loginAt = new Date(Date.now()).toISOString();
        req.session.lastActivity = Date.now();
        res.json({ ok: true });
      });
    });

    it('session middleware attaches and responds correctly', async () => {
      const res = await request(testApp).get('/test');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });

    it('destroys session on idle timeout', async () => {
      const app2 = express();
      app2.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
      app2.use((req, res, next) => {
        req.session.officerId = 'usr1';
        req.session.loginAt = new Date(Date.now() - (31 * 60 * 1000)).toISOString();
        req.session.lastActivity = Date.now() - (31 * 60 * 1000); // 31 min ago
        next();
      });
      app2.use(sessionMonitor);
      app2.get('/idle', (req, res) => res.json({ officerId: req.session.officerId || null }));

      const res = await request(app2).get('/idle');
      expect(res.status).toBe(401);
      // After idle timeout, session user is cleared and 401 is returned
      expect(res.body.error).toBe('Session expired due to inactivity');
    });

    it('destroys session on absolute cap', async () => {
      const app3 = express();
      app3.use(session({ secret: 'test-secret', resave: false, saveUninitialized: false }));
      app3.use((req, res, next) => {
        req.session.officerId = 'usr2';
        req.session.loginAt = new Date(Date.now() - (9 * 60 * 60 * 1000)).toISOString(); // 9 hours ago
        req.session.lastActivity = Date.now();
        next();
      });
      app3.use(sessionMonitor);
      app3.get('/cap', (req, res) => res.json({ officerId: req.session.officerId || null }));

      const res = await request(app3).get('/cap');
      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Absolute session limit reached');
    });
  });
});
