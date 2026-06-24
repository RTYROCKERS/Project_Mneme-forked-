const express = require('express');
const pool = require('../config/db');
const auth = require('../middleware/auth');
const { chatWithCoach, synthesizeProfile } = require('../engines/profileEngine');

const router = express.Router();

// GET /api/profile — current user's profile description + structured profile
router.get('/', auth, async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT profile_description, profile FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({
      profile_description: result.rows[0].profile_description || '',
      profile: result.rows[0].profile || {},
    });
  } catch (err) {
    next(err);
  }
});

// PUT /api/profile — update profile description and/or structured profile
router.put('/', auth, async (req, res, next) => {
  try {
    const { profile_description, profile } = req.body;

    if (profile_description === undefined && profile === undefined) {
      return res.status(400).json({ error: 'Nothing to update' });
    }
    if (profile_description !== undefined && typeof profile_description !== 'string') {
      return res.status(400).json({ error: 'profile_description must be a string' });
    }
    if (profile !== undefined && (typeof profile !== 'object' || profile === null || Array.isArray(profile))) {
      return res.status(400).json({ error: 'profile must be a JSON object' });
    }

    const result = await pool.query(
      `UPDATE users SET
        profile_description = COALESCE($1, profile_description),
        profile = COALESCE($2, profile)
       WHERE id = $3
       RETURNING profile_description, profile`,
      [
        profile_description ?? null,
        profile !== undefined ? JSON.stringify(profile) : null,
        req.user.id,
      ]
    );

    res.json({
      profile_description: result.rows[0].profile_description || '',
      profile: result.rows[0].profile || {},
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/profile/chat — talk with the coaching chatbot
// body: { messages: [{ role: 'user'|'assistant', content }] }
router.post('/chat', auth, async (req, res, next) => {
  try {
    const { messages } = req.body;
    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages must be an array' });
    }
    const reply = await chatWithCoach(messages);
    res.json({ reply });
  } catch (err) {
    next(err);
  }
});

// POST /api/profile/synthesize — turn a conversation into a profile.
// body: { messages: [...], save?: boolean }
router.post('/synthesize', auth, async (req, res, next) => {
  try {
    const { messages, save } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages must be a non-empty array' });
    }

    const synthesized = await synthesizeProfile(messages);
    const { profile_description, ...profile } = synthesized;

    if (save) {
      await pool.query(
        'UPDATE users SET profile_description = $1, profile = $2 WHERE id = $3',
        [profile_description || '', JSON.stringify(profile), req.user.id]
      );
    }

    res.json({ profile_description: profile_description || '', profile });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
