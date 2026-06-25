const { Pool } = require('pg');

const url = process.env.DATABASE_URL || '';
// Local Postgres (localhost) needs no SSL; hosted Postgres (Neon, Azure, etc.)
// requires it. Auto-detect so the same code works in dev and prod.
const isLocal = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url);
const useSsl =
  process.env.NODE_ENV === 'production' ||
  process.env.DB_SSL === 'true' ||
  /sslmode=require/.test(url) ||
  (url.length > 0 && !isLocal);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: useSsl ? { rejectUnauthorized: false } : false,
});

pool.on('connect', () => {
  console.log('✅ PostgreSQL connected');
});

pool.on('error', (err) => {
  console.error('PostgreSQL pool error:', err.message);
});

module.exports = pool;
