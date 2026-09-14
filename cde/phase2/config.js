'use strict';
/**
 * Phase 2 model configuration — explicit and versioned, per METHODOLOGY.md
 * requirements carried into Phase 2. Every field that affects model
 * behavior is captured here and folded into modelConfigHash, which becomes
 * part of the pairing key (cde/lib/pairing.js) exactly the way Phase 1's
 * ADAPTER_CONFIG did.
 *
 * The API key is read from the environment ONLY — never hardcoded, never
 * logged, never included in modelConfigHash (a config hash is meant to be
 * shared/compared across trials and reports; a secret must never be part
 * of that).
 */

const { contentHash } = require('../lib/hash');

const PROVIDER = 'anthropic';

// Chosen because api.anthropic.com was empirically confirmed reachable
// from this environment (HTTP 401 without a key — i.e. network-reachable,
// auth-gated) while the alternative provider checked was not reachable at
// all. See cde/phase2/README.md for that verification.
const MODEL = process.env.CDE_MODEL || 'claude-sonnet-5';
const TEMPERATURE = Number(process.env.CDE_TEMPERATURE || 0);
const MAX_TOKENS = Number(process.env.CDE_MAX_TOKENS || 1024);
const MAX_TOOL_TURNS = Number(process.env.CDE_MAX_TOOL_TURNS || 8);

const PROMPT_VERSION = 'phase2-prompt-v1';
const ADAPTER_VERSION = 'phase2-real-model-adapter-0.1.0';

const RETRY_POLICY = Object.freeze({
  maxAttempts: Number(process.env.CDE_MAX_RETRIES || 3),
  baseDelayMs: 500,
});

function apiKey() {
  return process.env.ANTHROPIC_API_KEY || '';
}

/**
 * Everything that affects model behavior, EXCLUDING the secret key itself.
 * toolManifestHash is passed in by the caller (cde/lib/tools.js) rather
 * than imported here, to avoid this config module reaching into the
 * tool-manifest module for something that's really the caller's concern.
 */
function modelConfig({ toolManifestHash }) {
  return Object.freeze({
    provider: PROVIDER,
    model: MODEL,
    temperature: TEMPERATURE,
    maxTokens: MAX_TOKENS,
    maxToolTurns: MAX_TOOL_TURNS,
    promptVersion: PROMPT_VERSION,
    adapterVersion: ADAPTER_VERSION,
    toolManifestHash,
  });
}

function modelConfigHash({ toolManifestHash }) {
  return contentHash(modelConfig({ toolManifestHash }));
}

module.exports = {
  PROVIDER,
  MODEL,
  TEMPERATURE,
  MAX_TOKENS,
  MAX_TOOL_TURNS,
  PROMPT_VERSION,
  ADAPTER_VERSION,
  RETRY_POLICY,
  apiKey,
  modelConfig,
  modelConfigHash,
};
