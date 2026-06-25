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

function isConfigured() {
  return Boolean(ENDPOINT && KEY && DEPLOYMENT);
}

function notConfigured(what = 'chat') {
  const err = new Error(
    `Azure provider is not configured for ${what}. Set AZURE_OPENAI_ENDPOINT, ` +
    'AZURE_OPENAI_KEY and the relevant deployment env vars.'
  );
  err.status = 503;
  return err;
}

async function callAzure(messages, { temperature = 0.5, maxOutputTokens = 1024 } = {}) {
  if (!isConfigured()) throw notConfigured('chat');
  const url = `${ENDPOINT}/openai/deployments/${DEPLOYMENT}/chat/completions?api-version=${API_VERSION}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': KEY },
    body: JSON.stringify({ messages, temperature, max_tokens: maxOutputTokens }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`Azure OpenAI error ${res.status}: ${detail}`);
    err.status = res.status === 429 ? 429 : 502;
    throw err;
  }
  const data = await res.json();
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
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': KEY },
    body: JSON.stringify({ input: clean }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`Azure embeddings error ${res.status}: ${detail}`);
    err.status = res.status === 429 ? 429 : 502;
    throw err;
  }
  const data = await res.json();
  const vector = data?.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length === 0) {
    const err = new Error('Azure returned an empty embedding');
    err.status = 502;
    throw err;
  }
  return vector;
}

module.exports = { generateText, generateJSON, embedText, isConfigured, name: 'azure' };
