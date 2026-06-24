const express = require('express');
const multer = require('multer');
const pool = require('../config/db');
const auth = require('../middleware/auth');
const cloudinary = require('../config/cloudinary');
const { extractConcepts } = require('../engines/knowledgeEngine');
const { formatUserProfile } = require('../utils/profile');

const router = express.Router();

// Use memory storage so we can stream to Cloudinary
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
});

// Helper: upload buffer to Cloudinary
function uploadToCloudinary(buffer, originalName) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: 'mneme_resources', resource_type: 'auto', public_id: `${Date.now()}_${originalName}` },
      (err, result) => (err ? reject(err) : resolve(result))
    );
    stream.end(buffer);
  });
}

// POST /api/resources  — add link, text, or file resource
router.post('/', auth, upload.single('file'), async (req, res, next) => {
  try {
    const { topic_id, type, title, url, content_text } = req.body;

    if (!topic_id || !type) return res.status(400).json({ error: 'topic_id and type are required' });

    // Verify topic belongs to user
    const topicCheck = await pool.query('SELECT id FROM topics WHERE id = $1 AND user_id = $2', [
      topic_id,
      req.user.id,
    ]);
    if (topicCheck.rows.length === 0) return res.status(404).json({ error: 'Topic not found' });

    let cloudinary_url = null;
    let cloudinary_public_id = null;
    let file_name = null;

    if (type === 'file') {
      if (!req.file) return res.status(400).json({ error: 'File is required for type=file' });
      const result = await uploadToCloudinary(req.file.buffer, req.file.originalname);
      cloudinary_url = result.secure_url;
      cloudinary_public_id = result.public_id;
      file_name = req.file.originalname;
    }

    if (type === 'link' && !url) return res.status(400).json({ error: 'URL is required for type=link' });
    if (type === 'text' && !content_text) return res.status(400).json({ error: 'content_text is required for type=text' });

    const result = await pool.query(
      `INSERT INTO resources (topic_id, user_id, type, title, url, content_text, cloudinary_url, cloudinary_public_id, file_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [topic_id, req.user.id, type, title || null, url || null, content_text || null, cloudinary_url, cloudinary_public_id, file_name]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/resources?topic_id=
router.get('/', auth, async (req, res, next) => {
  try {
    const { topic_id } = req.query;
    if (!topic_id) return res.status(400).json({ error: 'topic_id query param required' });

    const result = await pool.query(
      'SELECT * FROM resources WHERE topic_id = $1 AND user_id = $2 ORDER BY created_at DESC',
      [topic_id, req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/resources/:id
router.delete('/:id', auth, async (req, res, next) => {
  try {
    const resource = await pool.query(
      'SELECT * FROM resources WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.id]
    );
    if (resource.rows.length === 0) return res.status(404).json({ error: 'Resource not found' });

    const r = resource.rows[0];
    if (r.cloudinary_public_id) {
      await cloudinary.uploader.destroy(r.cloudinary_public_id, { resource_type: 'raw' });
    }

    await pool.query('DELETE FROM resources WHERE id = $1', [req.params.id]);
    res.json({ message: 'Resource deleted' });
  } catch (err) {
    next(err);
  }
});

// POST /api/resources/:id/process  — trigger concept extraction
router.post('/:id/process', auth, async (req, res, next) => {
  try {
    const resource = await pool.query(
      `SELECT r.*, t.name as topic_name, t.depth_level, t.learning_goal
       FROM resources r
       JOIN topics t ON t.id = r.topic_id
       WHERE r.id = $1 AND r.user_id = $2`,
      [req.params.id, req.user.id]
    );
    if (resource.rows.length === 0) return res.status(404).json({ error: 'Resource not found' });

    const r = resource.rows[0];
    const content = r.content_text || r.url || r.file_name || '';

    if (!content) return res.status(400).json({ error: 'No content to process' });

    // Load learner profile so extraction is personalized
    const profileResult = await pool.query(
      'SELECT profile_description, profile FROM users WHERE id = $1',
      [req.user.id]
    );
    const userProfile = formatUserProfile(profileResult.rows[0]);

    const concepts = await extractConcepts(content, r.topic_name, r.depth_level, r.learning_goal, userProfile);

    // Insert concepts (skip duplicates by name within same topic)
    const inserted = [];
    for (const c of concepts) {
      try {
        const row = await pool.query(
          `INSERT INTO concepts (topic_id, name, description, difficulty_level)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING RETURNING *`,
          [r.topic_id, c.name, c.description, c.difficulty_level]
        );
        if (row.rows.length > 0) inserted.push(row.rows[0]);
      } catch (_) {}
    }

    // Mark resource as processed
    await pool.query('UPDATE resources SET processed = TRUE WHERE id = $1', [r.id]);

    res.json({ concepts_extracted: inserted.length, concepts: inserted });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
