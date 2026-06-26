/**
 * Mneme API — /api/mneme
 *
 * Thin HTTP layer over mnemeService. All routes require auth; the user id comes
 * from the JWT (req.user.id). Surfaces (browser extension, terminal CLI, Control
 * Center) all speak to these endpoints.
 */

const express = require('express');
const multer = require('multer');
const officeparser = require('officeparser');
const auth = require('../middleware/auth');
const svc = require('../services/mnemeService');
const llm = require('../config/llm');

const router = express.Router();

// In-memory upload for the document surface (no files touch disk). 20 MB cap.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Formats we can read as-is without office parsing.
const PLAIN_TEXT_EXT = new Set(['txt', 'md', 'markdown', 'mdx', 'csv', 'tsv', 'json', 'log', 'text']);

// Flatten an officeparser result into plain text. Newer officeparser returns a
// structured { content:[{ text, children }] } object; older versions returned a
// plain string. Handle both, and avoid duplicating a node's text with its
// children's text by preferring a node's own `text` when present.
function flattenParsed(parsed) {
  if (typeof parsed === 'string') return parsed;
  if (!parsed || typeof parsed !== 'object') return '';
  const nodeText = (n) => {
    if (!n || typeof n !== 'object') return '';
    if (typeof n.text === 'string' && n.text.trim()) return n.text;
    if (Array.isArray(n.children)) return n.children.map(nodeText).filter(Boolean).join('\n');
    return '';
  };
  if (Array.isArray(parsed.content)) {
    return parsed.content.map(nodeText).filter(Boolean).join('\n\n');
  }
  if (typeof parsed.text === 'string') return parsed.text;
  return '';
}

// Pull readable text out of an uploaded document. officeparser covers
// PDF / Word / PowerPoint / Excel / OpenDocument; plain text we read directly.
async function extractDocText(buffer, filename = '') {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  if (PLAIN_TEXT_EXT.has(ext)) return buffer.toString('utf8');
  return flattenParsed(await officeparser.parseOffice(buffer));
}

// --- Status (no auth; for health checks + the demo "which brain?" badge) -----
// GET /api/mneme/status -> { ok, providers: { default, smart, embed, azureConfigured } }
router.get('/status', (req, res) => {
  res.json({ ok: true, providers: llm.activeProviders() });
});

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

// POST /api/mneme/onboarding  { expertise:[{domain,level}], profile:{role,education,focus,goal}, anchors:[string], markOnboarded? }
router.post('/onboarding', auth, async (req, res, next) => {
  try {
    const { expertise, profile, anchors, markOnboarded } = req.body || {};
    const result = await svc.saveOnboarding(req.user.id, {
      expertise: expertise || [],
      profile: profile || {},
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

// --- Page insight ("Learn this page") ----------------------------------------
// POST /api/mneme/page-insight  { text, url, title }
//   -> { page, known:[...worst-recall first], new:[...anchored], summary, counts }
// Read-only: analyses the page against the user's memory. Stores nothing.
router.post('/page-insight', auth, async (req, res, next) => {
  try {
    const { text, url, title } = req.body || {};
    if (!text || !String(text).trim()) {
      return res.status(400).json({ error: 'text is required' });
    }
    res.json(await svc.getPageInsight(req.user.id, { text, url, title }));
  } catch (err) {
    next(err);
  }
});

// POST /api/mneme/doc-insight
//   multipart: file=<PDF|Word|PowerPoint|Excel|text>   OR   json: { text, title }
//   -> same shape as /page-insight { page, overview, keyPoints, prereqs, summary, counts }
// The universal "get me ready to read this" surface for ANY occupation — a
// lawyer's contract, a student's textbook, a doctor's paper, an analyst's
// report. Reuses the page-insight brain; only the doorway (text extraction) is
// new. Read-only: stores nothing until the user saves a study packet.
router.post('/doc-insight', auth, upload.single('file'), async (req, res, next) => {
  try {
    let text = '';
    let title = (req.body && req.body.title) || '';
    if (req.file) {
      title = title || req.file.originalname;
      try {
        text = await extractDocText(req.file.buffer, req.file.originalname);
      } catch (e) {
        return res.status(422).json({
          error: `Couldn\u2019t read "${req.file.originalname}". Supported: PDF, Word, PowerPoint, Excel, or plain text.`,
        });
      }
    } else if (req.body && req.body.text) {
      text = String(req.body.text);
      title = title || 'Pasted text';
    }
    if (!text || !text.trim()) {
      return res.status(400).json({ error: 'Upload a document or paste some text to analyse.' });
    }
    // Cap to keep the LLM input bounded (~15k tokens) for big books/decks.
    const insight = await svc.getPageInsight(req.user.id, {
      text: text.slice(0, 60000), title, url: null,
    });
    res.json(insight);
  } catch (err) {
    next(err);
  }
});


//   -> { file, language, overview, keyConcepts, prereqs, codeNotes, summary, counts }
// Read-only: analyses a source file against the user's memory. Stores nothing.
router.post('/code-insight', auth, async (req, res, next) => {
  try {
    const { code, file, language } = req.body || {};
    if (!code || !String(code).trim()) {
      return res.status(400).json({ error: 'code is required' });
    }
    res.json(await svc.getCodeInsight(req.user.id, { code, file, language }));
  } catch (err) {
    next(err);
  }
});

// POST /api/mneme/session-insight  { events, label, shell }
//   -> { label, shell, overview, keyConcepts, prereqs, sessionNotes, summary, counts }
// Read-only: analyses an agentic terminal session (commands/errors/files) against
// the user's memory. Stores nothing.
router.post('/session-insight', auth, async (req, res, next) => {
  try {
    const { events, label, shell } = req.body || {};
    if (!events || !String(events).trim()) {
      return res.status(400).json({ error: 'events is required' });
    }
    res.json(await svc.getSessionInsight(req.user.id, { events, label, shell }));
  } catch (err) {
    next(err);
  }
});

// POST /api/mneme/learn-now  { card, detail?, difficulty?, url?, title?, originKind? }
//   -> the stored memory (enters the decay loop immediately)
router.post('/learn-now', auth, async (req, res, next) => {
  try {
    const { card, detail, difficulty, url, title, originKind } = req.body || {};
    if (!card || !String(card).trim()) {
      return res.status(400).json({ error: 'card is required' });
    }
    res.json(await svc.learnConcept(req.user.id, { card, detail, difficulty, url, title, originKind }));
  } catch (err) {
    next(err);
  }
});

// POST /api/mneme/study-packet
//   { page:{title,url}, overview?, keyPoints?:[], prereqs?:[] }
//   Saves the whole "learn this page later" briefing as a Topic (page content +
//   faded refreshers + missing gaps) so it appears in Topics/Study/Quiz.
router.post('/study-packet', auth, async (req, res, next) => {
  try {
    const { page, overview, keyPoints, prereqs, extraConcepts } = req.body || {};
    const hasContent =
      (Array.isArray(keyPoints) && keyPoints.length) ||
      (Array.isArray(prereqs) && prereqs.length) ||
      (Array.isArray(extraConcepts) && extraConcepts.length);
    if (!hasContent) {
      return res.status(400).json({ error: 'nothing to save (no keyPoints or prereqs)' });
    }
    res.json(await svc.saveStudyPacket(req.user.id, { page, overview, keyPoints, prereqs, extraConcepts }));
  } catch (err) {
    next(err);
  }
});

// --- Learning queue ("learn later" backlog) ----------------------------------
// GET  /api/mneme/learn-queue?status=pending -> { total, groups:[{source,url,items}] }
router.get('/learn-queue', auth, async (req, res, next) => {
  try {
    res.json(await svc.listLearningQueue(req.user.id, { status: req.query.status || 'pending' }));
  } catch (err) {
    next(err);
  }
});

// POST /api/mneme/learn-queue  { card, detail?, difficulty?, anchor?, url?, title?, originKind? }
router.post('/learn-queue', auth, async (req, res, next) => {
  try {
    const { card, detail, difficulty, anchor, url, title, originKind } = req.body || {};
    if (!card || !String(card).trim()) {
      return res.status(400).json({ error: 'card is required' });
    }
    res.json(await svc.queueLearning(req.user.id, { card, detail, difficulty, anchor, url, title, originKind }));
  } catch (err) {
    next(err);
  }
});

// POST /api/mneme/learn-queue/:id/resolve  { action: 'learn' | 'dismiss' }
router.post('/learn-queue/:id/resolve', auth, async (req, res, next) => {
  try {
    const { action } = req.body || {};
    if (action === 'learn') {
      res.json(await svc.learnQueueItem(req.user.id, req.params.id));
    } else if (action === 'dismiss') {
      res.json(await svc.dismissQueueItem(req.user.id, req.params.id));
    } else {
      res.status(400).json({ error: "action must be 'learn' or 'dismiss'" });
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
