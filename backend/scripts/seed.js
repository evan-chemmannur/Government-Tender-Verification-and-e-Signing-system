// ---------------------------------------------------------------------------
// backend/scripts/seed.js
// ---------------------------------------------------------------------------
// Seeds the database with development/test data by executing the SQL in
// `database/migrations/006_seed.sql`.  This script is intentionally guarded
// so it only runs when NODE_ENV === 'development'.
//
// Usage (from the backend/ directory):
//   NODE_ENV=development node scripts/seed.js
//
// Environment:
//   DATABASE_URL must be set (directly or via ../.env).
//   NODE_ENV     must equal 'development'.
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
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const RESET  = '\x1b[0m';

const logSuccess = (msg) => console.log(`${GREEN}${msg}${RESET}`);
const logWarning = (msg) => console.log(`${YELLOW}⚠️  ${msg}${RESET}`);
const logError   = (msg) => console.error(`${RED}❌ ${msg}${RESET}`);

// ── Guard: only allow in development ────────────────────────────────────────
if (process.env.NODE_ENV !== 'development') {
  logWarning(
    `NODE_ENV is "${process.env.NODE_ENV ?? '(not set)'}". ` +
    'Seed script is only allowed in development mode.'
  );
  logWarning('Set NODE_ENV=development and try again.');
  process.exit(1);
}

// ── Database pool ───────────────────────────────────────────────────────────
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

// ── Helpers for pretty table output ─────────────────────────────────────────
/**
 * Pads `str` to `width` characters (right-padded).
 */
function pad(str, width) {
  const s = String(str);
  return s + ' '.repeat(Math.max(0, width - s.length));
}

/**
 * Prints a simple box-drawing table to the console.
 *
 * @param {string[]}   headers  – column header labels
 * @param {string[][]} rows     – array of row arrays
 * @param {number[]}   widths   – column widths (character count)
 */
function printTable(headers, rows, widths) {
  const top    = '┌' + widths.map((w) => '─'.repeat(w + 2)).join('┬') + '┐';
  const mid    = '├' + widths.map((w) => '─'.repeat(w + 2)).join('┼') + '┤';
  const bottom = '└' + widths.map((w) => '─'.repeat(w + 2)).join('┴') + '┘';

  const formatRow = (cells) =>
    '│ ' + cells.map((c, i) => pad(c, widths[i])).join(' │ ') + ' │';

  console.log(top);
  console.log(`${BOLD}${formatRow(headers)}${RESET}`);
  console.log(mid);
  rows.forEach((row) => console.log(formatRow(row)));
  console.log(bottom);
}

// ── Main logic ──────────────────────────────────────────────────────────────
async function main() {
  const seedPath = path.resolve(__dirname, '../../database/migrations/006_seed.sql');

  if (!fs.existsSync(seedPath)) {
    logError(`Seed file not found: ${seedPath}`);
    logError('Make sure database/migrations/006_seed.sql exists.');
    process.exit(1);
  }

  const client = await pool.connect();

  try {
    const sql = fs.readFileSync(seedPath, 'utf-8');

    console.log(`\n${DIM}Running 006_seed.sql …${RESET}\n`);

    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');

    logSuccess('✅ Seed data inserted successfully!\n');

    // ── Query and display inserted officials ────────────────────────────
    const { rows: officials } = await client.query(
      'SELECT name, designation, aadhaar_sub FROM officials ORDER BY id;'
    );

    if (officials.length > 0) {
      console.log(`${CYAN}${BOLD}Test Officials:${RESET}`);
      printTable(
        ['Name', 'Designation', 'Aadhaar Sub'],
        officials.map((o) => [o.name, o.designation, o.aadhaar_sub]),
        [34, 20, 30]
      );
      console.log();
    }

    // ── Query and display inserted tenders ──────────────────────────────
    const { rows: tenders } = await client.query(
      'SELECT tender_id, title, status FROM tenders ORDER BY id;'
    );

    if (tenders.length > 0) {
      console.log(`${CYAN}${BOLD}Sample Tenders:${RESET}`);
      printTable(
        ['Tender ID', 'Title', 'Status'],
        tenders.map((t) => [
          t.tender_id,
          t.title.length > 45 ? t.title.slice(0, 42) + '...' : t.title,
          t.status,
        ]),
        [22, 45, 22]
      );
      console.log();
    }

    logSuccess('Use the Aadhaar Sub values above to simulate login in development.\n');
  } catch (err) {
    await client.query('ROLLBACK');
    logError('Seed script failed:');
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
