/**
 * Mneme Service — the core memory brain wired to Postgres + the LLM.
 *
 * This is where the engines (triage, embedding, retrievability, resurface) meet
 * persistence. Routes and the CLI both go through these functions, so the logic
 * lives in one place.
 *
 * Verbs:
 *   captureMemory      observe text -> triage -> embed -> dedupe -> store (+links)
 *   getContextCandidate  context text -> find the right fading memory to jog now
 *   recordRecall       apply a recall outcome -> update the forgetting model
 *
 * Plus helpers for sources/permissions, settings, the memory feed, strength
 * stats, quiz generation/grading, and the demo seed.
 */

const pool = require('../config/db');
const { embedText, generateJSON, generateText } = require('../config/llm');
const { triage, extractLessons, analyzePage, analyzeCode, analyzeSession } = require('../engines/triageEngine');
const { bestMatch, rankBySimilarity } = require('../engines/embeddingEngine');
const {
  computeRetrievability,
  updateStability,
  strengthLabel,
} = require('../engines/retrievabilityEngine');
const { findResurfaceCandidates } = require('../engines/resurfaceEngine');

// Similarity thresholds (cosine). Calibrated to the ACTIVE embedding provider's
// distribution. Azure text-embedding-3-small spreads much lower than Gemini
// gemini-embedding-001, so these are tuned for Azure (empirical bands:
// unrelated <=0.25, related 0.40-0.54, near-duplicate 0.74-0.88).
// Previous Gemini calibration: DEDUPE_AT 0.93, LINK_AT 0.82.
const DEDUPE_AT = 0.78; // near-identical paraphrase -> treat as the same memory
const LINK_AT = 0.45;   // related -> create a knowledge-graph edge (high precision)

// ---------------------------------------------------------------------------
// Sources & permissions
// ---------------------------------------------------------------------------

/** Find or create a source row; returns the row. New sources start 'pending'. */
async function getOrCreateSource(userId, { kind = 'browser', identifier, label } = {}) {
  if (!identifier) return null;
  const existing = await pool.query(
    'SELECT * FROM mneme_sources WHERE user_id = $1 AND kind = $2 AND identifier = $3',
    [userId, kind, identifier]
  );
  if (existing.rows[0]) {
    await pool.query('UPDATE mneme_sources SET last_seen_at = NOW() WHERE id = $1', [
      existing.rows[0].id,
    ]);
    return existing.rows[0];
  }
  const inserted = await pool.query(
    `INSERT INTO mneme_sources (user_id, kind, identifier, label, permission)
     VALUES ($1, $2, $3, $4, 'pending') RETURNING *`,
    [userId, kind, identifier, label || identifier]
  );
  return inserted.rows[0];
}

async function listSources(userId) {
  const { rows } = await pool.query(
    'SELECT * FROM mneme_sources WHERE user_id = $1 ORDER BY last_seen_at DESC',
    [userId]
  );
  return rows;
}

async function setSourcePermission(userId, { kind, identifier, permission, label }) {
  const valid = ['always', 'once', 'never', 'pending'];
  if (!valid.includes(permission)) {
    const err = new Error(`permission must be one of ${valid.join(', ')}`);
    err.status = 400;
    throw err;
  }
  const { rows } = await pool.query(
    `INSERT INTO mneme_sources (user_id, kind, identifier, label, permission)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, kind, identifier)
     DO UPDATE SET permission = $5, label = COALESCE($4, mneme_sources.label)
     RETURNING *`,
    [userId, kind, identifier, label || identifier, permission]
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

async function getSettings(userId) {
  const { rows } = await pool.query('SELECT * FROM mneme_settings WHERE user_id = $1', [userId]);
  if (rows[0]) return rows[0];
  const created = await pool.query(
    'INSERT INTO mneme_settings (user_id) VALUES ($1) RETURNING *',
    [userId]
  );
  return created.rows[0];
}

async function updateSettings(userId, patch = {}) {
  const current = await getSettings(userId);
  const next = {
    delivery_mode: patch.delivery_mode ?? current.delivery_mode,
    interaction: patch.interaction ?? current.interaction,
    paused: patch.paused ?? current.paused,
    resurface_threshold: patch.resurface_threshold ?? current.resurface_threshold,
  };
  const { rows } = await pool.query(
    `UPDATE mneme_settings
       SET delivery_mode = $2, interaction = $3, paused = $4,
           resurface_threshold = $5, updated_at = NOW()
     WHERE user_id = $1 RETURNING *`,
    [userId, next.delivery_mode, next.interaction, next.paused, next.resurface_threshold]
  );
  return rows[0];
}

// ---------------------------------------------------------------------------
// Memory loading
// ---------------------------------------------------------------------------

/** Load active memories with the fields needed for similarity + forgetting math. */
async function loadActiveMemories(userId) {
  const { rows } = await pool.query(
    `SELECT id, card, detail, difficulty, embedding, stability,
            last_reviewed_at, recall_count, lapse_count, lookup_count, source_id, created_at,
            is_declared
     FROM memories
     WHERE user_id = $1 AND status = 'active'`,
    [userId]
  );
  return rows;
}

// ---------------------------------------------------------------------------
// CAPTURE
// ---------------------------------------------------------------------------

/**
 * Observe a chunk of text and remember what's worth keeping.
 * @returns {{ kept: boolean, reason: string, memories: Array, needsPermission: boolean }}
 */
async function captureMemory(userId, { text, source = {}, originRef } = {}) {
  const src = await getOrCreateSource(userId, source);

  // Hard block: explicitly denied or flagged sensitive.
  if (src && (src.permission === 'never' || src.is_sensitive)) {
    await logObservation(userId, src?.id, text, false, null, 'source blocked');
    return { kept: false, reason: 'source is blocked', memories: [], needsPermission: false };
  }

  const profile = await getUserProfile(userId);
  const result = await triage(text, {
    sourceLabel: src?.label || source.identifier,
    originKind: source.kind || 'browser',
    userProfile: profile,
  });

  if (!result.kept) {
    await logObservation(userId, src?.id, text, false, null, result.reason);
    return {
      kept: false,
      reason: result.reason,
      memories: [],
      needsPermission: src ? src.permission === 'pending' : false,
    };
  }

  const existing = await loadActiveMemories(userId);
  const stored = [];

  for (const card of result.cards) {
    let vector;
    try {
      vector = await embedText(card.card);
    } catch (err) {
      // If embedding fails, store the card without a vector rather than lose it.
      vector = null;
    }

    // Dedupe: if we already know essentially this, bump it instead of duplicating.
    if (vector) {
      const dup = bestMatch(vector, existing, DEDUPE_AT);
      if (dup) {
        await pool.query(
          'UPDATE memories SET lookup_count = lookup_count + 1 WHERE id = $1',
          [dup.memory.id]
        );
        stored.push({ ...dup.memory, deduped: true });
        continue;
      }
    }

    const ins = await pool.query(
      `INSERT INTO memories
         (user_id, source_id, card, detail, embedding, difficulty, origin_kind, origin_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, card, detail, difficulty, stability, last_reviewed_at, recall_count, lapse_count`,
      [
        userId,
        src?.id || null,
        card.card,
        card.detail || null,
        vector ? JSON.stringify(vector) : null,
        card.difficulty,
        source.kind || 'browser',
        originRef || null,
      ]
    );
    const memory = ins.rows[0];

    // Knowledge-graph links to related existing memories.
    if (vector) {
      const related = rankBySimilarity(vector, existing, { limit: 5, threshold: LINK_AT });
      for (const r of related) {
        if (r.similarity >= DEDUPE_AT) continue;
        await linkMemories(userId, memory.id, r.memory.id, r.similarity);
      }
      // Make this memory visible to subsequent cards in the same batch.
      existing.push({ ...memory, embedding: vector });
    }

    await logObservation(userId, src?.id, text, true, memory.id, result.reason);
    stored.push(memory);
  }

  return {
    kept: stored.length > 0,
    reason: result.reason,
    memories: stored,
    needsPermission: src ? src.permission === 'pending' : false,
  };
}

async function linkMemories(userId, a, b, similarity) {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  await pool.query(
    `INSERT INTO memory_links (user_id, memory_a, memory_b, similarity)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (memory_a, memory_b) DO UPDATE SET similarity = $4`,
    [userId, lo, hi, similarity]
  );
}

async function logObservation(userId, sourceId, raw, kept, memoryId, reason) {
  await pool.query(
    `INSERT INTO observation_log (user_id, source_id, raw_text, kept, memory_id, reason)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, sourceId || null, (raw || '').slice(0, 4000), kept, memoryId || null, reason || null]
  );
}

// ---------------------------------------------------------------------------
// CONTEXT — the trigger loop
// ---------------------------------------------------------------------------

/**
 * Given what the user is doing now, return the single best memory to jog —
 * relevant AND fading — or null. Optionally attaches a quiz question.
 *
 * @param {string} userId
 * @param {{ text: string, interaction?: string, force?: boolean }} input
 * @returns {Promise<null | object>}
 */
async function getContextCandidate(userId, { text, interaction, force = false } = {}) {
  if (!text || !text.trim()) return null;

  const settings = await getSettings(userId);
  if (settings.paused && !force) return null;

  const memories = await loadActiveMemories(userId);
  if (memories.length === 0) return null;

  let contextVec;
  try {
    // Must use the SAME task type the memories were stored with (default
    // SEMANTIC_SIMILARITY). Mixing RETRIEVAL_QUERY here puts the context vector
    // in a different subspace and collapses all similarities -> nothing matches.
    contextVec = await embedText(text);
  } catch {
    return null;
  }

  const [top] = findResurfaceCandidates(contextVec, memories, {
    resurfaceThreshold: force ? 1.01 : settings.resurface_threshold,
    now: Date.now(),
    limit: 1,
  });
  if (!top) return null;

  const mode = interaction || settings.interaction; // 'quiz' | 'show' | 'auto'
  const response = {
    memory: {
      id: top.memory.id,
      card: top.memory.card,
      detail: top.memory.detail,
      difficulty: top.memory.difficulty,
    },
    relevance: top.relevance,
    retrievability: top.retrievability,
    strength: top.label,
    why: top.reason,
    interaction: resolveInteraction(mode, top.retrievability),
  };

  if (response.interaction === 'quiz') {
    try {
      response.quiz = await generateQuizQuestion(top.memory);
    } catch {
      response.interaction = 'show'; // fall back gracefully
    }
  }
  return response;
}

/**
 * 'auto' resolves to a concrete interaction: quiz the things you're forgetting,
 * just show the ones you mostly still have.
 */
function resolveInteraction(mode, retrievability) {
  if (mode === 'quiz') return 'quiz';
  if (mode === 'show') return 'show';
  // auto:
  return retrievability < 0.5 ? 'quiz' : 'show';
}

// ---------------------------------------------------------------------------
// RECALL — update the forgetting model
// ---------------------------------------------------------------------------

const VALID_OUTCOMES = ['correct', 'incorrect', 'knew', 'kinda', 'forgot', 'shown', 'used', 'relookup'];

/**
 * Apply a recall outcome to a memory: recompute stability, persist, log event.
 * @returns updated strength snapshot
 */
async function recordRecall(userId, { memoryId, outcome, mode = 'show', contextRef } = {}) {
  if (!VALID_OUTCOMES.includes(outcome)) {
    const err = new Error(`outcome must be one of ${VALID_OUTCOMES.join(', ')}`);
    err.status = 400;
    throw err;
  }
  const { rows } = await pool.query(
    'SELECT * FROM memories WHERE id = $1 AND user_id = $2 AND status = $3',
    [memoryId, userId, 'active']
  );
  const memory = rows[0];
  if (!memory) {
    const err = new Error('memory not found');
    err.status = 404;
    throw err;
  }

  const now = Date.now();
  const upd = updateStability(memory, outcome, now);
  const isLapse = upd.isLapse;

  const saved = await pool.query(
    `UPDATE memories
       SET stability = $2,
           last_reviewed_at = NOW(),
           recall_count = recall_count + $3,
           lapse_count = lapse_count + $4
     WHERE id = $1
     RETURNING stability, last_reviewed_at, recall_count, lapse_count`,
    [memoryId, upd.stabilityAfter, isLapse ? 0 : 1, isLapse ? 1 : 0]
  );

  await pool.query(
    `INSERT INTO recall_events
       (user_id, memory_id, mode, outcome, retrievability_before,
        stability_before, stability_after, context_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      userId, memoryId, mode, outcome,
      upd.retrievabilityBefore, upd.stabilityBefore, upd.stabilityAfter, contextRef || null,
    ]
  );

  const r = computeRetrievability(saved.rows[0], now);
  return {
    memory_id: memoryId,
    outcome,
    stability_before: upd.stabilityBefore,
    stability_after: upd.stabilityAfter,
    retrievability: r.retrievability,
    strength: strengthLabel(r.retrievability),
  };
}

// ---------------------------------------------------------------------------
// Memory feed + strength stats
// ---------------------------------------------------------------------------

async function listMemories(userId, { limit = 100 } = {}) {
  const memories = await loadActiveMemories(userId);
  const now = Date.now();
  return memories
    .map((m) => {
      const r = computeRetrievability(m, now);
      return {
        id: m.id,
        card: m.card,
        detail: m.detail,
        difficulty: m.difficulty,
        retrievability: r.retrievability,
        strength: strengthLabel(r.retrievability),
        stability_days: r.stability,
        days_since_review: r.daysSinceReview,
        recall_count: m.recall_count,
        lapse_count: m.lapse_count,
        created_at: m.created_at,
        is_declared: !!m.is_declared,
      };
    })
    .sort((a, b) => a.retrievability - b.retrievability)
    .slice(0, limit);
}

async function deleteMemory(userId, memoryId) {
  const { rowCount } = await pool.query(
    `UPDATE memories SET status = 'deleted' WHERE id = $1 AND user_id = $2 AND status = 'active'`,
    [memoryId, userId]
  );
  if (rowCount === 0) {
    const err = new Error('memory not found');
    err.status = 404;
    throw err;
  }
  return { deleted: memoryId };
}

/** Aggregate retention stats for the dashboard. */
async function getStrengthStats(userId) {
  const memories = await loadActiveMemories(userId);
  const now = Date.now();
  const buckets = { solid: 0, fading: 0, slipping: 0, 'almost gone': 0 };
  let sumR = 0;
  for (const m of memories) {
    const { retrievability } = computeRetrievability(m, now);
    sumR += retrievability;
    buckets[strengthLabel(retrievability)] += 1;
  }
  const recalls = await pool.query(
    `SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE outcome IN ('correct','knew','used','kinda'))::int AS strengthened,
        COUNT(*) FILTER (WHERE outcome IN ('incorrect','forgot','relookup'))::int AS lapsed
     FROM recall_events WHERE user_id = $1`,
    [userId]
  );
  const dueNow = memories.filter((m) => computeRetrievability(m, now).retrievability < 0.6).length;
  return {
    total_memories: memories.length,
    avg_retrievability: memories.length ? Math.round((sumR / memories.length) * 1000) / 1000 : 0,
    due_now: dueNow,
    strength_buckets: buckets,
    recalls: recalls.rows[0],
  };
}

// ---------------------------------------------------------------------------
// LLM helpers: quiz generation, grading, explain
// ---------------------------------------------------------------------------

async function generateQuizQuestion(memory) {
  const prompt = `
You are a tutor running an active-recall check. Given a fact the learner once saved,
write ONE short question that forces them to retrieve it from memory (not a yes/no).
Keep it answerable in a sentence.

Fact: "${memory.card}"
${memory.detail ? `Extra detail: "${memory.detail}"` : ''}

Return STRICT JSON: {"question": "<the question>"}
`.trim();
  const out = await generateJSON(prompt, { task: 'quiz', temperature: 0.4, maxOutputTokens: 120 });
  return { question: String(out.question || '').trim() };
}

/** Grade a free-text answer against the saved fact. Returns outcome + feedback. */
async function gradeAnswer(memory, question, answer) {
  const prompt = `
You are grading an active-recall answer. Decide if the learner's answer is essentially correct.

Fact they should know: "${memory.card}"
${memory.detail ? `Detail: "${memory.detail}"` : ''}
Question asked: "${question || ''}"
Their answer: "${answer || ''}"

Return STRICT JSON:
{"correct": true|false, "feedback": "<one encouraging sentence with the correct point>"}
`.trim();
  const out = await generateJSON(prompt, { task: 'quiz', temperature: 0.2, maxOutputTokens: 160 });
  return {
    correct: out.correct === true,
    feedback: String(out.feedback || '').trim(),
  };
}

async function explainMemory(memory) {
  const prompt = `Explain this idea to refresh someone who is forgetting it. 2-3 sentences, concrete, plain language.\n\nIdea: "${memory.card}"\n${memory.detail ? `Detail: "${memory.detail}"` : ''}`;
  return (await generateText(prompt, { task: 'explain', temperature: 0.4, maxOutputTokens: 200 })).trim();
}

// ---------------------------------------------------------------------------
// Demo seed
// ---------------------------------------------------------------------------

/**
 * Seed a memory pre-aged to ~40% recall so the resurface magic fires on cue
 * during a demo. Defaults to the compound-interest beat.
 */
async function seedDemo(userId, opts = {}) {
  const card = opts.card || 'Compound interest is interest earned on both your principal and the interest already accumulated.';
  const detail = opts.detail || 'Rule of 72: divide 72 by the annual rate to estimate the years for money to double.';
  const difficulty = opts.difficulty || 'easy';
  const stability = opts.stability || 3.0; // days
  const targetR = opts.retrievability || 0.4;
  // R = 2^(-Δt/stability)  =>  Δt = -stability * log2(R)
  const deltaDays = -stability * Math.log2(targetR);
  const reviewedAt = new Date(Date.now() - deltaDays * 24 * 3600 * 1000);

  let vector = null;
  try { vector = await embedText(card); } catch { /* keep null */ }

  const ins = await pool.query(
    `INSERT INTO memories
       (user_id, card, detail, embedding, difficulty, origin_kind, origin_ref,
        stability, last_reviewed_at)
     VALUES ($1, $2, $3, $4, $5, 'browser', 'demo-seed', $6, $7)
     RETURNING id, card, detail, difficulty, stability, last_reviewed_at`,
    [userId, card, detail, vector ? JSON.stringify(vector) : null, difficulty, stability, reviewedAt]
  );
  const memory = ins.rows[0];
  const r = computeRetrievability(memory, Date.now());
  return { memory, retrievability: r.retrievability, strength: strengthLabel(r.retrievability) };
}

// ---------------------------------------------------------------------------
// First-run onboarding (cold-start)
//
// Two honest pieces, neither of which fabricates "solid" knowledge:
//   1. The PRIOR — structured expertise that only tunes how chatty triage is
//      (kept in mneme_settings.expertise + mirrored into users.profile_description).
//   2. DECLARED ANCHORS — the optional brain dump, stored as weak, fast-fading
//      memories (is_declared) that must be confirmed by real life or they decay.
// ---------------------------------------------------------------------------

const EXPERTISE_LEVELS = ['new', 'learning', 'comfortable', 'expert'];

/** Clean, clamp and de-duplicate the expertise prior coming from the client. */
function normalizeExpertise(expertise) {
  if (!Array.isArray(expertise)) return [];
  const seen = new Set();
  const out = [];
  for (const raw of expertise) {
    const domain = String(raw?.domain || '').trim().slice(0, 60);
    if (!domain) continue;
    const key = domain.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const level = EXPERTISE_LEVELS.includes(raw?.level) ? raw.level : 'learning';
    out.push({ domain, level });
    if (out.length >= 12) break;
  }
  return out;
}

/**
 * Clean and clamp the structured onboarding profile (role / education / focus /
 * goal) coming from the client. Everything is best-effort free text — we just
 * trim and length-limit it. Returns a normalized object (fields may be empty).
 */
function normalizeProfile(profile) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const str = (v, max) => String(v ?? '').trim().slice(0, max);
  const edu = p.education && typeof p.education === 'object' ? p.education : {};
  return {
    role: str(p.role, 120),
    education: {
      current: str(edu.current, 160),
      past: str(edu.past, 160),
    },
    focus: str(p.focus, 400),
  };
}

/**
 * Turn the expertise prior + structured profile into the short narrative triage
 * already consumes (users.profile_description). This is the ONLY effect of the
 * onboarding prior: it tells Mneme who the user is (role, background, current
 * focus) and how chatty to be per domain — it stores no memories.
 */
function composeProfile(expertise, profile) {
  const p = normalizeProfile(profile);
  const parts = [];

  // Who they are — role + education frame everything triage judges.
  const idBits = [];
  if (p.role) idBits.push(`a ${p.role}`);
  if (p.education.current) idBits.push(`currently studying ${p.education.current}`);
  if (p.education.past) idBits.push(`with prior education in ${p.education.past}`);
  if (idBits.length) parts.push(`The user is ${idBits.join(', ')}.`);

  // What they mainly work on — a stable signal for what's worth keeping.
  if (p.focus) {
    parts.push(`They mainly work on ${p.focus} — keep useful facts, how-tos and gotchas relevant to this area.`);
  }

  // Domain calibration — quieter where expert, keener where new.
  if (expertise && expertise.length) {
    const by = (lvls) => expertise.filter((e) => lvls.includes(e.level)).map((e) => e.domain);
    const expert = by(['expert']);
    const comfy = by(['comfortable']);
    const learning = by(['new', 'learning']);
    if (expert.length) parts.push(`Already an expert in ${expert.join(', ')} — treat fundamentals here as common knowledge and only keep genuinely novel or advanced points.`);
    if (comfy.length) parts.push(`Comfortable with ${comfy.join(', ')} — keep non-obvious details, skip the basics.`);
    if (learning.length) parts.push(`Currently learning ${learning.join(', ')} — be generous about keeping useful facts and how-tos here.`);
  }

  return parts.join(' ');
}

/**
 * Expand short brain-dump phrases into clean one-sentence memory cards.
 * One batched LLM call; on any failure or count mismatch we fall back to using
 * the raw phrases verbatim so a declared anchor is never lost.
 */
async function expandAnchorPhrases(phrases) {
  if (!phrases.length) return [];
  const raw = phrases.map((p) => ({ card: p, detail: '', difficulty: 'intermediate' }));
  try {
    const prompt = `
The user listed things they say they already know. Turn EACH item, in the same
order, into one clean self-contained sentence stating the idea (as a memory the
agent could later jog). Keep the user's meaning; do not add new items.

Items:
${phrases.map((p, i) => `${i + 1}. ${p}`).join('\n')}

Return STRICT JSON (no markdown), exactly ${phrases.length} cards in order:
{ "cards": [ { "card": "<one sentence>", "detail": "", "difficulty": "easy|intermediate|hard" } ] }
`.trim();
    const res = await generateJSON(prompt, { task: 'triage', temperature: 0.2, maxOutputTokens: 800 });
    if (res && Array.isArray(res.cards) && res.cards.length === phrases.length) {
      return res.cards.map((c, i) => ({
        card: String(c?.card || phrases[i]).trim() || phrases[i],
        detail: String(c?.detail || '').trim(),
        difficulty: ['easy', 'intermediate', 'hard'].includes(c?.difficulty) ? c.difficulty : 'intermediate',
      }));
    }
  } catch {
    /* fall through to raw */
  }
  return raw;
}

/**
 * Seed declared anchors from the brain dump. Each is a WEAK, pre-aged memory:
 * stability ~1.5d and aged so retrievability starts ~0.5 ("fading"), never
 * "solid". If the user really knows it, real encounters/recalls strengthen it;
 * otherwise it decays away — the claim self-corrects toward the truth.
 */
async function seedDeclaredAnchors(userId, phrases = []) {
  const clean = (Array.isArray(phrases) ? phrases : [])
    .map((p) => String(p || '').trim())
    .filter((p) => p.length >= 2)
    .slice(0, 20);
  if (!clean.length) return [];

  const cards = await expandAnchorPhrases(clean);
  const existing = await loadActiveMemories(userId);

  const STABILITY = 1.5;        // days — fast-fading
  const TARGET_R = 0.5;         // start "fading", not "solid"
  const deltaDays = -STABILITY * Math.log2(TARGET_R);
  const reviewedAt = new Date(Date.now() - deltaDays * 24 * 3600 * 1000);

  const created = [];
  for (const card of cards) {
    let vector = null;
    try { vector = await embedText(card.card); } catch { /* keep null */ }

    // Don't duplicate something Mneme already holds.
    if (vector) {
      const dup = bestMatch(vector, existing, DEDUPE_AT);
      if (dup) continue;
    }

    const ins = await pool.query(
      `INSERT INTO memories
         (user_id, card, detail, embedding, difficulty, origin_kind, origin_ref,
          stability, last_reviewed_at, is_declared)
       VALUES ($1, $2, $3, $4, $5, 'declared', 'onboarding', $6, $7, TRUE)
       RETURNING id, card, detail, difficulty, stability, last_reviewed_at`,
      [userId, card.card, card.detail || null, vector ? JSON.stringify(vector) : null,
       card.difficulty, STABILITY, reviewedAt]
    );
    const memory = ins.rows[0];
    if (vector) existing.push({ ...memory, embedding: vector });
    await logObservation(userId, null, card.card, true, memory.id, 'declared anchor (onboarding)');
    created.push(memory);
  }
  return created;
}

/** Current onboarding state for the client (first-run gate + editable prior). */
async function getOnboarding(userId) {
  const settings = await getSettings(userId);
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM memories
     WHERE user_id = $1 AND is_declared = TRUE AND status = 'active'`,
    [userId]
  );
  return {
    onboarded: !!settings.onboarded,
    expertise: Array.isArray(settings.expertise) ? settings.expertise : [],
    profile: normalizeProfile(settings.profile),
    declaredCount: rows[0]?.n || 0,
  };
}

/**
 * Persist the onboarding result: the expertise prior + structured profile
 * (-> triage profile) and optional declared anchors. Reused for editing the
 * prior or adding anchors later (pass markOnboarded:false to avoid re-flipping
 * the first-run gate).
 */
async function saveOnboarding(userId, { expertise = [], profile = {}, anchors = [], markOnboarded = true } = {}) {
  await getSettings(userId); // ensure a settings row exists
  const clean = normalizeExpertise(expertise);
  const cleanProfile = normalizeProfile(profile);

  await pool.query(
    `UPDATE mneme_settings
       SET expertise = $2::jsonb,
           profile = $3::jsonb,
           onboarded = (onboarded OR $4),
           updated_at = NOW()
     WHERE user_id = $1`,
    [userId, JSON.stringify(clean), JSON.stringify(cleanProfile), !!markOnboarded]
  );

  // Mirror the prior into the narrative triage already reads.
  try {
    await pool.query('UPDATE users SET profile_description = $2 WHERE id = $1', [
      userId,
      composeProfile(clean, cleanProfile),
    ]);
  } catch {
    /* profile_description is best-effort personalization */
  }

  const createdAnchors = await seedDeclaredAnchors(userId, anchors);

  return {
    onboarded: true,
    expertise: clean,
    profile: cleanProfile,
    profileText: composeProfile(clean, cleanProfile),
    anchorsCreated: createdAnchors.length,
    anchors: createdAnchors,
  };
}

// ---------------------------------------------------------------------------
// PAGE INSIGHT — "Get me ready to read this page"
//
// The page is the destination. We infer the PREREQUISITES the page assumes,
// check each against the user's memory, and split them into:
//   solid    — you know it well; nothing to do (skipped from the action list)
//   faded    — you knew it but it's decaying; a detailed REFRESHER
//   missing  — you never learned it; a detailed TEACH, anchored to what you know
// We also distil what the page itself COVERS (overview + keyPoints) so the
// "Later" action can save the real content alongside the prerequisites.
// Read-only: stores nothing. The client chooses "Learn now" / "Save for later".
// ---------------------------------------------------------------------------

const KNOWN_RELEVANCE = 0.34; // a memory this close counts as "this prerequisite"
const ANCHOR_RELEVANCE = 0.30; // softer bar: nearest memory to anchor a new concept to
const SOLID_AT = 0.7;          // retrievability at/above this = solid (skip); below = faded

function round2(n) { return Math.round(n * 100) / 100; }

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

async function getPageInsight(userId, { text, url, title } = {}) {
  const pageText = `${title || ''}. ${text || ''}`.trim();
  if (pageText.length < 40) {
    return {
      page: { title: title || '', url: url || '' },
      overview: '', keyPoints: [], prereqs: [],
      summary: 'There isn\u2019t enough on this page to work with.',
      counts: { solid: 0, faded: 0, missing: 0 },
    };
  }

  const memories = await loadActiveMemories(userId);
  const now = Date.now();
  const profile = await getUserProfile(userId);

  // Understand the page (overview + what it covers + the prerequisites it
  // assumes). Independent of the embedding work, so kick them off together.
  const analysis = await analyzePage(pageText, {
    sourceLabel: title || url, originKind: 'browser', userProfile: profile,
  });

  const prereqDefs = analysis.prerequisites || [];
  // Embed every prerequisite in parallel — serial embedding was the slow path.
  const vecs = await Promise.all(prereqDefs.map((p) => embedText(p.concept).catch(() => null)));

  // Classify each prerequisite against memory: solid / faded / missing.
  const prereqs = prereqDefs.map((p, i) => {
    const vec = vecs[i];
    let match = null;
    if (vec) {
      const [near] = rankBySimilarity(vec, memories, { limit: 1, threshold: KNOWN_RELEVANCE });
      if (near) match = near;
    }
    if (match) {
      const ret = computeRetrievability(match.memory, now);
      const solid = ret.retrievability >= SOLID_AT;
      return {
        concept: p.concept,
        why: p.why,
        difficulty: p.difficulty,
        status: solid ? 'solid' : 'faded',
        memoryId: match.memory.id,
        knew: match.memory.card,
        relevance: round2(match.similarity),
        retrievability: ret.retrievability,
        strength: strengthLabel(ret.retrievability),
      };
    }
    // Missing — anchor it to the nearest thing they do know, if anything's close.
    let anchor = null;
    if (vec) {
      const [near] = rankBySimilarity(vec, memories, { limit: 1, threshold: ANCHOR_RELEVANCE });
      if (near) anchor = near.memory.card;
    }
    return {
      concept: p.concept, why: p.why, difficulty: p.difficulty,
      status: 'missing', anchor,
    };
  });

  // Detailed explanations for the prerequisites that need them (faded refreshers
  // + missing teaching) — one LLM call. Solid ones need no explanation.
  const toExplain = prereqs.filter((p) => p.status !== 'solid');
  if (toExplain.length) {
    try {
      const explanations = await explainPrereqs(toExplain, profile, analysis.overview);
      let j = 0;
      prereqs.forEach((p) => { if (p.status !== 'solid') p.explanation = explanations[j++] || ''; });
    } catch { /* explanations are best-effort */ }
  }

  const counts = {
    solid: prereqs.filter((p) => p.status === 'solid').length,
    faded: prereqs.filter((p) => p.status === 'faded').length,
    missing: prereqs.filter((p) => p.status === 'missing').length,
  };

  return {
    page: { title: title || '', url: url || '' },
    overview: analysis.overview,
    keyPoints: analysis.keyPoints,
    prereqs,
    summary: buildInsightSummary(counts, title),
    counts,
  };
}

/**
 * "Get me ready to read this code file" — the VS Code surface's brain.
 * Same prerequisite model as getPageInsight (solid / faded / missing against the
 * reader's own memory), but driven by analyzeCode and carrying codeNotes (plain
 * explanations of the notable lines in THIS file). Read-only: stores nothing.
 */
async function getCodeInsight(userId, { code, file, language } = {}) {
  const clean = (code || '').trim();
  if (clean.length < 30) {
    return {
      file: file || '', language: language || '',
      overview: '', keyConcepts: [], prereqs: [], codeNotes: [],
      summary: 'There isn\u2019t enough code in this file to work with.',
      counts: { solid: 0, faded: 0, missing: 0 },
    };
  }

  const memories = await loadActiveMemories(userId);
  const now = Date.now();
  const profile = await getUserProfile(userId);

  const analysis = await analyzeCode(clean, {
    file, language, userProfile: profile,
  });

  const prereqDefs = analysis.prerequisites || [];
  const vecs = await Promise.all(prereqDefs.map((p) => embedText(p.concept).catch(() => null)));

  const prereqs = prereqDefs.map((p, i) => {
    const vec = vecs[i];
    let match = null;
    if (vec) {
      const [near] = rankBySimilarity(vec, memories, { limit: 1, threshold: KNOWN_RELEVANCE });
      if (near) match = near;
    }
    if (match) {
      const ret = computeRetrievability(match.memory, now);
      const solid = ret.retrievability >= SOLID_AT;
      return {
        concept: p.concept,
        why: p.why,
        difficulty: p.difficulty,
        status: solid ? 'solid' : 'faded',
        memoryId: match.memory.id,
        knew: match.memory.card,
        relevance: round2(match.similarity),
        retrievability: ret.retrievability,
        strength: strengthLabel(ret.retrievability),
      };
    }
    let anchor = null;
    if (vec) {
      const [near] = rankBySimilarity(vec, memories, { limit: 1, threshold: ANCHOR_RELEVANCE });
      if (near) anchor = near.memory.card;
    }
    return { concept: p.concept, why: p.why, difficulty: p.difficulty, status: 'missing', anchor };
  });

  const toExplain = prereqs.filter((p) => p.status !== 'solid');
  if (toExplain.length) {
    try {
      const explanations = await explainPrereqs(toExplain, profile, analysis.overview);
      let j = 0;
      prereqs.forEach((p) => { if (p.status !== 'solid') p.explanation = explanations[j++] || ''; });
    } catch { /* explanations are best-effort */ }
  }

  const counts = {
    solid: prereqs.filter((p) => p.status === 'solid').length,
    faded: prereqs.filter((p) => p.status === 'faded').length,
    missing: prereqs.filter((p) => p.status === 'missing').length,
  };

  return {
    file: file || '',
    language: language || '',
    overview: analysis.overview,
    keyConcepts: analysis.keyConcepts,
    codeNotes: analysis.codeNotes,
    prereqs,
    summary: buildCodeSummary(counts, file),
    counts,
  };
}

function buildCodeSummary(counts, file) {
  const topic = file ? `\u201C${file}\u201D` : 'this file';
  const total = counts.faded + counts.missing;
  if (!total && !counts.solid) return `Couldn\u2019t work out what ${topic} needs \u2014 try another file.`;
  if (!total) return `You\u2019re already solid on everything ${topic} assumes \u2014 dive in.`;
  const bits = [];
  if (counts.faded) bits.push(`${counts.faded} thing${counts.faded === 1 ? '' : 's'} to refresh`);
  if (counts.missing) bits.push(`${counts.missing} new one${counts.missing === 1 ? '' : 's'} to learn`);
  const solidNote = counts.solid ? ` You\u2019ve already got ${counts.solid} of the basics.` : '';
  return `To read ${topic} comfortably: ${bits.join(' and ')}.${solidNote}`;
}

/**
 * "Make sense of what the agent just did" — the terminal/agent surface's brain.
 * Same prerequisite model as getCodeInsight (solid / faded / missing against the
 * reader's own memory), but driven by analyzeSession over a digest of the
 * session's events, and carrying sessionNotes (plain explanations of what
 * happened: files created, errors hit & resolved, commands run). Read-only.
 */
async function getSessionInsight(userId, { events, label, shell } = {}) {
  const digest = String(events || '').trim();
  if (digest.length < 20) {
    return {
      label: label || '', shell: shell || '',
      overview: '', keyConcepts: [], prereqs: [], sessionNotes: [],
      summary: 'There wasn\u2019t enough activity in this session to work with.',
      counts: { solid: 0, faded: 0, missing: 0 },
    };
  }

  const memories = await loadActiveMemories(userId);
  const now = Date.now();
  const profile = await getUserProfile(userId);

  const analysis = await analyzeSession(digest, { label, shell, userProfile: profile });

  const prereqDefs = analysis.prerequisites || [];
  const vecs = await Promise.all(prereqDefs.map((p) => embedText(p.concept).catch(() => null)));

  const prereqs = prereqDefs.map((p, i) => {
    const vec = vecs[i];
    let match = null;
    if (vec) {
      const [near] = rankBySimilarity(vec, memories, { limit: 1, threshold: KNOWN_RELEVANCE });
      if (near) match = near;
    }
    if (match) {
      const ret = computeRetrievability(match.memory, now);
      const solid = ret.retrievability >= SOLID_AT;
      return {
        concept: p.concept,
        why: p.why,
        difficulty: p.difficulty,
        status: solid ? 'solid' : 'faded',
        memoryId: match.memory.id,
        knew: match.memory.card,
        relevance: round2(match.similarity),
        retrievability: ret.retrievability,
        strength: strengthLabel(ret.retrievability),
      };
    }
    let anchor = null;
    if (vec) {
      const [near] = rankBySimilarity(vec, memories, { limit: 1, threshold: ANCHOR_RELEVANCE });
      if (near) anchor = near.memory.card;
    }
    return { concept: p.concept, why: p.why, difficulty: p.difficulty, status: 'missing', anchor };
  });

  const toExplain = prereqs.filter((p) => p.status !== 'solid');
  if (toExplain.length) {
    try {
      const explanations = await explainPrereqs(toExplain, profile, analysis.overview);
      let j = 0;
      prereqs.forEach((p) => { if (p.status !== 'solid') p.explanation = explanations[j++] || ''; });
    } catch { /* explanations are best-effort */ }
  }

  const counts = {
    solid: prereqs.filter((p) => p.status === 'solid').length,
    faded: prereqs.filter((p) => p.status === 'faded').length,
    missing: prereqs.filter((p) => p.status === 'missing').length,
  };

  return {
    label: label || '',
    shell: shell || '',
    overview: analysis.overview,
    keyConcepts: analysis.keyConcepts,
    sessionNotes: analysis.sessionNotes,
    prereqs,
    summary: buildSessionSummary(counts, analysis.overview),
    counts,
  };
}

function buildSessionSummary(counts, overview) {
  const total = counts.faded + counts.missing;
  const lead = overview ? 'From what the agent just did' : 'From this session';
  if (!total && !counts.solid) return 'Couldn\u2019t make much of this session \u2014 try after more activity.';
  if (!total) return `${lead}: you\u2019re already solid on everything it touched \u2014 nicely done.`;
  const bits = [];
  if (counts.faded) bits.push(`${counts.faded} thing${counts.faded === 1 ? '' : 's'} to refresh`);
  if (counts.missing) bits.push(`${counts.missing} new one${counts.missing === 1 ? '' : 's'} to learn`);
  const solidNote = counts.solid ? ` You already knew ${counts.solid} of them.` : '';
  return `${lead}: ${bits.join(' and ')}.${solidNote}`;
}

/**
 * One LLM call: write a DETAILED explanation for each prerequisite that needs it.
 * Faded -> a refresher of something they once knew. Missing -> teach it properly,
 * anchored to what they do know. These are paragraphs, not flashcards.
 */
async function explainPrereqs(items, profile, overview) {
  const list = items.map((p, i) => {
    const kind = p.status === 'faded'
      ? `REFRESH (they knew this once: "${p.knew}", now fading)`
      : `TEACH (new to them${p.anchor ? `; they do know: "${p.anchor}"` : ''})`;
    return `${i + 1}. [${kind}] ${p.concept}${p.why ? ` — needed because: ${p.why}` : ''}`;
  }).join('\n');

  const prompt = `
The reader wants to read a page about: ${overview || '(a technical page)'}
To follow it they first need to understand the prerequisites below.

Reader's background:
${profile || '(unknown)'}

For EACH item, write a clear, DETAILED explanation (3-5 sentences) that genuinely
makes them ready to read the page — not a one-line flashcard. For REFRESH items,
jog the memory and reinforce the key point. For TEACH items, explain it properly
from the ground up, and where an anchor is given, connect it to what they already
know ("Like X, but \u2026"). Be concrete; use a tiny example where it helps.

Items (keep this exact order, exactly ${items.length}):
${list}

Return STRICT JSON (no markdown):
{ "explanations": [ "<detailed explanation for item 1>", "..." ] }
`.trim();

  const res = await generateJSON(prompt, { task: 'explain', temperature: 0.35, maxOutputTokens: 1800 });
  const arr = Array.isArray(res?.explanations) ? res.explanations : [];
  return items.map((_, i) => String(arr[i] || '').trim());
}

function buildInsightSummary(counts, title) {
  const topic = title ? `\u201C${title}\u201D` : 'this page';
  const total = counts.faded + counts.missing;
  if (!total && !counts.solid) return `Couldn\u2019t work out what ${topic} needs \u2014 try another page.`;
  if (!total) return `You\u2019re already solid on everything ${topic} assumes \u2014 read on.`;
  const bits = [];
  if (counts.faded) bits.push(`${counts.faded} thing${counts.faded === 1 ? '' : 's'} to refresh`);
  if (counts.missing) bits.push(`${counts.missing} new one${counts.missing === 1 ? '' : 's'} to learn`);
  const solidNote = counts.solid ? ` You\u2019ve already got ${counts.solid} of the basics.` : '';
  return `To read ${topic} comfortably: ${bits.join(' and ')}.${solidNote}`;
}


// ---------------------------------------------------------------------------
// LEARNING QUEUE — "learn later" backlog + "learn now" promotion
// ---------------------------------------------------------------------------

/** Learn a concept NOW: store it as a memory immediately (enters the decay loop). */
async function learnConcept(userId, { card, detail, difficulty = 'intermediate', url, title, originKind = 'browser' } = {}) {
  if (!card || !String(card).trim()) { const e = new Error('card is required'); e.status = 400; throw e; }
  const cardText = String(card).trim();
  const diff = ['easy', 'intermediate', 'hard'].includes(difficulty) ? difficulty : 'intermediate';
  const kind = ['browser', 'terminal', 'desktop', 'other'].includes(originKind) ? originKind : 'browser';

  const src = (url || title)
    ? await getOrCreateSource(userId, { kind, identifier: hostOf(url) || title, label: title || hostOf(url) })
    : null;

  let vector = null;
  try { vector = await embedText(cardText); } catch { /* keep null */ }

  const existing = await loadActiveMemories(userId);
  if (vector) {
    const dup = bestMatch(vector, existing, DEDUPE_AT);
    if (dup) {
      await pool.query('UPDATE memories SET lookup_count = lookup_count + 1 WHERE id = $1', [dup.memory.id]);
      return { ...dup.memory, deduped: true };
    }
  }

  const ins = await pool.query(
    `INSERT INTO memories (user_id, source_id, card, detail, embedding, difficulty, origin_kind, origin_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, card, detail, difficulty, stability, last_reviewed_at`,
    [userId, src?.id || null, cardText, detail || null, vector ? JSON.stringify(vector) : null, diff, kind, url || null]
  );
  const memory = ins.rows[0];

  if (vector) {
    const related = rankBySimilarity(vector, existing, { limit: 5, threshold: LINK_AT });
    for (const r of related) {
      if (r.similarity < DEDUPE_AT) await linkMemories(userId, memory.id, r.memory.id, r.similarity);
    }
  }
  await logObservation(userId, src?.id || null, cardText, true, memory.id, 'learned (page-insight)');
  return memory;
}

/** Queue a concept to learn later (from page-insight "Later"). */
async function queueLearning(userId, { card, detail, difficulty, anchor, url, title, originKind = 'browser' } = {}) {
  if (!card || !String(card).trim()) { const e = new Error('card is required'); e.status = 400; throw e; }
  const cardText = String(card).trim();
  const diff = ['easy', 'intermediate', 'hard'].includes(difficulty) ? difficulty : 'intermediate';
  const kind = ['browser', 'terminal', 'desktop', 'other'].includes(originKind) ? originKind : 'browser';

  const dup = await pool.query(
    `SELECT id FROM learning_queue WHERE user_id = $1 AND status = 'pending' AND lower(card) = lower($2) LIMIT 1`,
    [userId, cardText]
  );
  if (dup.rows[0]) return { id: dup.rows[0].id, deduped: true };

  const { rows } = await pool.query(
    `INSERT INTO learning_queue (user_id, card, detail, difficulty, anchor, source_url, source_title, origin_kind)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id, card, detail, difficulty, anchor, source_title, source_url, status, created_at`,
    [userId, cardText, detail || null, diff, anchor || null, url || null, title || null, kind]
  );
  return rows[0];
}

/** List the learning backlog, grouped by source (the "whole topic" rollup). */
async function listLearningQueue(userId, { status = 'pending' } = {}) {
  const { rows } = await pool.query(
    `SELECT id, card, detail, difficulty, anchor, source_url, source_title, origin_kind, status, created_at
     FROM learning_queue WHERE user_id = $1 AND status = $2 ORDER BY created_at DESC`,
    [userId, status]
  );
  const groups = {};
  for (const r of rows) {
    const key = r.source_title || r.source_url || 'Other';
    if (!groups[key]) groups[key] = { source: key, url: r.source_url || null, items: [] };
    groups[key].items.push(r);
  }
  return { total: rows.length, groups: Object.values(groups) };
}

/** Promote a queued concept to a real memory ("learn now" from the queue). */
async function learnQueueItem(userId, itemId) {
  const { rows } = await pool.query('SELECT * FROM learning_queue WHERE id = $1 AND user_id = $2', [itemId, userId]);
  const item = rows[0];
  if (!item) { const e = new Error('queue item not found'); e.status = 404; throw e; }
  if (item.status !== 'pending') return { id: itemId, status: item.status };

  const memory = await learnConcept(userId, {
    card: item.card, detail: item.detail, difficulty: item.difficulty,
    url: item.source_url, title: item.source_title, originKind: item.origin_kind,
  });
  await pool.query(
    "UPDATE learning_queue SET status = 'learned', memory_id = $2, resolved_at = NOW() WHERE id = $1",
    [itemId, memory?.id || null]
  );
  return { id: itemId, status: 'learned', memory };
}

/** Drop a queued concept. */
async function dismissQueueItem(userId, itemId) {
  const { rowCount } = await pool.query(
    "UPDATE learning_queue SET status = 'dismissed', resolved_at = NOW() WHERE id = $1 AND user_id = $2 AND status = 'pending'",
    [itemId, userId]
  );
  return { id: itemId, dismissed: rowCount > 0 };
}

// ---------------------------------------------------------------------------
// STUDY PACKET — "Save this page to study later"
//
// Persists the whole readiness briefing as a Topic in the existing study app so
// it shows up in Topics / Study / Quiz. Stores three buckets as concepts:
//   1. the page's own key content (what the reader came for),
//   2. the faded prerequisites (to refresh),
//   3. the missing prerequisites (the gaps to learn — with their teaching).
// The normal study flow then schedules review and generates quizzes from these.
// ---------------------------------------------------------------------------

function trimName(s) {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  return t.length > 200 ? `${t.slice(0, 197)}\u2026` : t;
}

function pickDepth(prereqs = []) {
  if (prereqs.some((p) => p.difficulty === 'hard')) return 'advanced';
  if (prereqs.length && prereqs.every((p) => p.difficulty === 'easy')) return 'beginner';
  return 'intermediate';
}

async function saveStudyPacket(userId, { page = {}, overview, keyPoints = [], prereqs = [], extraConcepts = [] } = {}) {
  const title = trimName((page.title || '').trim() || (overview || '').slice(0, 80) || 'Saved page');
  const url = page.url || null;
  const description = (overview || '').trim() || `Saved from ${url || 'a web page'} to study later.`;

  // Dedupe: reuse an existing same-named topic so re-saving a page just tops it up.
  let topic;
  const existing = await pool.query(
    'SELECT * FROM topics WHERE user_id = $1 AND lower(name) = lower($2) ORDER BY created_at ASC LIMIT 1',
    [userId, title]
  );
  if (existing.rows[0]) {
    topic = existing.rows[0];
  } else {
    const ins = await pool.query(
      `INSERT INTO topics (user_id, name, description, learning_goal, depth_level)
       VALUES ($1,$2,$3,'general',$4) RETURNING *`,
      [userId, title, description, pickDepth(prereqs)]
    );
    topic = ins.rows[0];
  }

  // Provenance: a link resource pointing back at the page (best-effort).
  if (url) {
    try {
      const dupRes = await pool.query(
        'SELECT id FROM resources WHERE topic_id = $1 AND url = $2 LIMIT 1', [topic.id, url]
      );
      if (!dupRes.rows[0]) {
        await pool.query(
          `INSERT INTO resources (topic_id, user_id, type, title, url, processed)
           VALUES ($1,$2,'link',$3,$4,true)`,
          [topic.id, userId, title, url]
        );
      }
    } catch { /* non-fatal */ }
  }

  // Assemble concepts: page content + faded refreshers + missing teaching.
  const concepts = [];
  for (const kp of keyPoints) {
    const name = trimName(kp);
    if (name) concepts.push({ name, description: String(kp).trim(), difficulty: 'intermediate' });
  }
  for (const p of prereqs) {
    if (p.status === 'solid') continue; // already known cold — nothing to study
    concepts.push({
      name: trimName(p.concept),
      description: p.explanation || p.why || '',
      difficulty: p.difficulty || 'intermediate',
    });
  }
  // Extra concepts (e.g. code notes from a source file): {name, description, difficulty}
  for (const c of extraConcepts) {
    const name = trimName(c && c.name);
    if (name) {
      concepts.push({
        name,
        description: String((c && c.description) || '').trim(),
        difficulty: ['easy', 'intermediate', 'hard'].includes(c && c.difficulty) ? c.difficulty : 'intermediate',
      });
    }
  }

  // Insert, skipping concepts already present (idempotent re-saves).
  const have = await pool.query('SELECT lower(name) AS n FROM concepts WHERE topic_id = $1', [topic.id]);
  const seen = new Set(have.rows.map((r) => r.n));
  let added = 0;
  for (const c of concepts) {
    const key = c.name.toLowerCase();
    if (!c.name || seen.has(key)) continue;
    seen.add(key);
    await pool.query(
      'INSERT INTO concepts (topic_id, name, description, difficulty_level) VALUES ($1,$2,$3,$4)',
      [topic.id, c.name, c.description || null, c.difficulty]
    );
    added += 1;
  }

  return {
    topicId: topic.id,
    topicName: topic.name,
    conceptsAdded: added,
    totalConcepts: seen.size,
    reused: !!existing.rows[0],
  };
}

// ---------------------------------------------------------------------------
// misc
// ---------------------------------------------------------------------------

/** Best-effort fetch of the user's profile text for triage personalization. */
async function getUserProfile(userId) {
  try {
    const { rows } = await pool.query('SELECT profile_description FROM users WHERE id = $1', [userId]);
    return rows[0]?.profile_description || '';
  } catch {
    return '';
  }
}

module.exports = {
  getOrCreateSource,
  listSources,
  setSourcePermission,
  getSettings,
  updateSettings,
  captureMemory,
  getContextCandidate,
  recordRecall,
  listMemories,
  deleteMemory,
  getStrengthStats,
  generateQuizQuestion,
  gradeAnswer,
  explainMemory,
  seedDemo,
  loadActiveMemories,
  getOnboarding,
  saveOnboarding,
  getPageInsight,
  getCodeInsight,
  getSessionInsight,
  learnConcept,
  queueLearning,
  listLearningQueue,
  learnQueueItem,
  dismissQueueItem,
  saveStudyPacket,
};
