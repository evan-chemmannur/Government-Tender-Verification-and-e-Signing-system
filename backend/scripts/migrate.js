// ---------------------------------------------------------------------------
// backend/scripts/migrate.js
// ---------------------------------------------------------------------------
// A standalone migration runner for the Government Tender Verification &
// e-Signing system.  Reads every *.sql file inside `database/migrations/`,
// executes the ones that have not yet been recorded in `migrations_log`, and
// wraps each execution in a transaction so a failure in one file doesn't leave
// the database half-migrated.
//
// Usage (from the backend/ directory):
//   node scripts/migrate.js              — run all pending migrations
//   node scripts/migrate.js --rollback   — remove the last migration record
//
// Environment:
//   DATABASE_URL must be set (directly or via ../.env).
// ---------------------------------------------------------------------------

import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// ── Resolve __dirname for ES modules ────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── Load environment variables ──────────────────────────────────────────────
// First try the project-root .env (one level above backend/), then fall back
// to the default dotenv.config() which searches cwd and parents.
const rootEnvPath = path.join(process.cwd(), '../.env');
if (fs.existsSync(rootEnvPath)) {
  dotenv.config({ path: rootEnvPath });
} else {
  dotenv.config();
}

// ── ANSI colour helpers ─────────────────────────────────────────────────────
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const RESET  = '\x1b[0m';

const logSuccess = (msg) => console.log(`${GREEN}✅ ${msg}${RESET}`);
const logWarning = (msg) => console.log(`${YELLOW}⚠️  ${msg}${RESET}`);
const logError   = (msg) => console.error(`${RED}❌ ${msg}${RESET}`);

// ── Database pool ───────────────────────────────────────────────────────────
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

// ── Ensure migrations_log table exists ──────────────────────────────────────
async function ensureMigrationsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS migrations_log (
      id          SERIAL        PRIMARY KEY,
      filename    VARCHAR(500)  UNIQUE NOT NULL,
      executed_at TIMESTAMPTZ   DEFAULT NOW()
    );
  `);
}

// ── Collect already-executed filenames ──────────────────────────────────────
async function getExecutedMigrations() {
  const { rows } = await pool.query(
    'SELECT filename FROM migrations_log ORDER BY filename;'
  );
  return new Set(rows.map((r) => r.filename));
}

// ── Read and sort all .sql files from the migrations directory ──────────────
function getMigrationFiles() {
  const migrationsDir = path.resolve(__dirname, '../../database/migrations');

  if (!fs.existsSync(migrationsDir)) {
    logError(`Migrations directory not found: ${migrationsDir}`);
    process.exit(1);
  }

  return fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()                                   // alphabetical / numeric sort
    .map((f) => ({
      filename: f,
      filepath: path.join(migrationsDir, f),
    }));
}

// ── Run all pending migrations ──────────────────────────────────────────────
async function runMigrations() {
  await ensureMigrationsTable();

  const executed = await getExecutedMigrations();
  const files    = getMigrationFiles();

  const pending = files.filter((f) => !executed.has(f.filename));

  if (pending.length === 0) {
    logWarning('No new migrations to run — database is up to date.');
    return;
  }

  console.log(`\nFound ${pending.length} pending migration(s):\n`);

  for (const { filename, filepath } of pending) {
    const client = await pool.connect();

    try {
      const sql = fs.readFileSync(filepath, 'utf-8');

      console.log(`  ▸ Running ${filename} …`);

      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO migrations_log (filename) VALUES ($1);',
        [filename]
      );
      await client.query('COMMIT');

      logSuccess(`  ${filename} applied successfully.`);
    } catch (err) {
      // Roll back the current transaction so the DB is not left in a dirty
      // state, then abort the entire migration run.
      await client.query('ROLLBACK');
      logError(`Migration ${filename} failed:`);
      console.error(err);
      process.exit(1);
    } finally {
      client.release();
    }
  }

  logSuccess('\nAll migrations applied successfully!\n');
}

// ── Rollback: remove the LAST migration record ─────────────────────────────
// Note: this does NOT reverse the SQL statements; it only removes the
// tracking row so the migration can be re-run after the developer manually
// undoes the changes.
async function rollback() {
  await ensureMigrationsTable();

  const { rows } = await pool.query(
    'SELECT id, filename FROM migrations_log ORDER BY id DESC LIMIT 1;'
  );

  if (rows.length === 0) {
    logWarning('Nothing to roll back — migrations_log is empty.');
    return;
  }

  const { id, filename } = rows[0];

  await pool.query('DELETE FROM migrations_log WHERE id = $1;', [id]);

  logWarning(`Removed migration record: ${filename}`);
  logWarning(
    'The SQL changes from that migration have NOT been reversed automatically.'
  );
  logWarning(
    'Please reverse the changes manually and then re-run migrations when ready.'
  );
}

// ── Entry point ─────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  try {
    if (args.includes('--rollback')) {
      await rollback();
    } else {
      await runMigrations();
    }
  } catch (err) {
    logError('Unexpected error:');
    console.error(err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
