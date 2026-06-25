/**
 * Retrievability Engine  (FSRS-lite)
 *
 * This is Mneme's owned forgetting model — the part a chatbot doesn't have.
 * Unlike the older decayEngine (Ebbinghaus mastery erosion), this models the
 * probability that the user can recall a specific memory *right now*, and
 * updates a personalized `stability` from every recall signal — including the
 * implicit no-quiz signals.
 *
 *   retrievability  R(t) = 2 ^ ( -Δt_days / stability )
 *   stability grows on success, shrinks on lapse.
 *
 * stability is in "days": it's roughly the half-life of the memory. R = 0.5
 * exactly when Δt == stability. The bigger the stability, the slower you forget.
 */

const MS_PER_DAY = 1000 * 60 * 60 * 24;

// How each outcome moves stability. Multipliers > 1 strengthen, < 1 weaken.
// Explicit (quiz/confidence) and implicit (behaviour) signals are unified here.
const OUTCOME_EFFECT = {
  // explicit quiz
  correct:   { mult: 1.9, floor: 1.0, kind: 'up' },
  incorrect: { mult: 0.5, floor: 0.5, kind: 'down' },
  // confidence self-rating
  knew:      { mult: 1.7, floor: 1.0, kind: 'up' },
  kinda:     { mult: 1.15, floor: 0.8, kind: 'up' },
  forgot:    { mult: 0.55, floor: 0.5, kind: 'down' },
  // passive
  shown:     { mult: 1.05, floor: 0.6, kind: 'neutral' }, // soft forgot — barely moves
  // strong behavioural signals
  used:      { mult: 2.3, floor: 1.5, kind: 'up' },       // applied it in real work
  relookup:  { mult: 0.45, floor: 0.4, kind: 'down' },    // re-Googled it = forgot
};

const DIFFICULTY_GAIN = { easy: 1.15, intermediate: 1.0, hard: 0.85 };

/**
 * Current retrievability of a memory given its forgetting state.
 *
 * @param {{ stability: number, last_reviewed_at: string|Date }} memory
 * @param {Date|number} [now]
 * @returns {{ retrievability: number, daysSinceReview: number, stability: number }}
 */
function computeRetrievability(memory, now = Date.now()) {
  const stability = Math.max(memory.stability || 1, 0.1);
  const last = memory.last_reviewed_at ? new Date(memory.last_reviewed_at).getTime() : now;
  const daysSinceReview = Math.max((Number(now) - last) / MS_PER_DAY, 0);
  const retrievability = Math.pow(2, -daysSinceReview / stability);
  return {
    retrievability: round(retrievability),
    daysSinceReview: Math.round(daysSinceReview * 10) / 10,
    stability: round(stability),
  };
}

/**
 * Given a recall outcome, compute the new stability.
 * Successful recalls strengthen *more* when the memory was due (low R) — you
 * learn most by recalling something you almost forgot (desirable difficulty).
 *
 * @param {{ stability: number, last_reviewed_at: string|Date, difficulty?: string }} memory
 * @param {string} outcome - one of OUTCOME_EFFECT keys
 * @param {Date|number} [now]
 * @returns {{ stabilityBefore: number, stabilityAfter: number, retrievabilityBefore: number, isLapse: boolean }}
 */
function updateStability(memory, outcome, now = Date.now()) {
  const effect = OUTCOME_EFFECT[outcome] || OUTCOME_EFFECT.shown;
  const { retrievability, stability } = computeRetrievability(memory, now);
  const diffGain = DIFFICULTY_GAIN[memory.difficulty] || 1.0;

  let next;
  if (effect.kind === 'down') {
    // Lapse: collapse stability toward a small floor.
    next = Math.max(stability * effect.mult, effect.floor);
  } else if (effect.kind === 'up') {
    // Desirable-difficulty bonus: bigger gain when it was closer to forgotten.
    const dueBonus = 1 + (1 - retrievability) * 0.6; // up to +60% when R≈0
    next = Math.max(stability * effect.mult * dueBonus * diffGain, effect.floor);
  } else {
    next = Math.max(stability * effect.mult, effect.floor);
  }

  return {
    stabilityBefore: round(stability),
    stabilityAfter: round(next),
    retrievabilityBefore: retrievability,
    isLapse: effect.kind === 'down',
  };
}

/**
 * Is a memory "due" — worth resurfacing — at a given moment?
 * @param {object} memory
 * @param {number} [threshold] surface when R below this (default 0.6)
 */
function isDue(memory, threshold = 0.6, now = Date.now()) {
  return computeRetrievability(memory, now).retrievability < threshold;
}

/**
 * A friendly urgency label for the UI / "why am I seeing this" line.
 * @param {number} retrievability
 */
function strengthLabel(retrievability) {
  if (retrievability >= 0.85) return 'solid';
  if (retrievability >= 0.6) return 'fading';
  if (retrievability >= 0.35) return 'slipping';
  return 'almost gone';
}

function round(n) {
  return Math.round(n * 1000) / 1000;
}

module.exports = {
  computeRetrievability,
  updateStability,
  isDue,
  strengthLabel,
  OUTCOME_EFFECT,
};
