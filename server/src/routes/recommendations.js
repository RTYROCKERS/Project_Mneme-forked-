const express = require('express');
const pool = require('../config/db');
const auth = require('../middleware/auth');
const { rankConcepts } = require('../engines/recommendationEngine');

const router = express.Router();

// GET /api/recommendations/:user_id?topic_id= (optional filter)
router.get('/:user_id', auth, async (req, res, next) => {
  try {
    if (req.params.user_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const { topic_id } = req.query;

    // Get all concepts for user's topics (optionally filtered)
    let conceptQuery = `
      SELECT c.*, t.name AS topic_name
      FROM concepts c
      JOIN topics t ON t.id = c.topic_id
      WHERE t.user_id = $1
    `;
    const params = [req.user.id];

    if (topic_id) {
      conceptQuery += ' AND c.topic_id = $2';
      params.push(topic_id);
    }

    const conceptsResult = await pool.query(conceptQuery, params);
    const concepts = conceptsResult.rows;

    if (concepts.length === 0) return res.json([]);

    // Get mastery records for all these concepts
    const conceptIds = concepts.map((c) => c.id);
    const masteryResult = await pool.query(
      `SELECT * FROM mastery_records WHERE user_id = $1 AND concept_id = ANY($2)`,
      [req.user.id, conceptIds]
    );

    const masteryMap = new Map(masteryResult.rows.map((m) => [m.concept_id, m]));

    // Rank and get top 5
    const recommendations = rankConcepts(concepts, masteryMap, 5);

    // Persist recommendation log
    for (const rec of recommendations) {
      await pool.query(
        `INSERT INTO recommendation_log (user_id, concept_id, priority_score, reason_text)
         VALUES ($1, $2, $3, $4)`,
        [req.user.id, rec.concept_id, rec.priority_score, rec.reason]
      ).catch(() => {}); // non-critical
    }

    res.json(recommendations);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
