/**
 * Embedding Engine
 *
 * Memories are compared by *meaning*, not keywords. Each memory carries an
 * embedding vector (from Gemini text-embedding-004). This engine does the
 * vector math: cosine similarity, nearest-neighbour search, and the
 * "is this basically the same thing I already know?" dedupe check.
 *
 * Vectors are stored as plain JSON float arrays (JSONB) — no pgvector needed.
 * At hackathon scale (hundreds–thousands of memories) an in-JS scan is fine.
 */

const { embedText } = require('../config/llm');

/**
 * Cosine similarity between two equal-length vectors. Range ~[-1, 1];
 * for embeddings it's effectively [0, 1]. Higher = more similar meaning.
 *
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number}
 */
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    return 0;
  }
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

/**
 * Rank a set of candidate memories against a query vector.
 *
 * @param {number[]} queryVec
 * @param {Array<{ id: string, embedding: number[]|string }>} candidates
 * @param {{ limit?: number, threshold?: number }} [opts]
 * @returns {Array<{ memory: object, similarity: number }>} sorted desc
 */
function rankBySimilarity(queryVec, candidates, { limit = 5, threshold = 0 } = {}) {
  const scored = [];
  for (const memory of candidates) {
    const vec = normalizeVector(memory.embedding);
    if (!vec) continue;
    const similarity = cosineSimilarity(queryVec, vec);
    if (similarity >= threshold) {
      scored.push({ memory, similarity });
    }
  }
  scored.sort((x, y) => y.similarity - x.similarity);
  return scored.slice(0, limit);
}

/**
 * The single best match (or null) above a similarity threshold.
 * Used both for resurfacing ("what does this context relate to?") and for
 * dedupe ("did I already capture this?").
 *
 * @param {number[]} queryVec
 * @param {Array} candidates
 * @param {number} [threshold]
 * @returns {{ memory: object, similarity: number } | null}
 */
function bestMatch(queryVec, candidates, threshold = 0.5) {
  const [top] = rankBySimilarity(queryVec, candidates, { limit: 1, threshold });
  return top || null;
}

/**
 * Embeddings may come back from Postgres JSONB as a string or array. Normalize
 * to a number[] or return null if unusable.
 * @param {number[]|string|null} raw
 * @returns {number[]|null}
 */
function normalizeVector(raw) {
  if (!raw) return null;
  let vec = raw;
  if (typeof raw === 'string') {
    try {
      vec = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(vec) || vec.length === 0) return null;
  return vec;
}

/**
 * Convenience: embed a string then find its best match in candidates.
 * @param {string} text
 * @param {Array} candidates
 * @param {object} [opts]
 */
async function embedAndMatch(text, candidates, { threshold = 0.5, taskType } = {}) {
  const queryVec = await embedText(text, taskType ? { taskType } : undefined);
  return { queryVec, match: bestMatch(queryVec, candidates, threshold) };
}

module.exports = {
  cosineSimilarity,
  rankBySimilarity,
  bestMatch,
  normalizeVector,
  embedAndMatch,
};
