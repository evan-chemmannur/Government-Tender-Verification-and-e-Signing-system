import pg from 'pg';

let _pool;

export function setPool(poolInstance) {
  _pool = poolInstance;
}

function getPoolOrThrow(prop) {
  if (!_pool) {
    throw new Error(
      `[database.js] Accessing pool.${prop} before initialization. ` +
      'In tests: call await setupTestDb() in beforeAll() before any query. ' +
      'In production: ensure database.js is imported after config load.'
    );
  }
  return _pool;
}

// Proxy all property accesses to the live `_pool` instance.
// This prevents early destructuring (import { pool } from './database.js')
// from capturing an undefined value or stale instance.
export const pool = new Proxy({}, {
  get(target, prop) {
    const realPool = getPoolOrThrow(prop);
    const value = realPool[prop];
    // If it's a function (like query, connect, end), bind it to the real pool
    if (typeof value === 'function') {
      return value.bind(realPool);
    }
    return value;
  }
});

// Production initialization — eagerly create pool if not in test env
if (process.env.NODE_ENV !== 'test') {
  const realPool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || 'postgres://localhost:5432/tender_db',
    max: 10,
    idleTimeoutMillis: 30000,
  });
  setPool(realPool);
}

// Keep testDbConnection for backwards compatibility with src/server.js
export async function testDbConnection(retries = 3, delay = 1000) {
  while (retries > 0) {
    try {
      const client = await pool.connect();
      client.release();
      return true;
    } catch (err) {
      retries -= 1;
      if (retries === 0) throw err;
      await new Promise(res => setTimeout(res, delay));
    }
  }
}
