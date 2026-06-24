const express = require('express');
const pool = require('../config/db');
const auth = require('../middleware/auth');
const { generateConceptsForTopic } = require('../engines/knowledgeEngine');
const { formatUserProfile } = require('../utils/profile');

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

const VALID_DIFFICULTY = ['easy', 'intermediate', 'hard'];

// POST /api/concepts  — manually add a single concept to a topic
router.post('/', auth, async (req, res, next) => {
  try {
    const { topic_id, name, description, difficulty_level } = req.body;
    if (!topic_id || !name) return res.status(400).json({ error: 'topic_id and name are required' });

    const topicCheck = await pool.query('SELECT id FROM topics WHERE id = $1 AND user_id = $2', [topic_id, req.user.id]);
    if (topicCheck.rows.length === 0) return res.status(404).json({ error: 'Topic not found' });

    const difficulty = VALID_DIFFICULTY.includes(difficulty_level) ? difficulty_level : 'intermediate';
    const result = await pool.query(
      `INSERT INTO concepts (topic_id, name, description, difficulty_level)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [topic_id, name.trim(), description || null, difficulty]
    );
    res.status(201).json({ ...result.rows[0], mastery_score: 0 });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/concepts/:id  — edit a concept's name/description/difficulty
router.patch('/:id', auth, async (req, res, next) => {
  try {
    const { name, description, difficulty_level } = req.body;

    // Ensure the concept belongs to the user
    const owns = await pool.query(
      `SELECT c.id FROM concepts c JOIN topics t ON t.id = c.topic_id WHERE c.id = $1 AND t.user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (owns.rows.length === 0) return res.status(404).json({ error: 'Concept not found' });

    const difficulty = difficulty_level && VALID_DIFFICULTY.includes(difficulty_level) ? difficulty_level : null;
    const result = await pool.query(
      `UPDATE concepts SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        difficulty_level = COALESCE($3, difficulty_level)
       WHERE id = $4 RETURNING *`,
      [name ?? null, description ?? null, difficulty, req.params.id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/concepts/:id
router.delete('/:id', auth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `DELETE FROM concepts c
       USING topics t
       WHERE c.topic_id = t.id AND c.id = $1 AND t.user_id = $2
       RETURNING c.id`,
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Concept not found' });
    res.json({ message: 'Concept deleted' });
  } catch (err) {
    next(err);
  }
});

// POST /api/concepts/generate  — generate concepts for a topic from its
// description + the learner profile. Pass { replace: true } to regenerate
// (clears existing concepts for the topic first).
router.post('/generate', auth, async (req, res, next) => {
  try {
    const { topic_id, replace } = req.body;
    if (!topic_id) return res.status(400).json({ error: 'topic_id is required' });

    const topicResult = await pool.query(
      'SELECT * FROM topics WHERE id = $1 AND user_id = $2',
      [topic_id, req.user.id]
    );
    if (topicResult.rows.length === 0) return res.status(404).json({ error: 'Topic not found' });
    const topic = topicResult.rows[0];

    const profileResult = await pool.query(
      'SELECT profile_description, profile FROM users WHERE id = $1',
      [req.user.id]
    );
    const userProfile = formatUserProfile(profileResult.rows[0]);

    const concepts = await generateConceptsForTopic(
      topic.name,
      topic.description,
      topic.depth_level,
      topic.learning_goal,
      userProfile
    );

    if (!concepts.length) return res.status(502).json({ error: 'No concepts could be generated' });

    if (replace) {
      await pool.query('DELETE FROM concepts WHERE topic_id = $1', [topic_id]);
    }

    const inserted = [];
    for (const c of concepts) {
      const row = await pool.query(
        `INSERT INTO concepts (topic_id, name, description, difficulty_level)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [topic_id, c.name, c.description, c.difficulty_level]
      );
      inserted.push({ ...row.rows[0], mastery_score: 0 });
    }

    res.status(201).json(inserted);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
