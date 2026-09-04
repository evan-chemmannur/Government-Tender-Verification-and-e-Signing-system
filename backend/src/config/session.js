import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { pool } from './database.js';
import { SESSION_SECRET, NODE_ENV } from './constants.js';

const PgSession = connectPgSimple(session);

export const sessionMiddleware = session({
    store: NODE_ENV === 'test'
      ? new session.MemoryStore()
      : new PgSession({
          pool: pool,
          tableName: 'sessions',
          createTableIfMissing: false,
          // Delegate cleanup to connect-pg-simple.
          // It automatically cleans expired sessions without us needing a setInterval loop.
          pruneSessionInterval: 60 * 60 // prune every 1 hour (in seconds)
      }),
    secret: SESSION_SECRET,
    name: 'tender.sid', // Custom cookie name for security
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: NODE_ENV === 'production',
        httpOnly: true,
        sameSite: NODE_ENV === 'production' ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 1 day cookie expiry (will be capped on server side)
    }
});
