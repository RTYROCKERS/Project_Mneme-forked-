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

module.exports = { triage, preFilter, SENSITIVE_PATTERNS };
