/**
 * Mastery Engine
 * mastery_score = w1 * normalized_time + w2 * normalized_revision + w3 * quiz_avg_score
 *
 * Weights: time=0.2, revision=0.3, quiz=0.5
 * Time normalization: cap at 3600s (1 hour) = full time score
 * Revision normalization: cap at 10 revisions = full revision score
 */

const WEIGHTS = { time: 0.2, revision: 0.3, quiz: 0.5 };
const MAX_TIME_SECONDS = 3600;
const MAX_REVISIONS = 10;

/**
 * Compute mastery score from raw inputs.
 * All inputs come from the mastery_records row for a concept.
 */
function computeMasteryScore({ time_spent_seconds, revision_count, quiz_avg_score }) {
  const normalizedTime = Math.min(time_spent_seconds / MAX_TIME_SECONDS, 1);
  const normalizedRevision = Math.min(revision_count / MAX_REVISIONS, 1);
  const normalizedQuiz = Math.min(Math.max(quiz_avg_score, 0), 1);

  const score =
    WEIGHTS.time * normalizedTime +
    WEIGHTS.revision * normalizedRevision +
    WEIGHTS.quiz * normalizedQuiz;

  return Math.min(Math.max(score, 0), 1);
}

/**
 * Update mastery after a study session.
 * timeAdded: seconds spent in this session
 */
function updateMasteryInputs(record, { timeAdded = 0, quizScore = null } = {}) {
  const updated = {
    time_spent_seconds: (record.time_spent_seconds || 0) + timeAdded,
    revision_count: (record.revision_count || 0) + 1,
    quiz_avg_score: record.quiz_avg_score || 0,
  };

  if (quizScore !== null) {
    // Rolling average of quiz scores
    const prevCount = record.revision_count || 0;
    updated.quiz_avg_score =
      prevCount === 0
        ? quizScore
        : (record.quiz_avg_score * prevCount + quizScore) / (prevCount + 1);
  }

  updated.mastery_score = computeMasteryScore(updated);
  return updated;
}

module.exports = { computeMasteryScore, updateMasteryInputs };
