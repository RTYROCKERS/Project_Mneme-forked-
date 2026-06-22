const express = require('express');
const pool = require('../config/db');
const auth = require('../middleware/auth');
const { generateRevision, generateQuiz } = require('../engines/contentEngine');

const router = express.Router();

// POST /api/content/generate  — generate & cache content
router.post('/generate', auth, async (req, res, next) => {
  try {
    const { concept_id, type } = req.body;
    if (!concept_id || !type) return res.status(400).json({ error: 'concept_id and type are required' });
    if (!['revision', 'quiz'].includes(type)) return res.status(400).json({ error: 'type must be revision or quiz' });

    // Verify concept belongs to user
    const conceptResult = await pool.query(
      `SELECT c.*, t.user_id FROM concepts c JOIN topics t ON t.id = c.topic_id WHERE c.id = $1 AND t.user_id = $2`,
      [concept_id, req.user.id]
    );
    if (conceptResult.rows.length === 0) return res.status(404).json({ error: 'Concept not found' });

    const concept = conceptResult.rows[0];

    // Get mastery for adaptive difficulty
    const masteryResult = await pool.query(
      'SELECT mastery_score FROM mastery_records WHERE user_id = $1 AND concept_id = $2',
      [req.user.id, concept_id]
    );
    const masteryScore = masteryResult.rows[0]?.mastery_score || 0;

    // Generate content via AI
    let contentBlob;
    if (type === 'revision') {
      contentBlob = await generateRevision(concept.name, concept.description, masteryScore, concept.difficulty_level);
    } else {
      contentBlob = await generateQuiz(concept.name, concept.description, masteryScore, concept.difficulty_level);
    }

    // Cache in DB
    const result = await pool.query(
      `INSERT INTO generated_content (user_id, concept_id, type, difficulty_level, content_blob)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, concept_id, type, concept.difficulty_level, JSON.stringify(contentBlob)]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/content?concept_id=&type=  — retrieve cached content
router.get('/', auth, async (req, res, next) => {
  try {
    const { concept_id, type } = req.query;
    if (!concept_id) return res.status(400).json({ error: 'concept_id query param required' });

    let query = `SELECT gc.* FROM generated_content gc
      JOIN concepts c ON c.id = gc.concept_id
      JOIN topics t ON t.id = c.topic_id
      WHERE gc.concept_id = $1 AND gc.user_id = $2`;
    const params = [concept_id, req.user.id];

    if (type) {
      query += ' AND gc.type = $3';
      params.push(type);
    }

    query += ' ORDER BY gc.generated_at DESC LIMIT 10';

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
