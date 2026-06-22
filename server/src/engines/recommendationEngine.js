/**
 * Recommendation Engine
 *
 * priority_score = (1 - effective_mastery) + decay_weight + difficulty_weight
 *
 * decay_weight:      rewards concepts that have decayed more
 * difficulty_weight: harder concepts get a small boost (interview-prep bias)
 *
 * Returns top 5 concepts with reason_text for explainability.
 */

const { computeEffectiveMastery } = require('./decayEngine');

const DIFFICULTY_WEIGHTS = { easy: 0.05, intermediate: 0.1, hard: 0.2 };

/**
 * Build human-readable reason string.
 */
function buildReasonText(effectiveMastery, decayFactor, difficulty, daysSince) {
  const reasons = [];

  if (effectiveMastery < 0.3) reasons.push('low mastery');
  else if (effectiveMastery < 0.6) reasons.push('moderate mastery');

  if (decayFactor > 0.2) reasons.push(`high decay (${daysSince}d since review)`);
  else if (decayFactor > 0.05) reasons.push(`some decay (${daysSince}d since review)`);

  if (difficulty === 'hard') reasons.push('high difficulty');

  if (reasons.length === 0) reasons.push('scheduled for reinforcement');

  return reasons.map((r) => r.charAt(0).toUpperCase() + r.slice(1)).join(' + ');
}

/**
 * Rank concepts and return top N recommendations.
 *
 * @param {Array} concepts    - list of concept rows
 * @param {Map}   masteryMap  - Map<concept_id, mastery_record>
 * @param {number} topN       - how many to return (default 5)
 */
function rankConcepts(concepts, masteryMap, topN = 5) {
  const scored = concepts.map((concept) => {
    const record = masteryMap.get(concept.id) || {
      mastery_score: 0,
      quiz_avg_score: 0,
      revision_count: 0,
      last_reviewed_at: null,
    };

    const { effectiveMastery, decayFactor, daysSinceReview } = computeEffectiveMastery(
      record,
      concept.difficulty_level
    );

    const diffWeight = DIFFICULTY_WEIGHTS[concept.difficulty_level] || 0.1;
    const priorityScore =
      (1 - effectiveMastery) * 0.6 + decayFactor * 0.3 + diffWeight * 0.1;

    const reasonText = buildReasonText(
      effectiveMastery,
      decayFactor,
      concept.difficulty_level,
      daysSinceReview
    );

    return {
      concept_id: concept.id,
      concept_name: concept.name,
      topic_id: concept.topic_id,
      priority_score: Math.round(priorityScore * 1000) / 1000,
      effective_mastery: effectiveMastery,
      decay_factor: decayFactor,
      reason: reasonText,
    };
  });

  return scored
    .sort((a, b) => b.priority_score - a.priority_score)
    .slice(0, topN);
}

module.exports = { rankConcepts };
