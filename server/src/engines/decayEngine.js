/**
 * Decay Engine
 *
 * Based on Ebbinghaus forgetting curve with multi-factor modulation.
 *
 * decay_factor = base_decay * difficulty_multiplier * (1 - frequency_resistance)
 *
 * base_decay   = 1 - e^(-k * days_since_review)
 *   k is derived from quiz_performance (better performers forget slower)
 *
 * difficulty_multiplier: hard concepts decay faster
 * frequency_resistance: frequent revisers retain more
 *
 * effective_mastery = mastery_score - decay_factor   (clamped to [0,1])
 */

const DIFFICULTY_DECAY_RATES = {
  easy: 0.05,
  intermediate: 0.1,
  hard: 0.18,
};

/**
 * Compute effective mastery after applying time-based decay.
 *
 * @param {object} record - mastery_records row
 * @param {string} difficulty - concept difficulty
 * @returns {{ decayFactor: number, effectiveMastery: number }}
 */
function computeEffectiveMastery(record, difficulty = 'intermediate') {
  const masteryScore = record.mastery_score || 0;
  const quizAvg = record.quiz_avg_score || 0;
  const revisionCount = record.revision_count || 0;
  const lastReviewed = record.last_reviewed_at ? new Date(record.last_reviewed_at) : new Date();

  const daysSinceReview = Math.max(
    (Date.now() - lastReviewed.getTime()) / (1000 * 60 * 60 * 24),
    0
  );

  // k: slower decay for high quiz performers
  const k = (DIFFICULTY_DECAY_RATES[difficulty] || 0.1) * (1 - quizAvg * 0.4);

  // Base forgetting curve
  const baseDecay = 1 - Math.exp(-k * daysSinceReview);

  // Frequent revisers resist decay (up to 40% reduction)
  const frequencyResistance = Math.min(revisionCount / 10, 1) * 0.4;

  const decayFactor = baseDecay * (1 - frequencyResistance);
  const effectiveMastery = Math.min(Math.max(masteryScore - decayFactor, 0), 1);

  return {
    decayFactor: Math.round(decayFactor * 1000) / 1000,
    effectiveMastery: Math.round(effectiveMastery * 1000) / 1000,
    daysSinceReview: Math.round(daysSinceReview * 10) / 10,
  };
}

module.exports = { computeEffectiveMastery };
