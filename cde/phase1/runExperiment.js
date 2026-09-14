'use strict';
/**
 * Phase 1 orchestrator: builds both pairs (weekday, weekend) and executes
 * the full four-cell experiment.
 *
 * runFourCellExperiment() is a PURE function of its fixed inputs — the two
 * synthetic fixture snapshots and the fixed claim fixture — with no
 * wall-clock read anywhere in the deterministic result it returns. That is
 * what makes byte-identical replay possible: every timestamp inside the
 * result is either a fixed fixture value or derived from one, never
 * `Date.now()`/`new Date().toISOString()`.
 *
 * This does NOT run a real model, does NOT touch Bitget Demo/paper trading
 * or any live endpoint, and does NOT compute or report anything as
 * evidence for the CDE hypothesis — see cde/phase1/README.md.
 */

const path = require('path');
const fs = require('fs');

const { WEEKDAY_SNAPSHOT, WEEKEND_SNAPSHOT } = require('./fixtures/syntheticSnapshots');
const { loadFixtureSnapshot } = require('./fixtureLoader');
const { buildPair } = require('./trial');
const { LOCKED_FIXTURES } = require('../lib/corpus');
const { EXPERIMENT_VERSION, ADAPTER_CONFIG, SEED } = require('./config');
const integrity = require('./integrity');
const { serializeResult, computeResultId } = require('./resultSerializer');
const { contentHash } = require('../lib/hash');

const FIXED_CLAIM_FIXTURE_ID = 'accum-001'; // fixed choice for Phase 1 harness exercise — not a claim about which fixture "should" be used in real trials

async function runFourCellExperiment() {
  const methodologyLockHash = integrity.assertMethodologyLockValid();

  const weekdaySnapshot = loadFixtureSnapshot(WEEKDAY_SNAPSHOT);
  const weekendSnapshot = loadFixtureSnapshot(WEEKEND_SNAPSHOT);

  const claimFixture = LOCKED_FIXTURES.find((f) => f.id === FIXED_CLAIM_FIXTURE_ID);
  if (!claimFixture) throw new Error(`Fixed claim fixture "${FIXED_CLAIM_FIXTURE_ID}" not found in the locked corpus.`);
  const allowedFixtureIds = LOCKED_FIXTURES.map((f) => f.id);

  const weekdayPair = await buildPair(weekdaySnapshot, claimFixture, allowedFixtureIds);
  const weekendPair = await buildPair(weekendSnapshot, claimFixture, allowedFixtureIds);

  // This orchestrator always uses Phase 1's default (claim-blind) adapter,
  // so — unlike buildPair() itself, which is adapter-agnostic — it is
  // correct to require identical Clean/Injected quantitative output here.
  integrity.assertBaselineOutputsIdentical(weekdayPair.clean.decision, weekdayPair.injected.decision);
  integrity.assertBaselineOutputsIdentical(weekendPair.clean.decision, weekendPair.injected.decision);

  if (weekdayPair.condition !== 'weekday') throw new Error(`Expected weekday fixture to classify as weekday, got "${weekdayPair.condition}".`);
  if (weekendPair.condition !== 'weekend') throw new Error(`Expected weekend fixture to classify as weekend, got "${weekendPair.condition}".`);

  const runManifest = {
    experimentVersion: EXPERIMENT_VERSION,
    methodologyLockHash,
    adapterConfig: ADAPTER_CONFIG,
    seed: SEED,
    claimFixtureId: FIXED_CLAIM_FIXTURE_ID,
    fixtureSetHash: contentHash({ weekday: weekdaySnapshot.snapshotId, weekend: weekendSnapshot.snapshotId }),
    cellsExecuted: ['weekday_clean', 'weekday_injected', 'weekend_clean', 'weekend_injected'],
    note: 'PHASE 1 — deterministic test-adapter fixture run. No real LLM, no Bitget Demo/live trading. Not scientific evidence for the CDE hypothesis.',
  };

  const result = {
    runManifest,
    pairs: { weekday: weekdayPair, weekend: weekendPair },
  };
  const resultId = computeResultId(result);

  return { ...result, resultId };
}

if (require.main === module) {
  (async () => {
    const wallClockStart = new Date().toISOString(); // logged separately — never part of the deterministic result compared below
    const result = await runFourCellExperiment();
    const wallClockEnd = new Date().toISOString();

    const outDir = path.join(__dirname, 'output');
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'result.json'), serializeResult(result));
    fs.writeFileSync(
      path.join(outDir, 'run_log.json'),
      JSON.stringify({ wallClockStart, wallClockEnd, resultId: result.resultId, note: 'Wall-clock metadata only — deliberately excluded from the deterministic result.json so repeated runs stay byte-identical.' }, null, 2)
    );

    console.log('Phase 1 four-cell fixture run complete.');
    console.log('resultId:', result.resultId);
    console.log('cells:', result.runManifest.cellsExecuted.join(', '));
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { runFourCellExperiment, FIXED_CLAIM_FIXTURE_ID };
