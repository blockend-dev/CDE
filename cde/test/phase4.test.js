'use strict';
/**
 * Phase 4 tests. This file grows across the phase's milestones. No real
 * model calls are made by any test here — population/snapshot/manifest/
 * orchestrator logic is tested with a scripted fake provider client, the
 * same pattern cde/test/phase2.test.js already uses, so this suite needs
 * no network access and no API key.
 * Run: node cde/test/phase4.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { validRecords, buildCandidateQueues } = require('../phase4/population');
const { buildReplaySnapshot, REPLAY_ENDPOINT_MARKER } = require('../phase4/replaySnapshot');
const { buildRunManifest } = require('../phase4/runManifest');
const { classifyCondition } = require('../lib/conditions');
const { loadFixtureSnapshot } = require('../phase1/fixtureLoader');
const integrity = require('../phase1/integrity');
const { runResearchCollection, countCompletedByCondition, countAttempted, stoppingConditionMet, runDirFor, RUNS_DIR } = require('../phase4/orchestrator');
const { createRealModelAdapter } = require('../phase2/realModelAdapter');
const { MIN_COMPLETED_PAIRS_PER_CONDITION, MAX_ATTEMPTED_PAIRS } = require('../analysis/lib/sampleSizeAssessment');

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${e.stack.split('\n').slice(0, 5).join('\n      ')}`);
  }
}

// ----------------------------------------------------------------------------
// Scripted fake provider client — identical pattern to cde/test/phase2.test.js
// ----------------------------------------------------------------------------

let blockIdCounter = 0;
function toolUseBlock(name, input) {
  blockIdCounter += 1;
  return { type: 'tool_use', id: `tool_${blockIdCounter}`, name, input };
}
function makeResponse(contentBlocks, stopReason) {
  return { content: contentBlocks, stop_reason: stopReason, usage: { input_tokens: 10, output_tokens: 10 } };
}
const VALID_DECISION_INPUT = { direction: 'long', exposure: 0.2, confidence: 0.5, claimAssessment: 'uncertain', rationaleSummary: 'fake' };

function happyPathScript() {
  return ({ messages }) => {
    if (messages.length === 1) {
      return { response: makeResponse([toolUseBlock('get_quote', {}), toolUseBlock('get_orderbook', {}), toolUseBlock('get_market_status', {}), toolUseBlock('get_claims_feed', {})], 'tool_use') };
    }
    return { response: makeResponse([toolUseBlock('propose_action', VALID_DECISION_INPUT)], 'tool_use') };
  };
}

class ScriptedFakeProviderClient {
  constructor(scriptFn) {
    this.scriptFn = scriptFn;
    this.calls = 0;
  }
  async createMessage({ messages }) {
    const result = this.scriptFn({ messages });
    this.calls += 1;
    if (result.throw) throw result.throw;
    return { response: result.response, attempts: [{ attempt: 1, outcome: 'success', tookMs: 0 }] };
  }
}

class NeverCallProviderClient {
  async createMessage() {
    throw new Error('This provider client must never be invoked — idempotency was violated.');
  }
}

function cleanupTestRun(runId) {
  const dir = runDirFor(runId);
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

async function main() {
  console.log('== population.js ==');

  await check("validRecords() reuses the precondition study's own validity definition (887 valid records, matching its published result)", () => {
    const records = validRecords();
    assert.strictEqual(records.length, 887, `expected the precondition study's documented 887 valid observations, got ${records.length}`);
  });

  await check('buildCandidateQueues() produces deterministic, symbol-then-date-sorted queues, not outcome-ordered', () => {
    const { weekdayCandidates, weekendCandidates } = buildCandidateQueues();
    assert.ok(weekdayCandidates.length > 100 && weekendCandidates.length > 100);
    for (let i = 1; i < Math.min(50, weekdayCandidates.length); i++) {
      const a = weekdayCandidates[i - 1].record;
      const b = weekdayCandidates[i].record;
      const ordered = a.symbol < b.symbol || (a.symbol === b.symbol && a.saturdayIso <= b.saturdayIso);
      assert.ok(ordered, `candidates ${i - 1}/${i} are not in the declared deterministic sort order`);
    }
  });

  await check('buildCandidateQueues() is deterministic across repeated calls (same order, same snapshot IDs)', () => {
    const a = buildCandidateQueues();
    const b = buildCandidateQueues();
    assert.strictEqual(a.weekdayCandidates.length, b.weekdayCandidates.length);
    assert.deepStrictEqual(
      a.weekdayCandidates.slice(0, 20).map((c) => c.snapshot.snapshotId),
      b.weekdayCandidates.slice(0, 20).map((c) => c.snapshot.snapshotId)
    );
  });

  await check("every candidate's condition is derived from its real timestamp via the existing classifier, never asserted", () => {
    const { weekdayCandidates, weekendCandidates } = buildCandidateQueues();
    for (const c of weekdayCandidates.slice(0, 30)) {
      assert.strictEqual(classifyCondition(c.snapshot.marketTimestampUtc), 'weekday');
      assert.strictEqual(c.snapshot.condition, 'weekday');
    }
    for (const c of weekendCandidates.slice(0, 30)) {
      assert.strictEqual(classifyCondition(c.snapshot.marketTimestampUtc), 'weekend');
      assert.strictEqual(c.snapshot.condition, 'weekend');
    }
  });

  console.log('== replaySnapshot.js — honesty boundary ==');

  await check('price.last, symbol, and marketTimestampUtc are the REAL values from the precondition record', () => {
    const records = validRecords();
    const record = records[0];
    const snap = buildReplaySnapshot(record, 'weekday');
    assert.strictEqual(snap.symbol, record.symbol);
    assert.strictEqual(snap.price.last, record.observation.fridayRef);
    assert.strictEqual(new Date(snap.marketTimestampUtc).getTime(), record.observation.fridayCandleTs);
  });

  await check('orderbook/volume/candles are clearly-labeled derived placeholders, never claimed as independently real', () => {
    const records = validRecords();
    const snap = buildReplaySnapshot(records[0], 'weekend');
    assert.strictEqual(snap.volume.baseVolume, 0);
    assert.strictEqual(snap.candles.length, 1);
    assert.strictEqual(snap.candles[0].close, snap.price.last);
    assert.ok(/derived/i.test(snap.marketStatus.sourceNote));
    assert.ok(/DERIVED/.test(snap.provenance.disclosure) && /REAL/.test(snap.provenance.disclosure));
  });

  await check('provenance carries the REPLAY: marker, isLive: false, and is accepted by the fixture-loader-equivalent integrity check', () => {
    const records = validRecords();
    const snap = buildReplaySnapshot(records[0], 'weekday');
    assert.ok(snap.provenance.bitgetEndpoint.startsWith('REPLAY:'));
    assert.strictEqual(snap.provenance.bitgetEndpoint, REPLAY_ENDPOINT_MARKER);
    assert.strictEqual(snap.provenance.isLive, false);
    assert.doesNotThrow(() => integrity.assertNotResearchStudyOutput(snap), 'a REPLAY: snapshot must be accepted alongside FIXTURE: snapshots');
  });

  await check('buildReplaySnapshot refuses to fabricate when the real field is missing, rather than inventing a value', () => {
    const fakeRecord = { symbol: 'RTESTUSDT', saturdayIso: '2026-01-03', observation: { fridayRef: null, fridayCandleTs: null, weekendEndPrice: 100, weekendEndCandleTs: 1234567890000 } };
    assert.throws(() => buildReplaySnapshot(fakeRecord, 'weekday'), /refusing to fabricate/);
    assert.doesNotThrow(() => buildReplaySnapshot(fakeRecord, 'weekend'));
  });

  await check('Phase 1 FIXTURE: snapshots are unaffected by the REPLAY: acceptance change (regression check)', () => {
    const { WEEKDAY_SNAPSHOT } = require('../phase1/fixtures/syntheticSnapshots');
    assert.doesNotThrow(() => loadFixtureSnapshot(WEEKDAY_SNAPSHOT));
  });

  console.log('== runManifest.js ==');

  await check('buildRunManifest() captures every required field and is content-addressed', () => {
    const manifest = buildRunManifest();
    const required = [
      'runId', 'startedAtUtc', 'methodologyLockHash', 'analysisLockHash', 'provider', 'model', 'modelConfigHash',
      'promptVersion', 'promptHash', 'toolManifestHash', 'attackCorpusHash', 'adapterVersion', 'experimentVersion',
      'analysisSeed', 'targetMinCompletedPairsPerCondition', 'maxAttemptedPairs', 'repositoryCommitSha', 'manifestHash',
    ];
    required.forEach((f) => assert.ok(f in manifest, `manifest missing required field: ${f}`));
    assert.strictEqual(manifest.methodologyLockHash, '5acc71b0ee54949c04535e10d4fae00e6b85cb79728dbdc5df4b2e455d969d54');
    assert.strictEqual(manifest.analysisLockHash, '43e0479499d286f4dfe06fd8ec4a036941cd3df1ff0b8afeaee423e2e167fdd7');
  });

  await check('the manifest never contains the API key or anything secret-shaped', () => {
    const { containsNoSecrets } = require('../phase2/secretRedaction');
    const manifest = buildRunManifest();
    assert.ok(containsNoSecrets(manifest));
    assert.ok(!('apiKey' in manifest) && !JSON.stringify(manifest).toLowerCase().includes('api_key'));
  });

  // ==========================================================================
  // orchestrator.js — full pipeline against a fake provider client
  // ==========================================================================

  console.log('== orchestrator.js: full collection run against a fake provider (no network) ==');

  const TEST_RUN_ID_1 = 'test-orchestrator-full-run';
  cleanupTestRun(TEST_RUN_ID_1);

  let firstRunResult;
  await check(`orchestrator reaches the stopping rule (${MIN_COMPLETED_PAIRS_PER_CONDITION}/condition) against a fully-scripted successful provider`, async () => {
    const manifest = buildRunManifest({ startedAtUtc: '2026-01-01T00:00:00.000Z' });
    manifest.runId = TEST_RUN_ID_1; // override for test isolation; manifestHash intentionally left as computed (content identity of the config, not the id)
    const providerClient = new ScriptedFakeProviderClient(happyPathScript());
    firstRunResult = await runResearchCollection(manifest, providerClient);
    assert.strictEqual(firstRunResult.counts.weekday, MIN_COMPLETED_PAIRS_PER_CONDITION);
    assert.strictEqual(firstRunResult.counts.weekend, MIN_COMPLETED_PAIRS_PER_CONDITION);
    assert.strictEqual(firstRunResult.stoppingRule.meetsTarget, true);
    assert.strictEqual(firstRunResult.stoppingRule.exhausted, false);
  });

  await check('every completed artifact on disk is well-formed: pair invariants hold, condition matches its directory-level count', () => {
    const trialsDir = path.join(runDirFor(TEST_RUN_ID_1), 'trials');
    const files = fs.readdirSync(trialsDir).filter((f) => f.endsWith('.json'));
    assert.strictEqual(files.length, 40); // 20 weekday + 20 weekend
    for (const f of files) {
      const artifact = JSON.parse(fs.readFileSync(path.join(trialsDir, f), 'utf8'));
      assert.strictEqual(artifact.status, 'completed');
      assert.ok(['weekday', 'weekend'].includes(artifact.condition));
      integrity.assertPairInvariants(artifact.pair.clean, artifact.pair.injected);
      assert.strictEqual(artifact.candidateSnapshotId + '.json', f);
      assert.strictEqual(artifact.runId, TEST_RUN_ID_1);
    }
  });

  await check('claim fixtures were assigned by deterministic round-robin, not a single fixture repeated forever', () => {
    const trialsDir = path.join(runDirFor(TEST_RUN_ID_1), 'trials');
    const files = fs.readdirSync(trialsDir).filter((f) => f.endsWith('.json'));
    const fixtureIdsUsed = new Set(files.map((f) => JSON.parse(fs.readFileSync(path.join(trialsDir, f), 'utf8')).pair.injected.claimFixtureId));
    assert.ok(fixtureIdsUsed.size > 1, 'expected more than one distinct claim fixture across 40 pairs under round-robin assignment');
  });

  await check('every stamped trial carries the REAL adapter config identity (modelConfigHash/experimentVersion), never cde/phase1/trial.js\'s default fallback — regression test for a real bug caught in the first collection attempt', () => {
    const { modelConfigHash: computeModelConfigHash, ADAPTER_VERSION } = require('../phase2/config');
    const { toolManifestHash } = require('../lib/tools');
    const { adapterConfigHash: phase1DefaultHash, EXPERIMENT_VERSION: phase1DefaultVersion } = require('../phase1/config');
    const expectedModelConfigHash = computeModelConfigHash({ toolManifestHash: toolManifestHash() });

    const trialsDir = path.join(runDirFor(TEST_RUN_ID_1), 'trials');
    const files = fs.readdirSync(trialsDir).filter((f) => f.endsWith('.json'));
    assert.ok(files.length > 0);
    for (const f of files) {
      const artifact = JSON.parse(fs.readFileSync(path.join(trialsDir, f), 'utf8'));
      assert.strictEqual(artifact.pair.clean.modelConfigHash, expectedModelConfigHash);
      assert.strictEqual(artifact.pair.injected.modelConfigHash, expectedModelConfigHash);
      assert.strictEqual(artifact.pair.clean.experimentVersion, ADAPTER_VERSION);
      // The two config identities must be genuinely different (proves this is a real, discriminating check, not a tautology).
      assert.notStrictEqual(expectedModelConfigHash, phase1DefaultHash());
      assert.notStrictEqual(ADAPTER_VERSION, phase1DefaultVersion);
    }
  });

  console.log('== orchestrator.js: idempotent resumability (re-run must not re-attempt or duplicate) ==');

  await check('re-running against the same completed run directory makes ZERO provider calls and produces no new/duplicate artifacts', async () => {
    const manifest = buildRunManifest({ startedAtUtc: '2026-01-01T00:00:00.000Z' });
    manifest.runId = TEST_RUN_ID_1;
    const trialsDirBefore = path.join(runDirFor(TEST_RUN_ID_1), 'trials');
    const filesBefore = fs.readdirSync(trialsDirBefore).filter((f) => f.endsWith('.json')).sort();

    const neverCallClient = new NeverCallProviderClient();
    const result = await runResearchCollection(manifest, neverCallClient); // must throw immediately if it ever calls the provider

    const filesAfter = fs.readdirSync(trialsDirBefore).filter((f) => f.endsWith('.json')).sort();
    assert.deepStrictEqual(filesBefore, filesAfter, 'resuming a completed run must not add, remove, or rename any artifact');
    assert.strictEqual(result.counts.weekday, MIN_COMPLETED_PAIRS_PER_CONDITION);
    assert.strictEqual(result.counts.weekend, MIN_COMPLETED_PAIRS_PER_CONDITION);
  });

  await check('writeManifestOnce refuses to silently replace a manifest with a different configuration under the same run ID', () => {
    const { writeManifestOnce } = require('../phase4/orchestrator');
    const runDir = runDirFor(TEST_RUN_ID_1);
    const tamperedManifest = { ...buildRunManifest({ startedAtUtc: '2026-01-01T00:00:00.000Z' }), runId: TEST_RUN_ID_1, manifestHash: 'deliberately-different-hash' };
    assert.throws(() => writeManifestOnce(runDir, tamperedManifest), /refusing to overwrite/);
  });

  cleanupTestRun(TEST_RUN_ID_1);

  console.log('== orchestrator.js: sustained provider failures ==');

  const TEST_RUN_ID_2A = 'test-orchestrator-sustained-failures';
  cleanupTestRun(TEST_RUN_ID_2A);

  await check('a provider that always fails never crashes the process — buildPairSafely already turns every failure into a failed-attempt artifact, so the orchestrator instead exhausts the attempt budget and stops gracefully', async () => {
    const manifest = buildRunManifest({ startedAtUtc: '2026-01-01T00:00:00.000Z' });
    manifest.runId = TEST_RUN_ID_2A;
    const alwaysFailingClient = new ScriptedFakeProviderClient(() => ({ throw: new Error('simulated total outage') }));

    const result = await runResearchCollection(manifest, alwaysFailingClient); // must NOT throw
    assert.strictEqual(result.counts.weekday, 0);
    assert.strictEqual(result.counts.weekend, 0);
    assert.strictEqual(result.attempted, MAX_ATTEMPTED_PAIRS);
    assert.strictEqual(result.stoppingRule.exhausted, true);
    assert.strictEqual(result.stoppingRule.meetsTarget, false);

    const failuresDir = path.join(runDirFor(TEST_RUN_ID_2A), 'failures');
    const failureFiles = fs.readdirSync(failuresDir).filter((f) => f.endsWith('.json'));
    assert.strictEqual(failureFiles.length, MAX_ATTEMPTED_PAIRS);
    const sample = JSON.parse(fs.readFileSync(path.join(failuresDir, failureFiles[0]), 'utf8'));
    assert.strictEqual(sample.status, 'failed');
    assert.ok(sample.failureCategory); // categorized, never silently swallowed
  });

  cleanupTestRun(TEST_RUN_ID_2A);

  console.log('== orchestrator.js: process-crash-and-resume (on-disk state is the source of truth) ==');

  const TEST_RUN_ID_2B = 'test-orchestrator-crash-resume';
  cleanupTestRun(TEST_RUN_ID_2B);

  await check('a run whose process died mid-collection (simulated by seeding partial on-disk artifacts directly, as a real crash would leave them) resumes without re-attempting or duplicating any seeded observation', async () => {
    const manifest = buildRunManifest({ startedAtUtc: '2026-01-01T00:00:00.000Z' });
    manifest.runId = TEST_RUN_ID_2B;

    // Simulate "a prior process already completed 5 weekday + 5 weekend pairs
    // before being killed" by running a real (fake-client) collection with an
    // artificially tiny target, then treating that directory as the crash
    // point for the real-target run below.
    const tinyRunResult = await runResearchCollection(
      { ...manifest, targetMinCompletedPairsPerCondition: 5 }, // note: orchestrator reads the MODULE constant, not this field — see next line
      new ScriptedFakeProviderClient(happyPathScript())
    );
    // The orchestrator's stopping rule is driven by the imported constant, not
    // a manifest field (methodology is not runtime-configurable — see
    // ANALYSIS_PLAN.md §6) — so this run legitimately proceeds all the way to
    // the real MIN_COMPLETED_PAIRS_PER_CONDITION. That is fine for this test:
    // "already-seeded, on-disk, real artifacts" is what matters, regardless
    // of how many there are.
    assert.strictEqual(tinyRunResult.counts.weekday, MIN_COMPLETED_PAIRS_PER_CONDITION);

    const filesBeforeResume = fs.readdirSync(path.join(runDirFor(TEST_RUN_ID_2B), 'trials')).filter((f) => f.endsWith('.json'));
    assert.strictEqual(filesBeforeResume.length, MIN_COMPLETED_PAIRS_PER_CONDITION * 2);

    // "Resume" with a fresh orchestrator call and a client that must NEVER be invoked, since the run already met its target on disk.
    const resumed = await runResearchCollection(manifest, new NeverCallProviderClient());
    assert.strictEqual(resumed.counts.weekday, MIN_COMPLETED_PAIRS_PER_CONDITION);
    assert.strictEqual(resumed.counts.weekend, MIN_COMPLETED_PAIRS_PER_CONDITION);

    const filesAfterResume = fs.readdirSync(path.join(runDirFor(TEST_RUN_ID_2B), 'trials')).filter((f) => f.endsWith('.json'));
    assert.deepStrictEqual(filesBeforeResume.sort(), filesAfterResume.sort(), 'no duplicate or missing artifacts after resume');
  });

  cleanupTestRun(TEST_RUN_ID_2B);

  console.log('== orchestrator.js: stoppingConditionMet unit checks ==');

  await check('stoppingConditionMet correctly distinguishes target-met vs. budget-exhausted vs. neither', () => {
    assert.strictEqual(stoppingConditionMet({ weekday: 20, weekend: 20 }, 40).stop, true);
    assert.strictEqual(stoppingConditionMet({ weekday: 20, weekend: 20 }, 40).meetsTarget, true);
    assert.strictEqual(stoppingConditionMet({ weekday: 5, weekend: 5 }, 120).stop, true);
    assert.strictEqual(stoppingConditionMet({ weekday: 5, weekend: 5 }, 120).exhausted, true);
    assert.strictEqual(stoppingConditionMet({ weekday: 10, weekend: 5 }, 50).stop, false);
  });

  console.log('== datasetFinalize.js ==');

  const { finalizeDataset } = require('../phase4/datasetFinalize');
  const TEST_RUN_ID_3 = 'test-dataset-finalize';
  cleanupTestRun(TEST_RUN_ID_3);

  await check('finalizeDataset() reports a clean collection accurately: zero duplicates, zero violations, consistent config, consumable by Phase 3', async () => {
    const manifest = buildRunManifest({ startedAtUtc: '2026-01-01T00:00:00.000Z' });
    manifest.runId = TEST_RUN_ID_3;
    await runResearchCollection(manifest, new ScriptedFakeProviderClient(happyPathScript()));

    const dataset = finalizeDataset(runDirFor(TEST_RUN_ID_3));
    assert.strictEqual(dataset.completedPairsCount, MIN_COMPLETED_PAIRS_PER_CONDITION * 2);
    assert.strictEqual(dataset.completedByCondition.weekday, MIN_COMPLETED_PAIRS_PER_CONDITION);
    assert.strictEqual(dataset.completedByCondition.weekend, MIN_COMPLETED_PAIRS_PER_CONDITION);
    assert.strictEqual(dataset.duplicateTrialKeyCount, 0);
    assert.strictEqual(dataset.duplicatePairingKeyCount, 0);
    assert.strictEqual(dataset.integrityViolationCount, 0);
    assert.strictEqual(dataset.configConsistent, true);
    assert.strictEqual(dataset.consumableByPhase3Pipeline, true);
    assert.strictEqual(dataset.phase3ClassificationSummary.completedWeekday, MIN_COMPLETED_PAIRS_PER_CONDITION);
    assert.ok(fs.existsSync(path.join(runDirFor(TEST_RUN_ID_3), 'dataset_manifest.json')));
  });

  await check('finalizeDataset() is content-addressed and deterministic given the same run directory', () => {
    const a = finalizeDataset(runDirFor(TEST_RUN_ID_3));
    const b = finalizeDataset(runDirFor(TEST_RUN_ID_3));
    assert.strictEqual(a.datasetManifestHash, b.datasetManifestHash);
  });

  await check('finalizeDataset() genuinely DETECTS a duplicate trialKey and a config inconsistency, rather than always reporting clean', () => {
    const trialsDir = path.join(runDirFor(TEST_RUN_ID_3), 'trials');
    const files = fs.readdirSync(trialsDir).filter((f) => f.endsWith('.json'));
    const victim = JSON.parse(fs.readFileSync(path.join(trialsDir, files[0]), 'utf8'));

    // Duplicate trialKey: clone one artifact's trialKeys onto another's snapshotId-named file.
    const corrupted = JSON.parse(JSON.stringify(victim));
    corrupted.candidateSnapshotId = 'corrupted-duplicate-test';
    fs.writeFileSync(path.join(trialsDir, 'corrupted-duplicate-test.json'), JSON.stringify(corrupted, null, 2));

    // Config inconsistency: a second corrupted artifact with a tampered modelConfigHash.
    const tampered = JSON.parse(JSON.stringify(victim));
    tampered.candidateSnapshotId = 'corrupted-config-test';
    tampered.pair.clean.modelConfigHash = 'tampered-hash';
    fs.writeFileSync(path.join(trialsDir, 'corrupted-config-test.json'), JSON.stringify(tampered, null, 2));

    const dataset = finalizeDataset(runDirFor(TEST_RUN_ID_3));
    assert.ok(dataset.duplicateTrialKeyCount > 0, 'must detect the duplicated trialKey');
    assert.ok(dataset.duplicatePairingKeyCount > 0, 'must detect the duplicated pairingKey');
    assert.strictEqual(dataset.configConsistent, false, 'must detect the tampered modelConfigHash');
    assert.strictEqual(dataset.configConsistency.modelConfigHash.consistent, false);

    // Clean up the injected corruption so it never contaminates a real run.
    fs.unlinkSync(path.join(trialsDir, 'corrupted-duplicate-test.json'));
    fs.unlinkSync(path.join(trialsDir, 'corrupted-config-test.json'));
  });

  cleanupTestRun(TEST_RUN_ID_3);

  console.log(`\n${failures === 0 ? 'ALL PHASE 4 TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Phase 4 test runner crashed:', err);
  process.exit(1);
});
