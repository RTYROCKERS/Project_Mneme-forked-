/**
 * Azure AI Foundry / Azure OpenAI provider.
 *
 * Mirrors the interface of gemini.js (generateText / generateJSON / embedText)
 * so the LLM facade can swap to it with one env var at the last step — no
 * engine code changes. Until the AZURE_* env vars are filled in, isConfigured()
 * returns false and any call throws a clear 503.
 *
 * Expected env (set at the "go to Azure" step):
 *   AZURE_OPENAI_ENDPOINT          https://<resource>.openai.azure.com
 *   AZURE_OPENAI_KEY               api key
 *   AZURE_OPENAI_DEPLOYMENT        chat model deployment name
 *   AZURE_OPENAI_EMBED_DEPLOYMENT  embedding model deployment name
 *   AZURE_OPENAI_API_VERSION       e.g. 2024-08-01-preview
 */

const ENDPOINT = (process.env.AZURE_OPENAI_ENDPOINT || '').replace(/\/$/, '');
const KEY = process.env.AZURE_OPENAI_KEY || '';
const DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT || '';
const EMBED_DEPLOYMENT = process.env.AZURE_OPENAI_EMBED_DEPLOYMENT || '';
const API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview';
const MAX_RETRIES = Number(process.env.AZURE_MAX_RETRIES || 3);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isConfigured() {
  return Boolean(ENDPOINT && KEY && DEPLOYMENT);
}

/**
 * POST JSON to an Azure OpenAI endpoint with exponential backoff on transient
 * errors (429 throttling, 5xx). Honors the Retry-After header when present.
 * Keeps the demo resilient under burst load instead of failing on the first 429.
 */
async function postWithRetry(url, body, label) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': KEY },
        body: JSON.stringify(body),
      });
    } catch (networkErr) {
      lastErr = new Error(`Failed to reach ${label}: ${networkErr.message}`);
      lastErr.status = 502;
      if (attempt < MAX_RETRIES) { await sleep(400 * 2 ** attempt); continue; }
      throw lastErr;
    }

    if (res.ok) return res.json();

    const detail = await res.text().catch(() => '');
    const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
    if (retryable && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 10000)
        : 400 * 2 ** attempt;
      await sleep(waitMs);
      continue;
    }

    const err = new Error(`${label} error ${res.status}: ${detail}`);
    err.status = res.status === 429 ? 429 : 502;
    throw err;
  }
  throw lastErr;
}

function notConfigured(what = 'chat') {
  const err = new Error(
    `Azure provider is not configured for ${what}. Set AZURE_OPENAI_ENDPOINT, ` +
    'AZURE_OPENAI_KEY and the relevant deployment env vars.'
  );
  err.status = 503;
  return err;
}

async function callAzure(messages, { temperature = 0.5, maxOutputTokens = 1024, system } = {}) {
  if (!isConfigured()) throw notConfigured('chat');
  const finalMessages = system && messages[0]?.role !== 'system'
    ? [{ role: 'system', content: system }, ...messages]
    : messages;
  const url = `${ENDPOINT}/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`;
  const data = await postWithRetry(
    url,
    { messages: finalMessages, temperature, max_tokens: maxOutputTokens },
    'Azure OpenAI'
  );
  const text = data?.choices?.[0]?.message?.content || '';
  if (!text) {
    const err = new Error('Azure returned an empty response');
    err.status = 502;
    throw err;
  }
  return text;
}

function generateText(prompt, opts) {
  return callAzure([{ role: 'user', content: prompt }], opts);
}

/**
 * Multi-turn chat. messages: [{ role: 'user'|'assistant', content }]; system
 * prompt via opts.system. Mirrors gemini.chat so the facade is provider-agnostic.
 */
function chat(messages, { system, ...opts } = {}) {
  const mapped = (messages || [])
    .filter((m) => m && m.content)
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content) }));
  if (mapped.length === 0) mapped.push({ role: 'user', content: '' });
  return callAzure(mapped, { ...opts, system });
}

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
    const err = new Error(`Azure did not return valid JSON: ${parseErr.message}`);
    err.status = 502;
    throw err;
  }
}

async function embedText(text) {
  if (!ENDPOINT || !KEY || !EMBED_DEPLOYMENT) throw notConfigured('embeddings');
  const clean = (text || '').toString().trim();
  if (!clean) {
    const err = new Error('embedText requires non-empty text');
    err.status = 400;
    throw err;
  }
  const url = `${ENDPOINT}/openai/deployments/${EMBED_DEPLOYMENT}/embeddings?api-version=${API_VERSION}`;
  const data = await postWithRetry(url, { input: clean }, 'Azure embeddings');
  const vector = data?.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length === 0) {
    const err = new Error('Azure returned an empty embedding');
    err.status = 502;
    throw err;
  }
  return vector;
}

module.exports = { generateText, generateJSON, chat, embedText, isConfigured, name: 'azure' };
