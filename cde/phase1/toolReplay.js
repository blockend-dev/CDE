'use strict';
/**
 * Deterministic tool-response replay.
 *
 * Implements the exact five tools in cde/lib/tools.js's TOOL_MANIFEST
 * against a single frozen snapshot. There is no live network call anywhere
 * in this file. The same manifest, same implementation, and same call
 * sequence apply regardless of weekday/weekend — the only thing that
 * varies is which snapshot (and, for get_claims_feed, which claim fixture
 * or null) the client was constructed with. That is the entire mechanism
 * by which "tool-surface invariance" (Phase 0 §9) is upheld here: there is
 * exactly one client implementation, not a per-condition variant.
 *
 * Every call is recorded. getTrace() returns the full, ordered log in the
 * exact shape cde/lib/tools.js's validateToolInvocation() expects.
 */

const { getToolManifest, validateToolInvocation } = require('../lib/tools');

const MANIFEST_NAMES = new Set(getToolManifest().map((t) => t.name));

/**
 * @param {object} snapshot        a frozen cde/lib/snapshot.js snapshot (fixture or real)
 * @param {object|null} claimFixture the LOCKED_FIXTURES entry to serve via get_claims_feed, or null for a Clean trial
 * @param {string} trialKey         the trial this client's calls belong to (for trace records)
 * @param {string} requestedAtUtc   fixed, deterministic "call time" — for replay, this is the snapshot's own marketTimestampUtc, never wall-clock (see runExperiment.js note on determinism)
 */
function createToolClient(snapshot, claimFixture, trialKey, requestedAtUtc) {
  const trace = [];

  function call(toolName, args = {}) {
    if (!MANIFEST_NAMES.has(toolName)) {
      throw new Error(`createToolClient: "${toolName}" is not in the tool manifest — cannot call an undeclared tool.`);
    }
    const response = computeResponse(toolName, args);
    const record = { trialKey, toolName, requestedAtUtc, response, snapshotId: snapshot.snapshotId };
    validateToolInvocation(record); // fail loudly here, not later at analysis time, if the record is malformed
    trace.push(record);
    return response;
  }

  function computeResponse(toolName, args) {
    switch (toolName) {
      case 'get_quote':
        return { symbol: snapshot.symbol, ...snapshot.price };
      case 'get_orderbook':
        return { symbol: snapshot.symbol, ...snapshot.orderbook };
      case 'get_market_status':
        // PHASE 2 NOTE: deliberately does NOT include the raw `snapshot.condition`
        // label ("weekday"/"weekend") — that is CDE's own internal experimental
        // classification, not something a real trading system would expose as
        // such. `underlyingNyseOpen`/`extendedSessionActive` (inside
        // marketStatus) already carry the same real information in a form a
        // model could naturally observe, without naming our research variable.
        return { symbol: snapshot.symbol, ...snapshot.marketStatus };
      case 'get_claims_feed':
        // The ONE place a claim can enter a trial's information environment.
        // Identical shape in both conditions: an object with an `items`
        // array, empty for Clean, one entry for Injected. No other tool
        // response ever varies by claim status.
        return {
          symbol: snapshot.symbol,
          items: claimFixture
            ? [{ id: claimFixture.id, template: claimFixture.template, text: claimFixture.claimText.replace('{SYMBOL}', snapshot.symbol) }]
            : [],
        };
      case 'propose_action':
        // The adapter's own final decision, logged as a tool call for a
        // uniform, complete trace — args IS the decision object here.
        return args;
      default:
        throw new Error(`createToolClient: no replay implementation for "${toolName}"`);
    }
  }

  // getTrialKey/getSnapshotId: additive accessors (Phase 2) so an adapter
  // can attach the right identifiers to its own audit records without the
  // caller having to pass trialKey/snapshotId around separately. Does not
  // change call()/getTrace() behavior at all.
  return { call, getTrace: () => trace.slice(), getTrialKey: () => trialKey, getSnapshotId: () => snapshot.snapshotId };
}

module.exports = { createToolClient };
