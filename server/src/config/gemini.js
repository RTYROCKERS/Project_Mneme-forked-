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
 * @param {{ temperature?: number, maxOutputTokens?: number, system?: string }} [opts]
 * @returns {Promise<string>} the model's text response
 */
async function callGemini(contents, { temperature = 0.5, maxOutputTokens = 1024, system } = {}) {
  if (!GEMINI_API_KEY) {
    const err = new Error('GEMINI_API_KEY is not configured on the server');
    err.status = 503;
    throw err;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  const body = {
    contents,
    generationConfig: { temperature, maxOutputTokens },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };

  const data = await postWithRetry(url, body, 'Gemini API');
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';

  if (!text) {
    const err = new Error('Gemini returned an empty response');
    err.status = 502;
    throw err;
  }

  return text;
}

/**
 * Single-turn text generation.
 * @param {string} prompt
 * @param {object} [opts]
 * @returns {Promise<string>}
 */
function generateText(prompt, opts) {
  return callGemini([{ role: 'user', parts: [{ text: prompt }] }], opts);
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
  return callGemini(contents, opts);
}

/**
 * Single-turn generation that expects JSON back. Strips markdown code fences
 * and parses the result.
 * @param {string} prompt
 * @param {object} [opts]
 * @returns {Promise<any>}
 */
async function generateJSON(prompt, opts) {
  const raw = (await generateText(prompt, opts)).trim();
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (parseErr) {
    const err = new Error(`Gemini did not return valid JSON: ${parseErr.message}`);
    err.status = 502;
    throw err;
  }
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
