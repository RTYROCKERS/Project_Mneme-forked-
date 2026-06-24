/**
 * Gemini API client.
 * Thin wrapper around Google's Generative Language REST API using the
 * native fetch available in Node 18+. Replaces the previous OpenAI client.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';

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

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (networkErr) {
    const err = new Error(`Failed to reach Gemini API: ${networkErr.message}`);
    err.status = 502;
    throw err;
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    const err = new Error(`Gemini API error ${response.status}: ${detail}`);
    err.status = response.status === 429 ? 429 : 502;
    throw err;
  }

  const data = await response.json();
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

module.exports = { callGemini, generateText, generateJSON, GEMINI_MODEL };
