/**
 * LLM facade (pluggable provider layer).
 *
 * Mneme's engines import the LLM from HERE, not from a specific vendor. That
 * way the whole app can switch from Gemini (free, for now) to Azure AI Foundry
 * (premium, at the last step) by changing env vars — zero engine changes.
 *
 * Provider selection (env):
 *   LLM_PROVIDER        default provider for chat/JSON     (default: gemini)
 *   LLM_SMART_PROVIDER  provider for "smart" tasks         (default: = LLM_PROVIDER)
 *   LLM_EMBED_PROVIDER  provider for embeddings            (default: gemini — free)
 *
 * Per-task routing keeps costs/credits in check:
 *   - High-volume, simple work (triage) → the cheap/free provider.
 *   - Rare, user-facing work (explain, quiz) → the "smart" provider, if set.
 * Pass { task: 'triage' | 'explain' | 'quiz' } to generateText/generateJSON.
 */

const gemini = require('./gemini');
const azure = require('./azureProvider');

const REGISTRY = { gemini, azure };

const DEFAULT_PROVIDER = (process.env.LLM_PROVIDER || 'gemini').toLowerCase();
const SMART_PROVIDER = (process.env.LLM_SMART_PROVIDER || DEFAULT_PROVIDER).toLowerCase();
const EMBED_PROVIDER = (process.env.LLM_EMBED_PROVIDER || 'gemini').toLowerCase();

// Tasks that should use the (optionally stronger) "smart" provider.
const SMART_TASKS = new Set(['explain', 'quiz']);

function resolve(name) {
  const provider = REGISTRY[name];
  if (!provider) {
    const err = new Error(`Unknown LLM provider '${name}'. Valid: ${Object.keys(REGISTRY).join(', ')}`);
    err.status = 500;
    throw err;
  }
  return provider;
}

function providerForTask(task) {
  return resolve(SMART_TASKS.has(task) ? SMART_PROVIDER : DEFAULT_PROVIDER);
}

/**
 * @param {string} prompt
 * @param {{ task?: string, temperature?: number, maxOutputTokens?: number, system?: string }} [opts]
 */
function generateText(prompt, { task, ...opts } = {}) {
  return providerForTask(task).generateText(prompt, opts);
}

function generateJSON(prompt, { task, ...opts } = {}) {
  return providerForTask(task).generateJSON(prompt, opts);
}

/**
 * Embeddings always go through the embed provider (Gemini is free and good).
 * @param {string} text
 * @param {object} [opts]
 */
function embedText(text, opts) {
  return resolve(EMBED_PROVIDER).embedText(text, opts);
}

/** Diagnostics for a health/status endpoint. */
function activeProviders() {
  return {
    default: DEFAULT_PROVIDER,
    smart: SMART_PROVIDER,
    embed: EMBED_PROVIDER,
    azureConfigured: azure.isConfigured(),
  };
}

module.exports = { generateText, generateJSON, embedText, activeProviders };
