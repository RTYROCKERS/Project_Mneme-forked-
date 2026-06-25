/**
 * Mneme API — /api/mneme
 *
 * Thin HTTP layer over mnemeService. All routes require auth; the user id comes
 * from the JWT (req.user.id). Surfaces (browser extension, terminal CLI, Control
 * Center) all speak to these endpoints.
 */

const express = require('express');
const auth = require('../middleware/auth');
const svc = require('../services/mnemeService');

const router = express.Router();

// --- Capture -----------------------------------------------------------------
// POST /api/mneme/capture  { text, source:{kind,identifier,label}, originRef }
router.post('/capture', auth, async (req, res, next) => {
  try {
    const { text, source, originRef } = req.body;
    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: 'text is required' });
    }
    const result = await svc.captureMemory(req.user.id, { text, source, originRef });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// --- Context (the trigger loop) ----------------------------------------------
// POST /api/mneme/context  { text, interaction?, force? }
router.post('/context', auth, async (req, res, next) => {
  try {
    const { text, interaction, force } = req.body;
    const candidate = await svc.getContextCandidate(req.user.id, { text, interaction, force });
    res.json({ candidate });
  } catch (err) {
    next(err);
  }
});

// --- Recall (update forgetting model) ----------------------------------------
// POST /api/mneme/recall  { memory_id, outcome, mode?, context_ref?,  // explicit
//                           question?, answer? }                       // quiz auto-grade
router.post('/recall', auth, async (req, res, next) => {
  try {
    const { memory_id, mode, context_ref, question, answer } = req.body;
    let { outcome } = req.body;
    if (!memory_id) return res.status(400).json({ error: 'memory_id is required' });

    let grading;
    // Quiz auto-grade: if an answer is supplied without an explicit outcome,
    // let the LLM decide correct/incorrect.
    if (!outcome && answer !== undefined) {
      const mem = (await svc.loadActiveMemories(req.user.id)).find((m) => m.id === memory_id);
      if (!mem) return res.status(404).json({ error: 'memory not found' });
      grading = await svc.gradeAnswer(mem, question, answer);
      outcome = grading.correct ? 'correct' : 'incorrect';
    }
    if (!outcome) return res.status(400).json({ error: 'outcome or answer is required' });

    const result = await svc.recordRecall(req.user.id, {
      memoryId: memory_id,
      outcome,
      mode: mode || (grading ? 'quiz' : 'show'),
      contextRef: context_ref,
    });
    if (grading) result.grading = grading;
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// --- Explain / refresh -------------------------------------------------------
// POST /api/mneme/explain  { memory_id }
router.post('/explain', auth, async (req, res, next) => {
  try {
    const { memory_id } = req.body;
    if (!memory_id) return res.status(400).json({ error: 'memory_id is required' });
    const mem = (await svc.loadActiveMemories(req.user.id)).find((m) => m.id === memory_id);
    if (!mem) return res.status(404).json({ error: 'memory not found' });
    const explanation = await svc.explainMemory(mem);
    res.json({ memory_id, explanation });
  } catch (err) {
    next(err);
  }
});

// --- Sources & permissions ---------------------------------------------------
router.get('/sources', auth, async (req, res, next) => {
  try {
    res.json(await svc.listSources(req.user.id));
  } catch (err) {
    next(err);
  }
});

// POST /api/mneme/sources  { kind, identifier, permission, label }
router.post('/sources', auth, async (req, res, next) => {
  try {
    const { kind, identifier, permission, label } = req.body;
    if (!identifier || !permission) {
      return res.status(400).json({ error: 'identifier and permission are required' });
    }
    const source = await svc.setSourcePermission(req.user.id, {
      kind: kind || 'browser',
      identifier,
      permission,
      label,
    });
    res.json(source);
  } catch (err) {
    next(err);
  }
});

// --- Memory feed -------------------------------------------------------------
router.get('/memories', auth, async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    res.json(await svc.listMemories(req.user.id, { limit }));
  } catch (err) {
    next(err);
  }
});

router.delete('/memories/:id', auth, async (req, res, next) => {
  try {
    res.json(await svc.deleteMemory(req.user.id, req.params.id));
  } catch (err) {
    next(err);
  }
});

// --- Strength stats ----------------------------------------------------------
router.get('/strength', auth, async (req, res, next) => {
  try {
    res.json(await svc.getStrengthStats(req.user.id));
  } catch (err) {
    next(err);
  }
});

// --- Settings ----------------------------------------------------------------
router.get('/settings', auth, async (req, res, next) => {
  try {
    res.json(await svc.getSettings(req.user.id));
  } catch (err) {
    next(err);
  }
});

router.put('/settings', auth, async (req, res, next) => {
  try {
    res.json(await svc.updateSettings(req.user.id, req.body || {}));
  } catch (err) {
    next(err);
  }
});

// --- Onboarding (first-run cold-start) ---------------------------------------
// GET  /api/mneme/onboarding  -> { onboarded, expertise, declaredCount }
router.get('/onboarding', auth, async (req, res, next) => {
  try {
    res.json(await svc.getOnboarding(req.user.id));
  } catch (err) {
    next(err);
  }
});

// POST /api/mneme/onboarding  { expertise:[{domain,level}], anchors:[string], markOnboarded? }
router.post('/onboarding', auth, async (req, res, next) => {
  try {
    const { expertise, anchors, markOnboarded } = req.body || {};
    const result = await svc.saveOnboarding(req.user.id, {
      expertise: expertise || [],
      anchors: anchors || [],
      markOnboarded: markOnboarded !== false,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// --- Demo seed ---------------------------------------------------------------
router.post('/seed-demo', auth, async (req, res, next) => {
  try {
    res.json(await svc.seedDemo(req.user.id, req.body || {}));
  } catch (err) {
    next(err);
  }
});

module.exports = router;
