/**
 * Triage Engine
 *
 * The firehose problem: Mneme observes a lot (page text, commands, clipboard),
 * but almost none of it is worth remembering. Triage is the selective filter
 * that turns raw observed text into at most a few clean, durable "memory cards"
 * — or decides to keep nothing at all.
 *
 * This is the opposite of knowledgeEngine (which extracts *everything* for a
 * deliberate study topic). Triage is ruthless: it keeps only genuinely
 * reusable knowledge a person would benefit from recalling later.
 *
 * Cheap pre-filters run first (length, obvious junk, sensitive patterns) so we
 * don't spend an LLM call on noise.
 */

const { generateJSON } = require('../config/llm');

// Patterns that should never be captured, regardless of source permission.
const SENSITIVE_PATTERNS = [
  /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/,      // card numbers
  /password|passwd|secret|api[_-]?key|token|otp|cvv/i,
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b.*\b(password|login)\b/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

// High-confidence secret VALUES (as opposed to mere topic keywords like the
// word "secret"). Used by the explicit, user-initiated "Learn this page" path,
// where a public tutorial may legitimately *mention* secrets/API keys as a topic
// or show placeholder example values — that must not block learning the page.
const SECRET_VALUE_PATTERNS = [
  /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/,      // card numbers
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,           // private key blocks
  /\b(?:sk|pk|ghp|gho|xox[baprs])[-_][A-Za-z0-9]{16,}\b/, // common live token prefixes
  /\bAKIA[0-9A-Z]{16}\b/,                          // AWS access key id
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/, // JWT
];

function looksLikeSecretValue(text) {
  return SECRET_VALUE_PATTERNS.some((re) => re.test(text || ''));
}

/**
 * Fast, free reasons to discard before any LLM call.
 * @param {string} text
 * @returns {{ skip: boolean, reason?: string }}
 */
function preFilter(text) {
  const clean = (text || '').trim();
  if (clean.length < 25) return { skip: true, reason: 'too short to be meaningful' };
  if (clean.length > 8000) {
    // not a skip — just a guard; caller should pass already-chunked text
  }
  for (const re of SENSITIVE_PATTERNS) {
    if (re.test(clean)) return { skip: true, reason: 'looks sensitive — auto-blocked' };
  }
  return { skip: false };
}

/**
 * Decide what (if anything) to remember from a chunk of observed text.
 *
 * @param {string} text - observed content (page section, command output, note)
 * @param {{ sourceLabel?: string, originKind?: string, userProfile?: string }} [ctx]
 * @returns {Promise<{ kept: boolean, reason: string, cards: Array<{card,detail,difficulty}> }>}
 */
async function triage(text, ctx = {}) {
  const pre = preFilter(text);
  if (pre.skip) {
    return { kept: false, reason: pre.reason, cards: [] };
  }

  const profileLine = ctx.userProfile && ctx.userProfile.trim()
    ? `The user's background (use it to judge what is novel/worth keeping FOR THEM):\n${ctx.userProfile.trim()}\n`
    : '';

  const prompt = `
You are the memory triage filter for a personal memory agent. The agent observes
a lot of text from the user's day. Your job is to keep ONLY genuinely reusable
knowledge the user would benefit from recalling weeks later — facts, definitions,
how-tos, decisions, numbers, gotchas. Discard navigation, chit-chat, boilerplate,
transient status, and anything already common knowledge for this user.

Source: ${ctx.sourceLabel || 'unknown'} (${ctx.originKind || 'browser'})
${profileLine}
Observed text:
"""
${String(text).slice(0, 6000)}
"""

Return STRICT JSON (no markdown):
{
  "keep": true | false,
  "reason": "<one short sentence on why you kept or discarded>",
  "cards": [
    {
      "card": "<ONE clean, self-contained sentence stating the idea to remember>",
      "detail": "<optional 1-2 sentence elaboration, or empty string>",
      "difficulty": "easy" | "intermediate" | "hard"
    }
  ]
}

Rules:
- If nothing is worth keeping, return "keep": false and an empty "cards" array.
- Keep at most 3 cards. Prefer 0-1. Each card must stand alone without the source.
- Never include secrets, credentials, or personal/sensitive data in a card.
`.trim();

  let result;
  try {
    result = await generateJSON(prompt, { task: 'triage', temperature: 0.2, maxOutputTokens: 800 });
  } catch (err) {
    // Fail safe: on LLM/parse error, keep nothing rather than store junk.
    return { kept: false, reason: `triage unavailable: ${err.message}`, cards: [] };
  }

  const keep = result?.keep === true && Array.isArray(result.cards) && result.cards.length > 0;
  const cards = keep
    ? result.cards
        .filter((c) => c && c.card && String(c.card).trim().length > 0)
        .slice(0, 3)
        .map((c) => ({
          card: String(c.card).trim(),
          detail: String(c.detail || '').trim(),
          difficulty: ['easy', 'intermediate', 'hard'].includes(c.difficulty)
            ? c.difficulty
            : 'intermediate',
        }))
    : [];

  return {
    kept: cards.length > 0,
    reason: String(result?.reason || (cards.length ? 'kept' : 'nothing worth keeping')),
    cards,
  };
}

/**
 * Lesson extraction — the GENEROUS counterpart to triage, for when the user
 * EXPLICITLY asks to learn a page ("Learn this page"). Unlike triage (which is
 * ruthless about whether something is worth STORING), this always tries to pull
 * the page's key teachable concepts, regardless of how common they are. What the
 * user already knows is decided later by memory de-duplication, not here.
 *
 * @param {string} text
 * @param {{ sourceLabel?: string, originKind?: string, userProfile?: string }} [ctx]
 * @returns {Promise<{ cards: Array<{card,detail,difficulty}> }>}
 */
async function extractLessons(text, ctx = {}) {
  const clean = (text || '').trim();
  // Lighter guard than capture-triage: the user explicitly asked to learn this
  // PUBLIC page, so a mere mention of words like "secret"/"API key" must not
  // block it. Only bail on genuine secret VALUES (card numbers, private keys).
  if (clean.length < 25) return { cards: [] };
  if (looksLikeSecretValue(clean)) return { cards: [] };

  const profileLine = ctx.userProfile && ctx.userProfile.trim()
    ? `The learner's background (so you can pitch concepts at the right level):\n${ctx.userProfile.trim()}\n`
    : '';

  const prompt = `
You are a tutor. The learner is reading the page below and explicitly asked you
to help them learn it. Pull out the 3-6 most important, teachable CONCEPTS on the
page — the things someone should walk away understanding. Focus on real ideas,
definitions, mechanisms, gotchas, and how-tos. IGNORE navigation menus, breadcrumbs,
"direct link" anchors, banners, code fences, and boilerplate.

Source: ${ctx.sourceLabel || 'unknown'} (${ctx.originKind || 'browser'})
${profileLine}
Page text:
"""
${String(text).slice(0, 6000)}
"""

Return STRICT JSON (no markdown):
{
  "cards": [
    {
      "card": "<ONE clean, self-contained sentence stating the concept to learn>",
      "detail": "<optional 1-2 sentence elaboration, or empty string>",
      "difficulty": "easy" | "intermediate" | "hard"
    }
  ]
}

Rules:
- Return 3-6 cards when the page has real content; only return fewer (or none) if
  the page is genuinely empty of teachable ideas (e.g. pure navigation).
- Each card must stand alone without the source. No secrets or personal data.
`.trim();

  let result;
  try {
    result = await generateJSON(prompt, { task: 'triage', temperature: 0.3, maxOutputTokens: 900 });
  } catch (err) {
    return { cards: [] };
  }

  const cards = Array.isArray(result?.cards)
    ? result.cards
        .filter((c) => c && c.card && String(c.card).trim().length > 0)
        .filter((c) => !looksLikeSecretValue(`${c.card} ${c.detail || ''}`)) // never emit a real secret
        .slice(0, 6)
        .map((c) => ({
          card: String(c.card).trim(),
          detail: String(c.detail || '').trim(),
          difficulty: ['easy', 'intermediate', 'hard'].includes(c.difficulty) ? c.difficulty : 'intermediate',
        }))
    : [];

  return { cards };
}

/**
 * Page analysis for the "get me ready to read this page" flow.
 *
 * Unlike extractLessons (which pulls the page's own teachable bullet points),
 * this returns the BACKGROUND a reader must already understand to follow the
 * page — the prerequisites the page assumes, even when the page never states
 * them (a Helm page assumes Kubernetes/YAML but won't explain them). It also
 * returns what the page itself covers, so "Later" can save the real content.
 *
 * @param {string} text
 * @param {{ sourceLabel?: string, originKind?: string, userProfile?: string }} [ctx]
 * @returns {Promise<{ overview: string, keyPoints: string[],
 *   prerequisites: Array<{concept: string, why: string, difficulty: string}> }>}
 */
async function analyzePage(text, ctx = {}) {
  const empty = { overview: '', keyPoints: [], prerequisites: [] };
  const clean = (text || '').trim();
  if (clean.length < 25) return empty;
  if (looksLikeSecretValue(clean)) return empty; // genuine secret VALUES only

  const profileLine = ctx.userProfile && ctx.userProfile.trim()
    ? `The reader's background (pitch prerequisites at the right level — don't list things this person clearly already knows cold):\n${ctx.userProfile.trim()}\n`
    : '';

  const prompt = `
You are a tutor preparing a reader to UNDERSTAND the web page below. The page is
the goal; your job is to make sure they can read it fluently with no unfamiliar
concept getting in the way.

Do TWO things:

1. WHAT THE PAGE COVERS — a 1-2 sentence "overview" of what this page is about,
   plus 4-8 "keyPoints": the important things the page itself teaches (the actual
   material the reader came for). Concrete ideas, mechanisms, gotchas, how-tos.

2. PREREQUISITES — 4-9 background concepts the reader must ALREADY understand to
   follow this page. Infer the assumed background even if the page never states
   it. These are NOT the page's own bullet points — they are the foundation
   underneath them. For each give a short "concept" name and a one-line "why"
   (why it's needed to understand this page).

IGNORE navigation menus, breadcrumbs, banners, cookie notices, and boilerplate.

Source: ${ctx.sourceLabel || 'unknown'} (${ctx.originKind || 'browser'})
${profileLine}
Page text:
"""
${String(text).slice(0, 6000)}
"""

Return STRICT JSON (no markdown):
{
  "overview": "<1-2 sentences on what this page is about>",
  "keyPoints": ["<important thing the page teaches>", "..."],
  "prerequisites": [
    {
      "concept": "<short name of an assumed-known background concept>",
      "why": "<one line: why understanding this is needed to follow the page>",
      "difficulty": "easy" | "intermediate" | "hard"
    }
  ]
}

Rules:
- prerequisites are FOUNDATIONS the page builds on, not the page's own new content.
- Each concept name must stand alone (no "this", no page-specific references).
- No secrets or personal data.
`.trim();

  let result;
  try {
    result = await generateJSON(prompt, { task: 'triage', temperature: 0.3, maxOutputTokens: 1100 });
  } catch {
    return empty;
  }

  const overview = String(result?.overview || '').trim();
  const keyPoints = Array.isArray(result?.keyPoints)
    ? result.keyPoints
        .map((p) => String(p || '').trim())
        .filter((p) => p.length > 0 && !looksLikeSecretValue(p))
        .slice(0, 8)
    : [];
  const prerequisites = Array.isArray(result?.prerequisites)
    ? result.prerequisites
        .filter((p) => p && p.concept && String(p.concept).trim().length > 0)
        .filter((p) => !looksLikeSecretValue(`${p.concept} ${p.why || ''}`))
        .slice(0, 9)
        .map((p) => ({
          concept: String(p.concept).trim(),
          why: String(p.why || '').trim(),
          difficulty: ['easy', 'intermediate', 'hard'].includes(p.difficulty) ? p.difficulty : 'intermediate',
        }))
    : [];

  return { overview, keyPoints, prerequisites };
}

/**
 * Code analysis for the "get me ready to read this file" flow (the VS Code
 * surface). Same spirit as analyzePage, but for source code:
 *  - overview: what this file does
 *  - keyConcepts: the techniques/patterns this file uses (study-later material)
 *  - prerequisites: the background a reader must ALREADY know to follow the code
 *    (inferred even if the file never states it — a React file assumes JSX,
 *    hooks, closures). These get classified against the reader's memory.
 *  - codeNotes: plain-language explanations of the notable / non-obvious lines
 *    or constructs in THIS file (the "understand the new code" part).
 *
 * @param {string} code
 * @param {{ file?: string, language?: string, userProfile?: string }} [ctx]
 * @returns {Promise<{ overview: string, keyConcepts: string[],
 *   prerequisites: Array<{concept,why,difficulty}>,
 *   codeNotes: Array<{snippet, explanation}> }>}
 */
async function analyzeCode(code, ctx = {}) {
  const empty = { overview: '', keyConcepts: [], prerequisites: [], codeNotes: [] };
  const clean = (code || '').trim();
  if (clean.length < 25) return empty;

  const profileLine = ctx.userProfile && ctx.userProfile.trim()
    ? `The reader's background (pitch prerequisites at the right level — don't list things this person clearly already knows cold):\n${ctx.userProfile.trim()}\n`
    : '';

  const prompt = `
You are a senior engineer helping a teammate UNDERSTAND the source file below so
they can read and work with it fluently. The code is the goal; prepare them for it.

Do THREE things:

1. WHAT THIS FILE DOES — a 1-2 sentence "overview", plus 4-8 "keyConcepts": the
   important techniques, patterns, libraries or ideas this file actually uses
   (the material worth studying). Short concept names.

2. PREREQUISITES — 4-9 background concepts the reader must ALREADY understand to
   follow this code. Infer the assumed background even if the file never states
   it (e.g. a React component assumes JSX, hooks, closures; a SQL migration
   assumes relational schemas). These are the FOUNDATION underneath the code, not
   the file's own new logic. For each: a short "concept" name and a one-line "why".

3. CODE NOTES — 3-8 of the most notable / non-obvious lines or constructs in THIS
   file. For each give a short "snippet" (a few words or a line excerpt, <120
   chars) and a clear "explanation" of what it does and why, in plain language.

IGNORE imports boilerplate, license headers, and trivial getters.

File: ${ctx.file || 'untitled'} (${ctx.language || 'code'})
${profileLine}
Code:
"""
${String(code).slice(0, 7000)}
"""

Return STRICT JSON (no markdown):
{
  "overview": "<1-2 sentences on what this file does>",
  "keyConcepts": ["<technique/pattern this file uses>", "..."],
  "prerequisites": [
    {
      "concept": "<short name of an assumed-known background concept>",
      "why": "<one line: why understanding this is needed to follow the code>",
      "difficulty": "easy" | "intermediate" | "hard"
    }
  ],
  "codeNotes": [
    { "snippet": "<short code excerpt or construct>", "explanation": "<what it does and why>" }
  ]
}

Rules:
- prerequisites are FOUNDATIONS the code builds on, not the file's own new logic.
- Each concept name must stand alone (no "this", no file-specific references).
- No secrets, tokens, or personal data in any field.
`.trim();

  let result;
  try {
    result = await generateJSON(prompt, { task: 'triage', temperature: 0.3, maxOutputTokens: 1500 });
  } catch {
    return empty;
  }

  const overview = String(result?.overview || '').trim();
  const keyConcepts = Array.isArray(result?.keyConcepts)
    ? result.keyConcepts
        .map((p) => String(p || '').trim())
        .filter((p) => p.length > 0 && !looksLikeSecretValue(p))
        .slice(0, 8)
    : [];
  const prerequisites = Array.isArray(result?.prerequisites)
    ? result.prerequisites
        .filter((p) => p && p.concept && String(p.concept).trim().length > 0)
        .filter((p) => !looksLikeSecretValue(`${p.concept} ${p.why || ''}`))
        .slice(0, 9)
        .map((p) => ({
          concept: String(p.concept).trim(),
          why: String(p.why || '').trim(),
          difficulty: ['easy', 'intermediate', 'hard'].includes(p.difficulty) ? p.difficulty : 'intermediate',
        }))
    : [];
  const codeNotes = Array.isArray(result?.codeNotes)
    ? result.codeNotes
        .filter((n) => n && (n.snippet || n.explanation))
        .filter((n) => !looksLikeSecretValue(`${n.snippet || ''} ${n.explanation || ''}`))
        .slice(0, 8)
        .map((n) => ({
          snippet: String(n.snippet || '').trim().slice(0, 200),
          explanation: String(n.explanation || '').trim(),
        }))
        .filter((n) => n.explanation)
    : [];

  return { overview, keyConcepts, prerequisites, codeNotes };
}

/**
 * Session analysis for the terminal/agent surface. Unlike analyzeCode (which
 * reads a finished file), this reads the NARRATIVE of an agentic coding session
 * — the commands an AI agent ran, the errors it hit, and the files it
 * created/modified while working toward the user's goal. It does NOT need the
 * full file contents (the VS Code file briefing covers that); it reasons about
 * what HAPPENED.
 *
 * Returns:
 *  - overview: what this session accomplished / was trying to do
 *  - keyConcepts: the tools/techniques/ideas the work involved (study-later)
 *  - prerequisites: background a reader must already know to understand this
 *    work (classified against memory by the caller)
 *  - sessionNotes: plain-language "what happened" — a new file and why, an error
 *    hit and what it means / how it got resolved, a notable command and its
 *    purpose. THIS is the "explain the new" part for the session.
 *
 * @param {string} digest  a compact text log of the session's events
 * @param {{ label?: string, shell?: string, userProfile?: string }} [ctx]
 * @returns {Promise<{ overview, keyConcepts: string[],
 *   prerequisites: Array<{concept,why,difficulty}>,
 *   sessionNotes: Array<{event, explanation}> }>}
 */
async function analyzeSession(digest, ctx = {}) {
  const empty = { overview: '', keyConcepts: [], prerequisites: [], sessionNotes: [] };
  const clean = (digest || '').trim();
  if (clean.length < 25) return empty;

  const profileLine = ctx.userProfile && ctx.userProfile.trim()
    ? `The reader's background (pitch prerequisites at the right level — don't list things this person clearly already knows cold):\n${ctx.userProfile.trim()}\n`
    : '';

  const prompt = `
An AI coding agent worked in a developer's terminal toward a task. Below is a log
of WHAT HAPPENED: the commands it ran (with exit codes), errors it hit, and files
it created or modified. Your job is to help the developer UNDERSTAND this session
so they actually learn from what the agent did — not just accept it blindly.

Do THREE things, reasoning about the WORK ITSELF (not full file contents):

1. WHAT HAPPENED — a 1-2 sentence "overview" of what this session set out to do
   and whether it got there, plus 4-8 "keyConcepts": the tools, commands,
   techniques, libraries or ideas this work involved (the study-worthy material).

2. PREREQUISITES — 4-9 background concepts the developer must ALREADY understand
   to follow what the agent did and why. Infer them even if never stated (a failed
   "npm run build" with a TS error assumes TypeScript, module resolution, the build
   pipeline). These are FOUNDATIONS underneath the work, not the work's own steps.
   For each: a short "concept" name and a one-line "why".

3. SESSION NOTES — 3-8 of the most notable EVENTS, explained plainly. For each give
   a short "event" (e.g. "Created src/auth/jwt.ts", "Error: TS2304 Cannot find name",
   "Ran npx prisma migrate") and an "explanation": what it means, why it happened,
   and — for errors — what caused it and how it was (or should be) resolved.

IGNORE trivial noise (cd, ls, clear, echo) unless it matters.

Session: ${ctx.label || 'terminal session'} (${ctx.shell || 'shell'})
${profileLine}
Session log:
"""
${String(digest).slice(0, 7000)}
"""

Return STRICT JSON (no markdown):
{
  "overview": "<1-2 sentences: what this session did>",
  "keyConcepts": ["<tool/technique/idea involved>", "..."],
  "prerequisites": [
    {
      "concept": "<short name of an assumed-known background concept>",
      "why": "<one line: why it's needed to understand this session>",
      "difficulty": "easy" | "intermediate" | "hard"
    }
  ],
  "sessionNotes": [
    { "event": "<short description of a notable thing that happened>", "explanation": "<what it means / why / how an error resolved>" }
  ]
}

Rules:
- prerequisites are FOUNDATIONS, not the session's own steps.
- Each concept name must stand alone (no "this", no session-specific references).
- Treat errors-and-their-fixes as the most valuable learning moments.
- No secrets, tokens, env values, or personal data in any field.
`.trim();

  let result;
  try {
    result = await generateJSON(prompt, { task: 'triage', temperature: 0.3, maxOutputTokens: 1600 });
  } catch {
    return empty;
  }

  const overview = String(result?.overview || '').trim();
  const keyConcepts = Array.isArray(result?.keyConcepts)
    ? result.keyConcepts
        .map((p) => String(p || '').trim())
        .filter((p) => p.length > 0 && !looksLikeSecretValue(p))
        .slice(0, 8)
    : [];
  const prerequisites = Array.isArray(result?.prerequisites)
    ? result.prerequisites
        .filter((p) => p && p.concept && String(p.concept).trim().length > 0)
        .filter((p) => !looksLikeSecretValue(`${p.concept} ${p.why || ''}`))
        .slice(0, 9)
        .map((p) => ({
          concept: String(p.concept).trim(),
          why: String(p.why || '').trim(),
          difficulty: ['easy', 'intermediate', 'hard'].includes(p.difficulty) ? p.difficulty : 'intermediate',
        }))
    : [];
  const sessionNotes = Array.isArray(result?.sessionNotes)
    ? result.sessionNotes
        .filter((n) => n && (n.event || n.explanation))
        .filter((n) => !looksLikeSecretValue(`${n.event || ''} ${n.explanation || ''}`))
        .slice(0, 8)
        .map((n) => ({
          event: String(n.event || '').trim().slice(0, 200),
          explanation: String(n.explanation || '').trim(),
        }))
        .filter((n) => n.explanation)
    : [];

  return { overview, keyConcepts, prerequisites, sessionNotes };
}

module.exports = { triage, extractLessons, analyzePage, analyzeCode, analyzeSession, preFilter, looksLikeSecretValue, SENSITIVE_PATTERNS };
