import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import { sessionMiddleware } from './config/session.js';
import connectPgSimple from 'connect-pg-simple';
import { sessionMonitor } from './middleware/sessionMiddleware.js';
import { pool } from './config/database.js';
import { SESSION_SECRET, FRONTEND_URL, NODE_ENV } from './config/constants.js';
import logger from './utils/logger.js';

// ── Route imports ─────────────────────────────────────────────────────────────
import authRouter from './routes/auth.js';
import tendersRouter from './routes/tenders.js';
import documentsRouter from './routes/documents.js';
import pdfsRouter from './routes/pdfs.js';
import verifyRouter from './routes/verify.js';
import publicVerifyRouter from './routes/publicVerify.js';
import walletDeliveryRouter from './routes/walletDelivery.js';
import statusListRouter from './routes/statusList.js';
import didRouter from './routes/did.js';
import awardLettersRouter from './routes/awardLetters.js';
import adminRouter from './routes/admin.js';

// ── Task 16: Security middleware imports ──────────────────────────────────────
import {
  securityHeaders,
  requestValidator,
  loginRateLimiter,
  apiRateLimiter,
  verifyRateLimiter,
  auditLogger,
} from './middleware/security.js';
import { csrfProtection, csrfTokenHandler } from './middleware/csrfProtection.js';
import { sanitizeRequestBody } from './utils/inputSanitization.js';

const app = express();
app.set('trust proxy', 1);
const PgSession = connectPgSimple(session);

app.use(securityHeaders);

const allowedOrigins = [
  FRONTEND_URL ? FRONTEND_URL.replace(/\/$/, '') : null,
  'http://localhost:3000',
  'http://localhost:3001'
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (
      allowedOrigins.includes(origin) ||
      origin.endsWith('.vercel.app') ||
      origin.includes('localhost')
    ) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'X-XSRF-Token'],
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(requestValidator);
app.use(sanitizeRequestBody);
app.use(sessionMiddleware);

// Ignore CSRF for specific endpoints like public verify or wallet
const csrfMiddleware = (req, res, next) => {
  if (req.path.startsWith('/api/public') || req.path.startsWith('/api/wallet') || req.path.startsWith('/.well-known')) {
    return next();
  }
  return csrfProtection(req, res, next);
};

app.use(csrfMiddleware);
app.use(auditLogger);
app.use(sessionMonitor);

app.get('/auth/csrf-token', csrfTokenHandler);

// Route-Specific Rate Limiters
app.use('/auth/login', loginRateLimiter);
app.use('/api/public', verifyRateLimiter);
app.use('/api', apiRateLimiter);

// ── Application Routes ────────────────────────────────────────────────────────
app.use('/auth', authRouter);
app.use('/api/tenders', tendersRouter);
app.use('/api/tenders', documentsRouter);
app.use('/api/tenders', pdfsRouter);
app.use('/api/tenders', awardLettersRouter);
app.use('/api', publicVerifyRouter);
app.use('/api/wallet', walletDeliveryRouter);
app.use('/.well-known', statusListRouter);
app.use('/.well-known', didRouter);
app.use('/api/admin', adminRouter);
app.use('/verify', verifyRouter);

// Short code handler from walletDeliveryRouter
app.use('/wallet-offer', walletDeliveryRouter);
// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/health/ready', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ready', timestamp: new Date().toISOString() });
    } catch (error) {
        logger.error('Readiness probe failed:', error);
        res.status(503).json({ status: 'error', message: 'Database not ready' });
    }
});

// ── Global Error Handler ──────────────────────────────────────────────────────
app.use((err, req, res, next) => {
    logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
    res.status(err.status || 500).json({
        error: err.message || 'Internal Server Error',
        ...(NODE_ENV === 'development' ? { stack: err.stack } : {}),
    });
});

export default app;
