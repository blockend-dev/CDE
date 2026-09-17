'use strict';
/**
 * Milestone 2 — Counterfactual Lab + diff engine. The rendering itself is
 * vanilla DOM code (no framework, no jsdom dependency added), so these
 * tests validate the data every counterfactual/diff view depends on:
 * the API payload shape, the diff-relevant computed fields, and the
 * claims-feed evidence-availability distinction the UI visualizes.
 * Run: node demo/test/m2.test.js
 */

const assert = require('assert');
const dataLoader = require('../server/dataLoader');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${e.stack.split('\n').slice(0, 5).join('\n      ')}`);
  }
}

const { pairs } = dataLoader.load();

check('every pair carries a resolved claim from the locked corpus, never invented text', () => {
  for (const p of pairs) {
    assert.ok(p.claimFixtureId, `${p.pairingKey} missing claimFixtureId`);
    assert.ok(p.claimText && p.claimText.length > 10, `${p.pairingKey} has no resolved claim text`);
    assert.ok(p.claimText.includes(p.symbol), 'resolved claim text must be interpolated with the real symbol');
  }
});

check('clean member never sees claim content in its claims-feed tool response (claim-blind by construction)', () => {
  for (const p of pairs) {
    const claimsCall = p.clean.decision.toolCalls.find((tc) => tc.toolName === 'get_claims_feed');
    assert.ok(claimsCall, `${p.pairingKey} clean member never called get_claims_feed`);
    assert.strictEqual(claimsCall.response.items.length, 0, `${p.pairingKey} clean claims feed must be empty`);
  }
});

check('injected member\'s claims-feed tool response actually contains the same claim fixture', () => {
  for (const p of pairs) {
    const claimsCall = p.injected.decision.toolCalls.find((tc) => tc.toolName === 'get_claims_feed');
    assert.ok(claimsCall, `${p.pairingKey} injected member never called get_claims_feed`);
    assert.ok(claimsCall.response.items.length >= 1, `${p.pairingKey} injected claims feed must be non-empty`);
    assert.ok(claimsCall.response.items.some((it) => it.id === p.claimFixtureId), 'claims feed item id must match the pair\'s claimFixtureId');
  }
});

check('every completed trial member proposed exactly one action (propose_action present)', () => {
  for (const p of pairs) {
    for (const member of [p.clean, p.injected]) {
      const count = member.decision.toolCalls.filter((tc) => tc.toolName === 'propose_action').length;
      assert.strictEqual(count, 1, `${p.pairingKey} expected exactly one propose_action call`);
    }
  }
});

check('structuredDecisionChanged matches cde/lib/metrics.js: injectedDelta() exactly — exposure/direction/confidence only, never claim status', () => {
  for (const p of pairs) {
    const anyDelta = p.exposureDelta !== 0 || p.confidenceDelta !== 0 || p.directionFlip;
    assert.strictEqual(p.structuredDecisionChanged, anyDelta, `${p.pairingKey} structuredDecisionChanged flag disagrees with its own component deltas`);
  }
});

check('claim status differs on every pair BY CONSTRUCTION (clean is always claim-blind) — this is expected, not a finding', () => {
  assert.ok(pairs.every((p) => p.claimStatusChanged), 'expected claimStatusChanged to be true on every pair in this dataset');
  assert.ok(pairs.every((p) => p.cleanClaimAssessment === 'no_claim_presented'), 'clean member must always be no_claim_presented');
});

check('both reachable UI states exist for the action-relevant fields (changed vs. no structured decision change)', () => {
  assert.ok(pairs.some((p) => p.structuredDecisionChanged), 'expected at least one pair with a structured decision change');
  assert.ok(pairs.some((p) => !p.structuredDecisionChanged), 'expected at least one pair with no structured decision change');
});

check('clean and injected members of a pair share the same snapshot, tool manifest, and model config (same-snapshot invariant)', () => {
  for (const p of pairs) {
    assert.strictEqual(p.clean.snapshotId, p.injected.snapshotId);
    assert.strictEqual(p.clean.toolManifestHash, p.injected.toolManifestHash);
    assert.strictEqual(p.clean.modelConfigHash, p.injected.modelConfigHash);
  }
});

console.log(`\n${failures === 0 ? 'ALL DEMO M2 TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
process.exitCode = failures === 0 ? 0 : 1;
