const express = require('express');
const pool = require('../config/db');
const auth = require('../middleware/auth');

const router = express.Router();

// POST /api/topics
router.post('/', auth, async (req, res, next) => {
  try {
    const { name, description, learning_goal, depth_level } = req.body;
    if (!name) return res.status(400).json({ error: 'Topic name is required' });

    const result = await pool.query(
      `INSERT INTO topics (user_id, name, description, learning_goal, depth_level)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, name, description || null, learning_goal || 'general', depth_level || 'intermediate']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/topics  — list user's topics
router.get('/', auth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT t.*, 
        COUNT(DISTINCT c.id) AS concept_count,
        COUNT(DISTINCT r.id) AS resource_count
       FROM topics t
       LEFT JOIN concepts c ON c.topic_id = t.id
       LEFT JOIN resources r ON r.topic_id = t.id
       WHERE t.user_id = $1
       GROUP BY t.id
       ORDER BY t.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/topics/:id
router.get('/:id', auth, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM topics WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Topic not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/topics/:id
router.patch('/:id', auth, async (req, res, next) => {
  try {
    const { name, description, learning_goal, depth_level } = req.body;
    const result = await pool.query(
      `UPDATE topics SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        learning_goal = COALESCE($3, learning_goal),
        depth_level = COALESCE($4, depth_level)
       WHERE id = $5 AND user_id = $6 RETURNING *`,
      [name, description, learning_goal, depth_level, req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Topic not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/topics/:id
router.delete('/:id', auth, async (req, res, next) => {
  try {
    const result = await pool.query(
      'DELETE FROM topics WHERE id = $1 AND user_id = $2 RETURNING id',
      [req.params.id, req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Topic not found' });
    res.json({ message: 'Topic deleted' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
