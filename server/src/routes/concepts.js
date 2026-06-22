const express = require('express');
const pool = require('../config/db');
const auth = require('../middleware/auth');

const router = express.Router();

// GET /api/concepts?topic_id=
router.get('/', auth, async (req, res, next) => {
  try {
    const { topic_id } = req.query;
    if (!topic_id) return res.status(400).json({ error: 'topic_id query param required' });

    // Verify topic belongs to user
    const topicCheck = await pool.query('SELECT id FROM topics WHERE id = $1 AND user_id = $2', [
      topic_id,
      req.user.id,
    ]);
    if (topicCheck.rows.length === 0) return res.status(404).json({ error: 'Topic not found' });

    const result = await pool.query(
      `SELECT c.*, 
        COALESCE(m.mastery_score, 0) AS mastery_score,
        m.last_reviewed_at,
        m.revision_count
       FROM concepts c
       LEFT JOIN mastery_records m ON m.concept_id = c.id AND m.user_id = $2
       WHERE c.topic_id = $1
       ORDER BY c.created_at ASC`,
      [topic_id, req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/concepts/:id
router.get('/:id', auth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT c.*, t.user_id,
        COALESCE(m.mastery_score, 0) AS mastery_score,
        m.last_reviewed_at, m.revision_count, m.quiz_avg_score, m.time_spent_seconds
       FROM concepts c
       JOIN topics t ON t.id = c.topic_id
       LEFT JOIN mastery_records m ON m.concept_id = c.id AND m.user_id = $2
       WHERE c.id = $1 AND t.user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Concept not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
