/**
 * Resurface Engine
 *
 * The trigger loop. Given what the user is doing *right now* (a page they
 * opened, a command they ran, text on screen), decide whether one of their
 * own memories is both RELEVANT to this moment and FADING enough to be worth
 * jogging. This is what makes Mneme feel like it reads your mind: right idea,
 * right moment.
 *
 * Scoring blends two signals:
 *   relevance      — cosine similarity of context to the memory (is it on-topic?)
 *   forgetting need — 1 - retrievability (is it slipping away?)
 *
 *   priority = relevance * (0.4 + 0.6 * forgettingNeed)
 *
 * Relevance gates (off-topic memories never fire); forgetting need ranks among
 * the relevant ones so we nudge what's most at risk.
 */

const { rankBySimilarity } = require('./embeddingEngine');
const { computeRetrievability, strengthLabel } = require('./retrievabilityEngine');

/**
 * Pick the best memory to resurface for a given context vector.
 *
 * @param {number[]} contextVec - embedding of the current context
 * @param {Array<object>} memories - candidate memory rows (with embedding + forgetting state)
 * @param {{
 *   relevanceThreshold?: number,   // min cosine to be considered on-topic
 *   resurfaceThreshold?: number,   // surface only if R below this (fading)
 *   now?: number,
 *   limit?: number
 * }} [opts]
 * @returns {Array<{ memory: object, relevance: number, retrievability: number,
 *                   forgettingNeed: number, priority: number, label: string, reason: string }>}
 */
function findResurfaceCandidates(contextVec, memories, opts = {}) {
  const {
    // Tuned for the active embedding provider. Azure text-embedding-3-small:
    // unrelated <=0.25, on-topic context match 0.40-0.54 (Gemini was 0.78).
    relevanceThreshold = 0.40,
    resurfaceThreshold = 0.6,
    now = Date.now(),
    limit = 3,
  } = opts;

  const relevant = rankBySimilarity(contextVec, memories, {
    limit: memories.length,
    threshold: relevanceThreshold,
  });

  const scored = [];
  for (const { memory, similarity } of relevant) {
    const { retrievability } = computeRetrievability(memory, now);
    // Only resurface things that are actually fading.
    if (retrievability >= resurfaceThreshold) continue;

    const forgettingNeed = 1 - retrievability;
    const priority = similarity * (0.4 + 0.6 * forgettingNeed);

    scored.push({
      memory,
      relevance: round(similarity),
      retrievability,
      forgettingNeed: round(forgettingNeed),
      priority: round(priority),
      label: strengthLabel(retrievability),
      reason: buildReason(similarity, retrievability),
    });
  }

  scored.sort((a, b) => b.priority - a.priority);
  return scored.slice(0, limit);
}

/**
 * The single best candidate (or null). Convenience for the push/"ambient" mode.
 */
function pickOne(contextVec, memories, opts = {}) {
  const [top] = findResurfaceCandidates(contextVec, memories, { ...opts, limit: 1 });
  return top || null;
}

/**
 * Human-readable "why am I seeing this?" line shown on every resurfaced card.
 */
function buildReason(similarity, retrievability) {
  const rel = similarity >= 0.50 ? 'closely related to what you\u2019re doing'
    : 'related to what you\u2019re doing';
  const pct = Math.round(retrievability * 100);
  return `This is ${rel}, and you\u2019re at about ${pct}% recall \u2014 a good moment to refresh.`;
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

module.exports = { findResurfaceCandidates, pickOne, buildReason };
