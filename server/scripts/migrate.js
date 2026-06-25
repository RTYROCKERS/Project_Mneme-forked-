/**
 * Simple, idempotent SQL migration runner.
 *
 * Runs every file in server/migrations/*.sql in filename order, inside a
 * transaction, and records applied files in a `_migrations` table so re-running
 * is safe (already-applied files are skipped).
 *
 * Usage:  node scripts/migrate.js        (from the server/ directory)
 *         npm run migrate
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const pool = require('../src/config/db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function ensureTrackingTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

async function appliedSet(client) {
  const { rows } = await client.query('SELECT filename FROM _migrations');
  return new Set(rows.map((r) => r.filename));
}

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set. Add it to server/.env first.');
    process.exit(1);
  }

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('No migration files found.');
    return;
  }

  const client = await pool.connect();
  try {
    await ensureTrackingTable(client);
    const done = await appliedSet(client);

    let ran = 0;
    for (const file of files) {
      if (done.has(file)) {
        console.log(`⏭️  skip   ${file} (already applied)`);
        continue;
      }
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      process.stdout.write(`▶️  apply  ${file} ... `);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO _migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        console.log('done');
        ran += 1;
      } catch (err) {
        await client.query('ROLLBACK');
        console.log('FAILED');
        console.error(`\n❌ Migration ${file} failed:\n${err.message}\n`);
        process.exit(1);
      }
    }
    console.log(`\n✅ Migrations complete. ${ran} applied, ${files.length - ran} skipped.`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('Migration runner error:', err.message);
  process.exit(1);
});
