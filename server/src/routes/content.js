const express = require('express');
const pool = require('../config/db');
const auth = require('../middleware/auth');
const { generateRevision, generateQuiz, generateQuizQuestions } = require('../engines/contentEngine');
const { formatUserProfile } = require('../utils/profile');

const router = express.Router();

const WARMUP_COUNT = 4;     // interleaved questions shown before a revision
const BANK_SEED_COUNT = 4;  // new questions generated & stored per revision

// POST /api/content/generate  — generate & cache content
router.post('/generate', auth, async (req, res, next) => {
  try {
    const { concept_id, type } = req.body;
    if (!concept_id || !type) return res.status(400).json({ error: 'concept_id and type are required' });
    if (!['revision', 'quiz'].includes(type)) return res.status(400).json({ error: 'type must be revision or quiz' });

    // Verify concept belongs to user and pull its topic context
    const conceptResult = await pool.query(
      `SELECT c.*, t.user_id, t.id AS topic_id, t.description AS topic_description
       FROM concepts c JOIN topics t ON t.id = c.topic_id
       WHERE c.id = $1 AND t.user_id = $2`,
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

    // Load learner profile so generation is personalized
    const profileResult = await pool.query(
      'SELECT profile_description, profile FROM users WHERE id = $1',
      [req.user.id]
    );
    const userProfile = formatUserProfile(profileResult.rows[0]);

    // ── Standalone quiz mode (unchanged behaviour) ──────────────
    if (type === 'quiz') {
      const contentBlob = await generateQuiz(
        concept.name, concept.description, masteryScore, concept.difficulty_level, userProfile, concept.topic_description
      );
      const result = await pool.query(
        `INSERT INTO generated_content (user_id, concept_id, type, difficulty_level, content_blob)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [req.user.id, concept_id, type, concept.difficulty_level, JSON.stringify(contentBlob)]
      );
      return res.status(201).json(result.rows[0]);
    }

    // ── Revision mode ───────────────────────────────────────────
    const contentBlob = await generateRevision(
      concept.name, concept.description, masteryScore, concept.difficulty_level, userProfile, concept.topic_description
    );

    // Seed the question bank with fresh questions for THIS concept (best-effort)
    try {
      const newQuestions = await generateQuizQuestions(
        concept.name, concept.description, masteryScore, concept.difficulty_level,
        userProfile, concept.topic_description, BANK_SEED_COUNT
      );
      for (const q of newQuestions) {
        await pool.query(
          `INSERT INTO quiz_questions (user_id, concept_id, topic_id, question, options, correct_index, explanation, difficulty_level)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [req.user.id, concept_id, concept.topic_id, q.question, JSON.stringify(q.options), q.correct_index, q.explanation, concept.difficulty_level]
        );
      }
    } catch (seedErr) {
      // Non-fatal: revision still works without new bank questions
      // eslint-disable-next-line no-console
      console.error('Quiz bank seeding failed:', seedErr.message);
    }

    // Fetch interleaved warm-up questions from OTHER concepts (least-served first)
    const warmupResult = await pool.query(
      `SELECT q.id, q.concept_id, q.question, q.options, q.correct_index, q.explanation, c.name AS concept_name
       FROM quiz_questions q
       JOIN concepts c ON c.id = q.concept_id
       WHERE q.user_id = $1 AND q.concept_id <> $2
       ORDER BY q.times_served ASC, q.last_served_at ASC NULLS FIRST, RANDOM()
       LIMIT $3`,
      [req.user.id, concept_id, WARMUP_COUNT]
    );
    const warmupQuestions = warmupResult.rows;

    if (warmupQuestions.length > 0) {
      await pool.query(
        `UPDATE quiz_questions SET times_served = times_served + 1, last_served_at = NOW() WHERE id = ANY($1)`,
        [warmupQuestions.map((q) => q.id)]
      );
    }

    // Cache the revision content
    const result = await pool.query(
      `INSERT INTO generated_content (user_id, concept_id, type, difficulty_level, content_blob)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [req.user.id, concept_id, type, concept.difficulty_level, JSON.stringify(contentBlob)]
    );

    res.status(201).json({ ...result.rows[0], warmup_questions: warmupQuestions });
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
