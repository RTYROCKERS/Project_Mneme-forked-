/**
 * One-shot migration: re-embed every memory through the ACTIVE Azure embedding
 * model (text-embedding-3-small, 1536-dim) and rebuild the knowledge-graph
 * links. Required because the stored vectors were Gemini gemini-embedding-001
 * (3072-dim) — a different vector space. Mixing spaces silently breaks recall.
 *
 * Idempotent: safe to re-run (it overwrites embeddings + rebuilds links).
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');
const azure = require('../src/config/azureProvider');
const { cosineSimilarity } = require('../src/engines/embeddingEngine');

const LINK_AT = 0.45;
const DEDUPE_AT = 0.78;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function reembedAll() {
  const { rows } = await pool.query(
    `SELECT id, user_id, card FROM memories WHERE card IS NOT NULL ORDER BY created_at`
  );
  console.log(`Re-embedding ${rows.length} memories via Azure...`);
  let ok = 0, fail = 0;
  for (const m of rows) {
    try {
      const vec = await azure.embedText(m.card);
      await pool.query('UPDATE memories SET embedding = $1 WHERE id = $2', [
        JSON.stringify(vec),
        m.id,
      ]);
      ok++;
      process.stdout.write('.');
      await sleep(120); // gentle throttle
    } catch (e) {
      fail++;
      console.log(`\n  FAIL ${m.id}: ${e.status || ''} ${e.message}`);
    }
  }
  console.log(`\nRe-embed done: ${ok} ok, ${fail} failed.`);
}

async function rebuildLinks() {
  console.log('Rebuilding memory_links in Azure space...');
  await pool.query('DELETE FROM memory_links');

  const { rows: users } = await pool.query(
    `SELECT DISTINCT user_id FROM memories WHERE status = 'active'`
  );
  let edges = 0;
  for (const { user_id } of users) {
    const { rows: mems } = await pool.query(
      `SELECT id, embedding FROM memories
       WHERE user_id = $1 AND status = 'active' AND embedding IS NOT NULL`,
      [user_id]
    );
    const parsed = mems.map((m) => ({
      id: m.id,
      vec: typeof m.embedding === 'string' ? JSON.parse(m.embedding) : m.embedding,
    }));
    for (let i = 0; i < parsed.length; i++) {
      for (let j = i + 1; j < parsed.length; j++) {
        const sim = cosineSimilarity(parsed[i].vec, parsed[j].vec);
        if (sim >= LINK_AT && sim < DEDUPE_AT) {
          const a = parsed[i].id, b = parsed[j].id;
          const lo = a < b ? a : b;
          const hi = a < b ? b : a;
          await pool.query(
            `INSERT INTO memory_links (user_id, memory_a, memory_b, similarity)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (memory_a, memory_b) DO UPDATE SET similarity = $4`,
            [user_id, lo, hi, sim]
          );
          edges++;
        }
      }
    }
  }
  console.log(`Rebuilt ${edges} links across ${users.length} users.`);
}

(async () => {
  try {
    if (!azure.isConfigured()) throw new Error('Azure provider not configured — check .env');
    await reembedAll();
    await rebuildLinks();
    console.log('\n✅ Migration complete.');
  } catch (e) {
    console.error('Migration error:', e);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
