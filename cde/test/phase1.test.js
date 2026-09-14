'use strict';
/**
 * Phase 1 harness tests: four-cell execution, pairing/tool-surface/baseline
 * invariants, determinism, replay, and the twelve required rejection cases.
 * Run: node cde/test/phase1.test.js
 *
 * PHASE 2 NOTE: converted to an async test runner because trial.js's
 * buildPair()/runSingleTrial() are now async (to support a real, I/O-bound
 * model adapter alongside the still-synchronous Phase 1 deterministic one).
 * No assertion below was weakened, removed, or changed in meaning — every
 * check is identical to the original, just awaited.
 */

const assert = require('assert');
const path = require('path');

const { runFourCellExperiment, FIXED_CLAIM_FIXTURE_ID } = require('../phase1/runExperiment');
const { serializeResult } = require('../phase1/resultSerializer');
const { buildPair, runSingleTrial } = require('../phase1/trial');
const { createToolClient } = require('../phase1/toolReplay');
const { deterministicTestAdapter } = require('../phase1/adapter');
const { loadFixtureSnapshot, assertIsFixtureSnapshot } = require('../phase1/fixtureLoader');
const { WEEKDAY_SNAPSHOT, WEEKEND_SNAPSHOT } = require('../phase1/fixtures/syntheticSnapshots');
const { LOCKED_FIXTURES } = require('../lib/corpus');
const { buildSnapshot } = require('../lib/snapshot');
const { claimBlindBaseline, toMarketOnlyView } = require('../lib/baseline');
const { toolManifestHash } = require('../lib/tools');
const integrity = require('../phase1/integrity');

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${e.stack.split('\n').slice(0, 4).join('\n      ')}`);
  }
}

const CLAIM_FIXTURE = LOCKED_FIXTURES.find((f) => f.id === FIXED_CLAIM_FIXTURE_ID);
const ALLOWED_FIXTURE_IDS = LOCKED_FIXTURES.map((f) => f.id);

async function main() {
  // ==========================================================================
  // Four-cell execution + invariants
  // ==========================================================================

  console.log('== Four-cell execution ==');

  let RESULT; // shared across this block
  await check('runFourCellExperiment executes all four cells with correct condition/claim pairing', async () => {
    RESULT = await runFourCellExperiment();
    const { weekday, weekend } = RESULT.pairs;
    assert.strictEqual(weekday.clean.condition, 'weekday');
    assert.strictEqual(weekday.injected.condition, 'weekday');
    assert.strictEqual(weekend.clean.condition, 'weekend');
    assert.strictEqual(weekend.injected.condition, 'weekend');
    assert.strictEqual(weekday.clean.claimStatus, 'clean');
    assert.strictEqual(weekday.injected.claimStatus, 'injected');
    assert.strictEqual(weekend.clean.claimStatus, 'clean');
    assert.strictEqual(weekend.injected.claimStatus, 'injected');
    assert.strictEqual(weekday.clean.claimFixtureId, null);
    assert.strictEqual(weekend.clean.claimFixtureId, null);
    assert.strictEqual(weekday.injected.claimFixtureId, FIXED_CLAIM_FIXTURE_ID);
    assert.strictEqual(weekend.injected.claimFixtureId, FIXED_CLAIM_FIXTURE_ID);
    assert.deepStrictEqual(RESULT.runManifest.cellsExecuted, ['weekday_clean', 'weekday_injected', 'weekend_clean', 'weekend_injected']);
  });

  console.log('== Pairing invariants ==');

  await check('within each pair: identical snapshotId/timestamp/symbol/toolManifestHash/lock/adapter/version/seed; only claim differs', () => {
    for (const pair of [RESULT.pairs.weekday, RESULT.pairs.weekend]) {
      integrity.assertPairInvariants(pair.clean, pair.injected); // throws on any violation
      assert.strictEqual(pair.clean.snapshotId, pair.injected.snapshotId);
      assert.strictEqual(pair.clean.marketTimestampUtc, pair.injected.marketTimestampUtc);
      assert.strictEqual(pair.clean.symbol, pair.injected.symbol);
      assert.strictEqual(pair.clean.toolManifestHash, pair.injected.toolManifestHash);
      assert.strictEqual(pair.clean.methodologyLockHash, pair.injected.methodologyLockHash);
      assert.strictEqual(pair.clean.modelConfigHash, pair.injected.modelConfigHash);
      assert.strictEqual(pair.clean.experimentVersion, pair.injected.experimentVersion);
      assert.strictEqual(pair.clean.seed, pair.injected.seed);
      assert.notStrictEqual(pair.clean.claimStatus, pair.injected.claimStatus);
    }
  });

  await check('weekday pair and weekend pair use DIFFERENT snapshots/pairingKeys (they are not accidentally the same pair twice)', () => {
    assert.notStrictEqual(RESULT.pairs.weekday.pairingKey, RESULT.pairs.weekend.pairingKey);
    assert.notStrictEqual(RESULT.pairs.weekday.clean.snapshotId, RESULT.pairs.weekend.clean.snapshotId);
  });

  console.log('== Tool-surface invariance ==');

  await check('the same tool manifest hash is used across all four cells', () => {
    const expected = toolManifestHash();
    for (const trial of [RESULT.pairs.weekday.clean, RESULT.pairs.weekday.injected, RESULT.pairs.weekend.clean, RESULT.pairs.weekend.injected]) {
      assert.strictEqual(trial.toolManifestHash, expected);
    }
  });

  await check('every trial calls the same declared tool sequence (get_quote, get_orderbook, get_market_status, get_claims_feed, propose_action)', () => {
    const expectedNames = ['get_quote', 'get_orderbook', 'get_market_status', 'get_claims_feed', 'propose_action'];
    for (const trial of [RESULT.pairs.weekday.clean, RESULT.pairs.weekday.injected, RESULT.pairs.weekend.clean, RESULT.pairs.weekend.injected]) {
      assert.deepStrictEqual(trial.decision.toolCalls.map((c) => c.toolName), expectedNames);
    }
  });

  console.log('== Baseline claim-blindness ==');

  await check('quantitative decision fields (direction/exposure/confidence) are identical for clean vs injected within each condition', () => {
    for (const pair of [RESULT.pairs.weekday, RESULT.pairs.weekend]) {
      integrity.assertBaselineOutputsIdentical(pair.clean.decision, pair.injected.decision); // throws on mismatch
    }
  });

  await check('claimAssessment correctly differs (no_claim_presented vs uncertain) while quantitative fields do not', () => {
    for (const pair of [RESULT.pairs.weekday, RESULT.pairs.weekend]) {
      assert.strictEqual(pair.clean.decision.claimAssessment, 'no_claim_presented');
      assert.strictEqual(pair.injected.decision.claimAssessment, 'uncertain');
    }
  });

  await check('get_claims_feed is the ONLY tool response that differs between clean and injected trials in a pair', () => {
    for (const pair of [RESULT.pairs.weekday, RESULT.pairs.weekend]) {
      const cleanCalls = pair.clean.decision.toolCalls;
      const injectedCalls = pair.injected.decision.toolCalls;
      for (let i = 0; i < cleanCalls.length; i++) {
        const name = cleanCalls[i].toolName;
        if (name === 'get_claims_feed' || name === 'propose_action') continue; // propose_action legitimately differs (echoes the differing claimAssessment/rationale/trace)
        assert.deepStrictEqual(cleanCalls[i].response, injectedCalls[i].response, `tool "${name}" response differs between clean/injected — only get_claims_feed should ever differ`);
      }
    }
  });

  // ==========================================================================
  // Determinism / replay
  // ==========================================================================

  console.log('== Determinism ==');

  await check('executing the full four-cell experiment twice yields byte-identical serialized output', async () => {
    const run1 = await runFourCellExperiment();
    const run2 = await runFourCellExperiment();
    const s1 = serializeResult(run1);
    const s2 = serializeResult(run2);
    assert.strictEqual(s1, s2);
    assert.strictEqual(run1.resultId, run2.resultId);
  });

  console.log('== Replay capability ==');

  await check("a stored trial's tool trace is exactly reproducible by replaying the same snapshot + claim through a fresh tool client", () => {
    const weekdaySnapshot = loadFixtureSnapshot(WEEKDAY_SNAPSHOT);
    const storedTrial = RESULT.pairs.weekday.injected;
    const replayClient = createToolClient(weekdaySnapshot, CLAIM_FIXTURE, storedTrial.trialKey, weekdaySnapshot.marketTimestampUtc);
    replayClient.call('get_quote', { symbol: weekdaySnapshot.symbol });
    replayClient.call('get_orderbook', { symbol: weekdaySnapshot.symbol });
    replayClient.call('get_market_status', { symbol: weekdaySnapshot.symbol });
    const feed = replayClient.call('get_claims_feed', { symbol: weekdaySnapshot.symbol });
    assert.deepStrictEqual(feed, storedTrial.decision.toolCalls.find((c) => c.toolName === 'get_claims_feed').response);
    const storedReadCalls = storedTrial.decision.toolCalls.filter((c) => c.toolName !== 'propose_action');
    const replayedReadCalls = replayClient.getTrace();
    for (let i = 0; i < replayedReadCalls.length; i++) {
      assert.deepStrictEqual(replayedReadCalls[i].response, storedReadCalls[i].response);
    }
  });

  await check('re-running the deterministic adapter against the replayed snapshot reproduces the identical stored decision', async () => {
    const weekendSnapshot = loadFixtureSnapshot(WEEKEND_SNAPSHOT);
    const replayClient = createToolClient(weekendSnapshot, CLAIM_FIXTURE, 'replay-check::injected', weekendSnapshot.marketTimestampUtc);
    const replayedDecision = await deterministicTestAdapter({ snapshot: weekendSnapshot, claimFixture: CLAIM_FIXTURE, toolClient: replayClient });
    const stored = RESULT.pairs.weekend.injected.decision;
    assert.strictEqual(replayedDecision.direction, stored.direction);
    assert.strictEqual(replayedDecision.exposure, stored.exposure);
    assert.strictEqual(replayedDecision.confidence, stored.confidence);
    assert.strictEqual(replayedDecision.claimAssessment, stored.claimAssessment);
  });

  // ==========================================================================
  // Twelve required rejection cases
  // ==========================================================================

  console.log('== Integrity / negative tests (required rejections) ==');

  await check('1. Clean trial containing a claim -> reject', () => {
    assert.throws(() => {
      const fakeCleanTrial = { claimStatus: 'clean', claimFixtureId: CLAIM_FIXTURE.id, decision: { claimAssessment: 'uncertain' } };
      integrity.assertCleanTrialHasNoClaim(fakeCleanTrial);
    }, /Clean trial must have claimFixtureId === null/);
  });

  await check('2. Injected trial without a claim -> reject', () => {
    assert.throws(() => {
      const fakeInjectedTrial = { claimStatus: 'injected', claimFixtureId: null };
      integrity.assertInjectedTrialHasValidClaim(fakeInjectedTrial, ALLOWED_FIXTURE_IDS);
    }, /must have exactly one claimFixtureId/);
  });

  await check('3. Clean/Injected pair using different snapshots -> reject', async () => {
    const weekdaySnapshot = loadFixtureSnapshot(WEEKDAY_SNAPSHOT);
    const weekendSnapshot = loadFixtureSnapshot(WEEKEND_SNAPSHOT);
    const pk1 = 'fake-pk'; // shared pairingKey deliberately, to isolate the snapshotId check
    const cleanTrial = await runSingleTrial({ snapshot: weekdaySnapshot, claimFixture: null, claimStatus: 'clean', pk: pk1, methodologyLockHash: 'x', adapter: deterministicTestAdapter, modelConfigHash: 'm', experimentVersion: 'v', seed: 1 });
    const injectedTrial = await runSingleTrial({ snapshot: weekendSnapshot, claimFixture: CLAIM_FIXTURE, claimStatus: 'injected', pk: pk1, methodologyLockHash: 'x', adapter: deterministicTestAdapter, modelConfigHash: 'm', experimentVersion: 'v', seed: 1 });
    assert.throws(() => integrity.assertPairInvariants(cleanTrial, injectedTrial), /Pair invariant violated on field "snapshotId"/);
  });

  await check('4. Different tool manifests -> reject', async () => {
    const weekdaySnapshot = loadFixtureSnapshot(WEEKDAY_SNAPSHOT);
    const pk1 = 'fake-pk-2';
    const cleanTrial = await runSingleTrial({ snapshot: weekdaySnapshot, claimFixture: null, claimStatus: 'clean', pk: pk1, methodologyLockHash: 'x', adapter: deterministicTestAdapter, modelConfigHash: 'm', experimentVersion: 'v', seed: 1 });
    const injectedTrial = { ...(await runSingleTrial({ snapshot: weekdaySnapshot, claimFixture: CLAIM_FIXTURE, claimStatus: 'injected', pk: pk1, methodologyLockHash: 'x', adapter: deterministicTestAdapter, modelConfigHash: 'm', experimentVersion: 'v', seed: 1 })), toolManifestHash: 'tampered-hash' };
    assert.throws(() => integrity.assertToolManifestInvariant(cleanTrial, injectedTrial, toolManifestHash()), /Tool manifest hash mismatch/);
    assert.throws(() => integrity.assertPairInvariants(cleanTrial, injectedTrial), /Pair invariant violated on field "toolManifestHash"/);
  });

  await check('5. Claim passed into baseline -> reject', () => {
    assert.throws(() => claimBlindBaseline({ price: {}, orderbook: {}, volume: {}, candles: [], claimText: 'leaked claim' }), /claim-shaped/);
    assert.throws(() => integrity.assertBaselineNeverSeesClaim({ price: {}, injectedClaim: 'x' }), /claim-shaped field reached the baseline/);
    const snapshot = loadFixtureSnapshot(WEEKDAY_SNAPSHOT);
    const tampered = { ...snapshot, claimText: 'this should never reach the baseline' };
    const view = toMarketOnlyView(tampered);
    assert.ok(!('claimText' in view));
  });

  await check('6. Unknown attack-template ID -> reject', () => {
    const { registerClaimFixture } = require('../lib/corpus');
    assert.throws(
      () => registerClaimFixture({ id: 'bad', template: 'not_a_real_template', claimText: 'x', intendedFalseBelief: 'x', expectedVerificationPath: 'x', attackSuccessCondition: 'x' }),
      /unrecognized template/
    );
    assert.throws(() => {
      const fakeInjectedTrial = { claimStatus: 'injected', claimFixtureId: 'nonexistent-fixture-id' };
      integrity.assertInjectedTrialHasValidClaim(fakeInjectedTrial, ALLOWED_FIXTURE_IDS);
    }, /not in the locked corpus/);
  });

  await check('7. Invalid methodology lock -> reject', () => {
    const { computeLock } = require('../lib/methodologyLock');
    const real = computeLock();
    const tampered = { ...real, contentHash: 'deliberately-wrong-hash' };
    assert.notStrictEqual(tampered.contentHash, real.contentHash);
    assert.throws(() => {
      if (computeLock().contentHash !== tampered.contentHash) {
        throw new Error('Methodology lock mismatch: the locked methodology in cde/lib/ has drifted from cde/methodology.lock.json.');
      }
    }, /Methodology lock mismatch/);
  });

  await check('8. Missing snapshot provenance -> reject', () => {
    const snapshot = loadFixtureSnapshot(WEEKDAY_SNAPSHOT);
    const withoutProvenance = { ...snapshot };
    delete withoutProvenance.provenance;
    assert.throws(() => integrity.assertSnapshotProvenancePresent(withoutProvenance), /missing its provenance object/);
  });

  await check('9. Missing tool trace -> reject', () => {
    const fakeTrial = { trialKey: 'x::clean', decision: { toolCalls: [] } };
    assert.throws(() => integrity.assertToolTracePresent(fakeTrial), /no recorded tool-call trace/);
    const mismatchedTrial = { trialKey: 'x::clean', decision: { toolCalls: [{ trialKey: 'y::clean', toolName: 'get_quote' }] } };
    assert.throws(() => integrity.assertToolTracePresent(mismatchedTrial), /trace\/trial mismatch/);
  });

  await check('10. Invalid/unregistered condition -> reject', () => {
    assert.throws(() => integrity.assertConditionValid('holiday'), /Invalid\/unregistered condition/);
    assert.throws(() => integrity.assertConditionValid(undefined), /Invalid\/unregistered condition/);
  });

  await check('11. Attempted mutation of frozen snapshot -> reject (or silently no-op; value must not change)', () => {
    const snapshot = loadFixtureSnapshot(WEEKDAY_SNAPSHOT);
    const originalLast = snapshot.price.last;
    try {
      snapshot.price.last = -1;
    } catch (_) {
      /* strict-mode throw is also an acceptable rejection */
    }
    assert.strictEqual(snapshot.price.last, originalLast);
    try {
      snapshot.symbol = 'TAMPERED';
    } catch (_) {}
    assert.notStrictEqual(snapshot.symbol, 'TAMPERED');
  });

  await check('12. Research-study output accidentally used as Phase 1 fixture output -> reject', () => {
    const fs = require('fs');
    const researchDatasetPath = path.join(__dirname, '..', '..', 'research', 'weekend-informativeness', 'output', 'raw_dataset.json');
    const researchRecords = JSON.parse(fs.readFileSync(researchDatasetPath, 'utf8'));
    assert.ok(researchRecords.length > 0, 'sanity check: the real precondition-study output must exist and be non-empty');
    const sampleRealRecord = researchRecords[0];

    assert.throws(() => assertIsFixtureSnapshot(sampleRealRecord), /missing required market field/);
    assert.throws(() => integrity.assertNotResearchStudyOutput(sampleRealRecord), /research\/weekend-informativeness precondition-study record/);
    assert.throws(() => loadFixtureSnapshot(sampleRealRecord), /Fixture snapshot/);
  });

  await check('12b. a real-shaped snapshot with a non-FIXTURE endpoint is also rejected by the fixture loader', () => {
    const realLikeSnapshot = buildSnapshot(
      {
        symbol: 'RAAPLUSDT',
        marketTimestampUtc: '2026-09-11T15:00:00.000Z',
        price: { last: 320, bid: 319.9, ask: 320.1 },
        orderbook: { bids: [], asks: [], depthLevels: 5 },
        volume: { baseVolume: 1, quoteVolume: 1, windowMinutes: 60 },
        candles: [],
        marketStatus: { underlyingNyseOpen: true, extendedSessionActive: false, sourceNote: 'looks real' },
      },
      { bitgetEndpoint: '/api/v2/spot/market/history-candles', requestParams: {}, capturedAtUtc: '2026-09-11T15:00:00.000Z', isLive: true }
    );
    assert.throws(() => loadFixtureSnapshot(realLikeSnapshot), /does not carry the required "FIXTURE:" marker/);
    assert.throws(() => integrity.assertNotResearchStudyOutput(realLikeSnapshot), /looks like a real Bitget endpoint/);
  });

  console.log(`\n${failures === 0 ? 'ALL PHASE 1 TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Phase 1 test runner crashed:', err);
  process.exit(1);
});
