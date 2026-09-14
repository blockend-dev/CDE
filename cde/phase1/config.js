'use strict';
/**
 * Phase 1 experiment configuration — fixed, versioned constants. Nothing in
 * this file may depend on wall-clock time: every value here feeds into
 * deterministic hashes/IDs that must be byte-identical across repeated runs
 * of the same experiment (see cde/phase1/runExperiment.js).
 */

const { contentHash } = require('../lib/hash');

const EXPERIMENT_VERSION = 'phase1-0.1.0';

/**
 * The "adapter configuration" that stands in for a model configuration in
 * Phase 1. There is no real LLM wired in yet — ADAPTER_CONFIG identifies
 * the deterministic test adapter itself, so that cde/lib/pairing.js's
 * modelConfigHash field (part of what a Clean/Injected pair must share) is
 * meaningful even before a real model exists.
 */
const ADAPTER_CONFIG = Object.freeze({
  adapterId: 'phase1-deterministic-test-adapter',
  adapterVersion: '0.1.0',
  note: 'Model-boundary fixture only. Computes decisions from market data via the existing claim-blind baseline; does not reason about claim content. Not a real LLM.',
});

function adapterConfigHash() {
  return contentHash(ADAPTER_CONFIG);
}

/**
 * Stand-in for a system-prompt hash. Phase 1 has no real prompt (there is
 * no LLM), so this hashes a fixed descriptive placeholder instead — kept as
 * its own field (matching cde/lib/pairing.js's PAIRING_FIELDS contract) so
 * Phase 2 can drop in a real prompt hash without changing the pairing
 * schema.
 */
function systemPromptHash() {
  return contentHash({ note: 'phase1-has-no-real-prompt', adapterId: ADAPTER_CONFIG.adapterId });
}

const SEED = 20260919; // fixed for Phase 1; not used for any sampling (the test adapter is fully deterministic) but present so the pairing contract's seed field is exercised

module.exports = { EXPERIMENT_VERSION, ADAPTER_CONFIG, adapterConfigHash, systemPromptHash, SEED };
