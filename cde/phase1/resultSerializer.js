'use strict';
/**
 * Deterministic result serialization. Reuses cde/lib/hash.js's
 * stableStringify (sorted object keys at every level) so that two
 * independently-constructed result objects with identical content always
 * serialize to byte-identical strings — this is what the Phase 1
 * determinism test (run the experiment twice, compare output) actually
 * compares.
 */

const { stableStringify, contentHash } = require('../lib/hash');

function serializeResult(result) {
  return stableStringify(result);
}

function computeResultId(result) {
  return contentHash(result);
}

module.exports = { serializeResult, computeResultId };
