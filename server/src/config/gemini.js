/**
 * Gemini API client.
 * Thin wrapper around Google's Generative Language REST API using the
 * native fetch available in Node 18+. Replaces the previous OpenAI client.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const GEMINI_EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || 'text-embedding-004';

const MAX_RETRIES = Number(process.env.GEMINI_MAX_RETRIES || 3);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Whether a failed response is worth retrying.
 *   503 UNAVAILABLE      -> transient "high demand", retry.
 *   429 rate-limited     -> retry IF it isn't a hard "limit: 0" (no free quota).
 * A 429 with "limit: 0" means the project has no quota for this model — retrying
 * won't help, so we surface it immediately.
 */
function isRetryable(status, detail) {
  if (status === 503) return true;
  if (status === 429 && !/limit:\s*0/.test(detail || '')) return true;
  return false;
}

/**
 * POST JSON to a Gemini endpoint with exponential backoff on transient errors.
 * @param {string} url
 * @param {object} body
 * @param {string} label - for error messages ("Gemini API" | "Gemini embeddings API")
 * @returns {Promise<object>} parsed JSON response
 */
async function postWithRetry(url, body, label) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (networkErr) {
      lastErr = new Error(`Failed to reach ${label}: ${networkErr.message}`);
      lastErr.status = 502;
      if (attempt < MAX_RETRIES) { await sleep(400 * 2 ** attempt); continue; }
      throw lastErr;
    }

    if (response.ok) {
      return response.json();
    }

    const detail = await response.text().catch(() => '');
    if (isRetryable(response.status, detail) && attempt < MAX_RETRIES) {
      // Honor server-suggested retry delay if present, else exponential backoff.
      const m = detail.match(/retry(?:Delay)?["']?\s*[:=]\s*["']?(\d+(?:\.\d+)?)s/i);
      const waitMs = m ? Math.min(Number(m[1]) * 1000, 8000) : 400 * 2 ** attempt;
      await sleep(waitMs);
      continue;
    }

    const err = new Error(`${label} error ${response.status}: ${detail}`);
    err.status = response.status === 429 ? 429 : 502;
    throw err;
  }
  throw lastErr;
}

/**
 * Low-level call to Gemini's generateContent endpoint.
 *
 * @param {Array<{role: 'user'|'model', parts: Array<{text: string}>}>} contents
 * @param {{ temperature?: number, maxOutputTokens?: number, system?: string,
 *           jsonMode?: boolean, responseSchema?: object }} [opts]
 * @returns {Promise<{ text: string, finishReason: string|undefined }>}
 */
async function callGemini(contents, {
  temperature = 0.5,
  maxOutputTokens = 1024,
  system,
  jsonMode = false,
  responseSchema,
} = {}) {
  if (!GEMINI_API_KEY) {
    const err = new Error('GEMINI_API_KEY is not configured on the server');
    err.status = 503;
    throw err;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const generationConfig = { temperature, maxOutputTokens };
  if (jsonMode) {
    // Native structured-output mode: Gemini is constrained to emit syntactically
    // valid JSON with no markdown fences or commentary. Passing responseSchema
    // additionally constrains the *shape* (field names/types), so callers get a
    // real schema guarantee instead of hoping the prompt was followed.
    generationConfig.responseMimeType = 'application/json';
    if (responseSchema) generationConfig.responseSchema = responseSchema;
  }

  const body = { contents, generationConfig };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const data = await postWithRetry(url, body, 'Gemini API');
  const candidate = data?.candidates?.[0];
  const text = candidate?.content?.parts?.map((p) => p.text).join('') || '';
  const finishReason = candidate?.finishReason;

  if (!text) {
    const err = new Error(
      finishReason === 'SAFETY'
        ? 'Gemini blocked the response (safety filters)'
        : 'Gemini returned an empty response',
    );
    err.status = 502;
    err.finishReason = finishReason;
    throw err;
  }

  return { text, finishReason };
}

/**
 * Single-turn text generation.
 * @param {string} prompt
 * @param {object} [opts]
 * @returns {Promise<string>}
 */
function generateText(prompt, opts) {
  return callGemini([{ role: 'user', parts: [{ text: prompt }] }], opts).then((r) => r.text);
}

/**
 * Multi-turn chat. messages: [{ role: 'user'|'assistant', content }]; system
 * prompt via opts.system. Provider-agnostic shape used by the LLM facade.
 * @param {Array<{role:'user'|'assistant', content:string}>} messages
 * @param {object} [opts]
 * @returns {Promise<string>}
 */
function chat(messages, opts) {
  const contents = (messages || [])
    .filter((m) => m && m.content)
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content) }],
    }));
  if (contents.length === 0) contents.push({ role: 'user', parts: [{ text: '' }] });
  return callGemini(contents, opts).then((r) => r.text);
}

/** Strips a markdown code fence even when the model added prose around it
 * (older models / responseSchema-less calls sometimes still do this). */
function stripCodeFences(raw) {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return fenced ? fenced[1] : raw;
}

/**
 * Last-resort extraction: scan for the first balanced {...} or [...] block,
 * ignoring braces/brackets that appear inside quoted strings. Used when the
 * model added commentary before/after the JSON. Returns null if no balanced
 * block is found at all (a strong signal the response was truncated).
 */
function extractBalancedJSON(raw) {
  const openers = { '{': '}', '[': ']' };
  let start = -1;
  for (let i = 0; i < raw.length; i += 1) {
    if (raw[i] === '{' || raw[i] === '[') { start = i; break; }
  }
  if (start === -1) return null;

  const open = raw[start];
  const close = openers[open];
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < raw.length; i += 1) {
    const ch = raw[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null; // never closed while scanning -> truncated mid-structure
}

/** Repairs trailing commas before a closing bracket/brace — a common
 * near-miss even from otherwise well-behaved JSON-mode output. */
function repairTrailingCommas(str) {
  return str.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * Single-turn generation that expects JSON back. Uses Gemini's native JSON
 * mode (responseMimeType + optional responseSchema) so the model is
 * constrained at generation time. Still applies defensive parsing (fence
 * stripping, balanced-bracket extraction, trailing-comma repair) as a safety
 * net, and distinguishes "truncated" from "malformed" so callers can decide
 * whether retrying with a smaller request will actually help.
 *
 * @param {string} prompt
 * @param {{ responseSchema?: object } & object} [opts]
 * @returns {Promise<any>}
 */
async function generateJSON(prompt, opts = {}) {
  const { text: raw, finishReason } = await callGemini(
    [{ role: 'user', parts: [{ text: prompt }] }],
    { ...opts, jsonMode: true },
  );

  const candidates = [raw.trim(), stripCodeFences(raw).trim()];
  const balanced = extractBalancedJSON(raw);
  if (balanced) candidates.push(balanced);

  let lastErr;
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (e) {
      lastErr = e;
    }
    try {
      return JSON.parse(repairTrailingCommas(candidate));
    } catch (e) {
      lastErr = e;
    }
  }

  const truncated = finishReason === 'MAX_TOKENS' || balanced === null;
  const err = new Error(
    truncated
      ? `Gemini response was truncated before valid JSON completed (finishReason=${finishReason}): ${lastErr.message}`
      : `Gemini did not return valid JSON: ${lastErr.message}`,
  );
  err.status = 502;
  err.truncated = truncated;
  err.raw = raw;
  throw err;
}

/**
 * Embed a piece of text into a meaning-fingerprint vector using Gemini's
 * text-embedding model. Used by Mneme to compare memories by meaning
 * (cosine similarity), dedupe captures, and build the knowledge graph.
 *
 * @param {string} text
 * @param {{ taskType?: string }} [opts] taskType e.g. RETRIEVAL_DOCUMENT | RETRIEVAL_QUERY | SEMANTIC_SIMILARITY
 * @returns {Promise<number[]>} embedding vector
 */
async function embedText(text, { taskType = 'SEMANTIC_SIMILARITY' } = {}) {
  if (!GEMINI_API_KEY) {
    const err = new Error('GEMINI_API_KEY is not configured on the server');
    err.status = 503;
    throw err;
  }
  const clean = (text || '').toString().trim();
  if (!clean) {
    const err = new Error('embedText requires non-empty text');
    err.status = 400;
    throw err;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_EMBED_MODEL}:embedContent?key=${GEMINI_API_KEY}`;
  const body = {
    model: `models/${GEMINI_EMBED_MODEL}`,
    content: { parts: [{ text: clean }] },
    taskType,
  };

  const data = await postWithRetry(url, body, 'Gemini embeddings API');
  const vector = data?.embedding?.values;
  if (!Array.isArray(vector) || vector.length === 0) {
    const err = new Error('Gemini returned an empty embedding');
    err.status = 502;
    throw err;
  }
  return vector;
}

module.exports = { callGemini, generateText, generateJSON, chat, embedText, GEMINI_MODEL, GEMINI_EMBED_MODEL };
