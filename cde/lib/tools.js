'use strict';
/**
 * Shared tool-definition manifest.
 *
 * getToolManifest() takes NO condition parameter on purpose — there is no
 * "weekday tool set" vs "weekend tool set." The same five tools exist in
 * every trial; only the DATA a tool call returns differs, because the
 * snapshot it reads from differs. Any future code path that tries to
 * register a condition-specific tool list is a methodology violation and
 * should fail loudly, which is why this module exposes a single frozen
 * manifest rather than a manifest-by-condition lookup.
 */

const { contentHash } = require('./hash');

const TOOL_MANIFEST = Object.freeze([
  Object.freeze({ name: 'get_quote', description: 'Latest price/bid/ask for the symbol.', params: ['symbol'] }),
  Object.freeze({ name: 'get_orderbook', description: 'Order book depth snapshot for the symbol.', params: ['symbol'] }),
  Object.freeze({ name: 'get_market_status', description: 'Underlying-market open/closed state and Bitget session condition.', params: ['symbol'] }),
  Object.freeze({ name: 'get_claims_feed', description: 'Market intel / claims feed — this is the injection point; identical shape in every cell.', params: ['symbol'] }),
  Object.freeze({ name: 'propose_action', description: 'Emit the structured trading decision (see decision.js contract).', params: ['direction', 'exposure', 'confidence'] }),
]);

function getToolManifest() {
  return TOOL_MANIFEST;
}

function toolManifestHash() {
  return contentHash(TOOL_MANIFEST);
}

const REQUIRED_INVOCATION_FIELDS = Object.freeze(['trialKey', 'toolName', 'requestedAtUtc', 'response', 'snapshotId']);

/** Validate a single recorded tool invocation — every call an agent makes must be logged in this shape, nothing implicit. */
function validateToolInvocation(record) {
  for (const f of REQUIRED_INVOCATION_FIELDS) {
    if (!(f in record)) throw new Error(`Tool invocation record missing required field: ${f}`);
  }
  if (!TOOL_MANIFEST.some((t) => t.name === record.toolName)) {
    throw new Error(`Tool invocation references an unregistered tool: ${record.toolName}`);
  }
  return true;
}

module.exports = { TOOL_MANIFEST, getToolManifest, toolManifestHash, validateToolInvocation, REQUIRED_INVOCATION_FIELDS };
