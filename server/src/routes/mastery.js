const express = require('express');
const pool = require('../config/db');
const auth = require('../middleware/auth');
const { computeMasteryScore, updateMasteryInputs } = require('../engines/masteryEngine');
const { computeEffectiveMastery } = require('../engines/decayEngine');

const router = express.Router();

// GET /api/mastery/:user_id  — full mastery overview for the logged-in user
router.get('/:user_id', auth, async (req, res, next) => {
  try {
    if (req.params.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const result = await pool.query(
      `SELECT m.*, c.name AS concept_name, c.difficulty_level, t.name AS topic_name
       FROM mastery_records m
       JOIN concepts c ON c.id = m.concept_id
       JOIN topics t ON t.id = c.topic_id
       WHERE m.user_id = $1
       ORDER BY m.updated_at DESC`,
      [req.user.id]
    );

    const records = result.rows.map((row) => {
      const { effectiveMastery, decayFactor, daysSinceReview } = computeEffectiveMastery(
        row,
        row.difficulty_level
      );
      return { ...row, effective_mastery: effectiveMastery, decay_factor: decayFactor, days_since_review: daysSinceReview };
    });

    res.json(records);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/mastery/update  — log a study session
router.patch('/update', auth, async (req, res, next) => {
  try {
    const { concept_id, time_spent_seconds, quiz_score } = req.body;
    if (!concept_id) return res.status(400).json({ error: 'concept_id is required' });

    // Ensure concept belongs to user's topic
    const conceptCheck = await pool.query(
      `SELECT c.id FROM concepts c JOIN topics t ON t.id = c.topic_id WHERE c.id = $1 AND t.user_id = $2`,
      [concept_id, req.user.id]
    );
    if (conceptCheck.rows.length === 0) return res.status(404).json({ error: 'Concept not found' });

    // Fetch existing mastery record or use defaults
    const existing = await pool.query(
      'SELECT * FROM mastery_records WHERE user_id = $1 AND concept_id = $2',
      [req.user.id, concept_id]
    );
    const current = existing.rows[0] || {
      mastery_score: 0, time_spent_seconds: 0, revision_count: 0, quiz_avg_score: 0,
    };

    const updated = updateMasteryInputs(current, {
      timeAdded: time_spent_seconds || 0,
      quizScore: quiz_score !== undefined ? Number(quiz_score) : null,
    });

    const result = await pool.query(
      `INSERT INTO mastery_records (user_id, concept_id, mastery_score, time_spent_seconds, revision_count, quiz_avg_score, last_reviewed_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       ON CONFLICT (user_id, concept_id) DO UPDATE SET
         mastery_score = $3,
         time_spent_seconds = $4,
         revision_count = $5,
         quiz_avg_score = $6,
         last_reviewed_at = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [req.user.id, concept_id, updated.mastery_score, updated.time_spent_seconds, updated.revision_count, updated.quiz_avg_score]
    );

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
