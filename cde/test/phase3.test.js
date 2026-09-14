'use strict';
/**
 * Phase 3 analysis-plan tests. Every fixture in this file is SYNTHETIC,
 * hand-constructed to exercise the analysis implementation — none of it is
 * research evidence and none of it is presented as such.
 * Run: node cde/test/phase3.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { permutationTest, bootstrapCI, meanDiff, medianDiff, mean, median } = require('../analysis/lib/resampling');
const { fisherExactTwoSided, wilsonScoreInterval95, holmBonferroni } = require('../analysis/lib/proportions');
const { validateAndClassify } = require('../analysis/lib/inputValidation');
const { computePrimaryAnalysis } = require('../analysis/lib/primaryAnalysis');
const { computeSecondaryAnalysis, computeCalendarPriorReport } = require('../analysis/lib/secondaryAnalysis');
const { computeExploratoryStratification } = require('../analysis/lib/stratification');
const { assessSampleSize } = require('../analysis/lib/sampleSizeAssessment');
const { computeLock, ANALYSIS_SEED } = require('../analysis/lib/analysisLock');
const { runAnalysis } = require('../analysis/lib/runAnalysis');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${e.stack.split('\n').slice(0, 4).join('\n      ')}`);
  }
}

// ----------------------------------------------------------------------------
// Synthetic fixture builders — clearly marked, never research data.
// ----------------------------------------------------------------------------

const REF_METHODOLOGY_HASH = 'synthetic-methodology-hash';
const REF_TOOL_MANIFEST_HASH = 'synthetic-tool-manifest-hash';
const REF_MODEL_CONFIG_HASH = 'synthetic-model-config-hash';

let pairCounter = 0;

function makeDecision({ direction = 'neutral', exposure = 0, confidence = 0.3, claimAssessment = 'no_claim_presented', verificationAttempts = [], rationaleSummary = 'synthetic' } = {}) {
  return { direction, exposure, confidence, claimAssessment, verificationAttempts, toolCalls: [], rationaleSummary };
}

function makeCompletedAttempt({ condition, cleanDecision, injectedDecision, pairingKey, config = {} } = {}) {
  pairCounter += 1;
  const pk = pairingKey || `synthetic-pk-${pairCounter}`;
  const cfg = {
    methodologyLockHash: config.methodologyLockHash || REF_METHODOLOGY_HASH,
    toolManifestHash: config.toolManifestHash || REF_TOOL_MANIFEST_HASH,
    modelConfigHash: config.modelConfigHash || REF_MODEL_CONFIG_HASH,
  };
  const base = { pairingKey: pk, snapshotId: `snap-${pk}`, condition, ...cfg };
  return {
    status: 'completed',
    condition,
    pair: {
      pairingKey: pk,
      condition,
      clean: { ...base, trialKey: `${pk}::clean`, claimStatus: 'clean', claimFixtureId: null, decision: cleanDecision },
      injected: { ...base, trialKey: `${pk}::injected`, claimStatus: 'injected', claimFixtureId: 'synthetic-fixture', decision: injectedDecision },
    },
  };
}

function makeFailedAttempt({ condition = 'weekday', failureCategory = 'provider_network', message = 'synthetic failure' } = {}) {
  return { status: 'failed', condition, failureCategory, message };
}

/** Builds N pairs for a condition with a deterministic exposureDelta sequence (no Math.random — fully reproducible fixtures). */
function buildPairsWithDeltas(condition, deltas) {
  return deltas.map((delta, i) => {
    const cleanExposure = 0;
    const injectedExposure = Math.max(-1, Math.min(1, delta)); // clamp defensively; callers should pass valid deltas
    return makeCompletedAttempt({
      condition,
      cleanDecision: makeDecision({ exposure: cleanExposure, direction: 'neutral' }),
      injectedDecision: makeDecision({ exposure: injectedExposure, direction: injectedExposure > 0 ? 'long' : injectedExposure < 0 ? 'short' : 'neutral', claimAssessment: 'uncertain' }),
    });
  });
}

async function main() {
  // ==========================================================================
  // Low-level statistical primitives — correctness checks
  // ==========================================================================

  console.log('== resampling.js primitives ==');

  check('mean/median/meanDiff/medianDiff compute correctly on hand-checked values', () => {
    assert.strictEqual(mean([1, 2, 3]), 2);
    assert.strictEqual(median([1, 2, 3, 4]), 2.5);
    assert.strictEqual(meanDiff([4, 6], [1, 1]), 4); // mean([4,6])=5, mean([1,1])=1, 5-1=4
    assert.strictEqual(medianDiff([4, 6], [1, 3]), 3); // median([4,6])=5, median([1,3])=2
  });

  check('permutationTest is deterministic given a fixed seed (identical results across repeated calls)', () => {
    const a = [0.1, 0.2, -0.1, 0.05, 0.3];
    const b = [0.4, 0.5, 0.2, 0.6, 0.3];
    const r1 = permutationTest(a, b, { seed: 777, numPermutations: 2000 });
    const r2 = permutationTest(a, b, { seed: 777, numPermutations: 2000 });
    assert.deepStrictEqual(r1, r2);
  });

  check('permutationTest requires an explicit seed', () => {
    assert.throws(() => permutationTest([1], [2], {}), /requires an explicit seed/);
  });

  check('permutationTest flags empty groups rather than computing a fabricated p-value', () => {
    const r = permutationTest([], [1, 2], { seed: 1 });
    assert.strictEqual(r.applicable, false);
    assert.strictEqual(r.reason, 'empty_group');
  });

  check('bootstrapCI flags groups with fewer than 2 members as insufficient rather than fabricating an interval (degenerate bootstrap case)', () => {
    const r0 = bootstrapCI([], [1, 2, 3], { seed: 1 });
    const r1 = bootstrapCI([5], [1, 2, 3], { seed: 1 });
    assert.strictEqual(r0.applicable, false);
    assert.strictEqual(r1.applicable, false);
    assert.strictEqual(r1.reason, 'insufficient_sample');
  });

  check('bootstrapCI is deterministic given a fixed seed', () => {
    const a = [0.1, 0.2, -0.1, 0.05, 0.3, 0.15];
    const b = [0.4, 0.5, 0.2, 0.6, 0.3, 0.35];
    const r1 = bootstrapCI(a, b, { seed: 42, numResamples: 2000 });
    const r2 = bootstrapCI(a, b, { seed: 42, numResamples: 2000 });
    assert.deepStrictEqual(r1, r2);
  });

  console.log('== proportions.js primitives ==');

  check('fisherExactTwoSided matches the classic "lady tasting tea" textbook result ([[3,1],[1,3]] -> p ~= 0.4857)', () => {
    const r = fisherExactTwoSided(3, 1, 1, 3);
    assert.ok(Math.abs(r.pValue - 0.4857142857) < 0.001, `got ${r.pValue}`);
  });

  check('fisherExactTwoSided gives a small p-value for a strongly separated table and near-1 for a balanced one', () => {
    const separated = fisherExactTwoSided(0, 8, 8, 0);
    const balanced = fisherExactTwoSided(5, 5, 5, 5);
    assert.ok(separated.pValue < 0.01, `separated pValue=${separated.pValue}`);
    assert.ok(balanced.pValue > 0.9, `balanced pValue=${balanced.pValue}`);
  });

  check('wilsonScoreInterval95 bounds are sane and contain the point estimate', () => {
    const r = wilsonScoreInterval95(50, 100);
    assert.ok(r.applicable);
    assert.ok(r.lower < 0.5 && 0.5 < r.upper);
    assert.ok(r.lower >= 0 && r.upper <= 1);
    const zero = wilsonScoreInterval95(0, 10);
    assert.strictEqual(zero.lower, 0);
  });

  check('holmBonferroni is more conservative than uncorrected but less than plain Bonferroni, and matches hand computation on a small example', () => {
    const raw = [0.01, 0.02, 0.03, 0.20];
    const holm = holmBonferroni(raw, 0.05);
    // Hand computation: sorted [0.01,0.02,0.03,0.20], multipliers [4,3,2,1]
    // adjusted (running max): 0.04, 0.06, 0.06, 0.20
    assert.ok(Math.abs(holm[0].adjustedPValue - 0.04) < 1e-9);
    assert.ok(Math.abs(holm[1].adjustedPValue - 0.06) < 1e-9);
    assert.ok(Math.abs(holm[2].adjustedPValue - 0.06) < 1e-9);
    assert.ok(Math.abs(holm[3].adjustedPValue - 0.2) < 1e-9);
    assert.strictEqual(holm[0].significant, true);
    assert.strictEqual(holm[3].significant, false);
  });

  // ==========================================================================
  // Synthetic validation scenarios (as required by the brief)
  // ==========================================================================

  console.log('== Synthetic validation scenarios ==');

  check('1. Zero treatment effect: weekday and weekend deltas drawn from the same values -> DiD ~= 0, high p-value', () => {
    const deltas = [0.1, -0.1, 0.2, -0.2, 0.05, -0.05, 0.15, -0.15, 0.0, 0.1];
    const attempts = [...buildPairsWithDeltas('weekday', deltas), ...buildPairsWithDeltas('weekend', deltas)];
    const validated = validateAndClassify(attempts);
    const primary = computePrimaryAnalysis(validated.weekdayPairs, validated.weekendPairs, { seed: ANALYSIS_SEED, numPermutations: 5000, numResamples: 5000 });
    assert.ok(Math.abs(primary.pointEstimate.did) < 1e-9, `did=${primary.pointEstimate.did}`);
    assert.ok(primary.significance.twoSided.pValue > 0.5, `pValue=${primary.significance.twoSided.pValue}`);
  });

  check('2. Positive interaction: weekend deltas systematically higher -> DiD > 0, small p-value, CI excludes 0', () => {
    const weekday = [0.05, 0.02, -0.01, 0.03, 0.0, 0.04, -0.02, 0.01, 0.02, 0.03];
    const weekend = [0.5, 0.55, 0.48, 0.52, 0.6, 0.45, 0.5, 0.53, 0.49, 0.51];
    const attempts = [...buildPairsWithDeltas('weekday', weekday), ...buildPairsWithDeltas('weekend', weekend)];
    const validated = validateAndClassify(attempts);
    const primary = computePrimaryAnalysis(validated.weekdayPairs, validated.weekendPairs, { seed: ANALYSIS_SEED, numPermutations: 5000, numResamples: 5000 });
    assert.ok(primary.pointEstimate.did > 0.3, `did=${primary.pointEstimate.did}`);
    assert.ok(primary.significance.twoSided.pValue < 0.01, `pValue=${primary.significance.twoSided.pValue}`);
    assert.ok(primary.confidenceInterval.lower > 0, `CI lower=${primary.confidenceInterval.lower} should exclude 0`);
  });

  check('3. Negative interaction: weekend deltas systematically lower -> DiD < 0', () => {
    const weekday = [0.5, 0.55, 0.48, 0.52, 0.6, 0.45, 0.5, 0.53, 0.49, 0.51];
    const weekend = [0.05, 0.02, -0.01, 0.03, 0.0, 0.04, -0.02, 0.01, 0.02, 0.03];
    const attempts = [...buildPairsWithDeltas('weekday', weekday), ...buildPairsWithDeltas('weekend', weekend)];
    const validated = validateAndClassify(attempts);
    const primary = computePrimaryAnalysis(validated.weekdayPairs, validated.weekendPairs, { seed: ANALYSIS_SEED, numPermutations: 5000, numResamples: 5000 });
    assert.ok(primary.pointEstimate.did < -0.3, `did=${primary.pointEstimate.did}`);
    assert.ok(primary.confidenceInterval.upper < 0, `CI upper=${primary.confidenceInterval.upper} should exclude 0`);
  });

  check('4. Identical paired observations (clean == injected everywhere) -> all deltas exactly 0, DiD exactly 0, p-value == 1', () => {
    const attempts = [];
    for (let i = 0; i < 8; i++) {
      attempts.push(makeCompletedAttempt({ condition: 'weekday', cleanDecision: makeDecision({ exposure: 0.3 }), injectedDecision: makeDecision({ exposure: 0.3, claimAssessment: 'uncertain' }) }));
      attempts.push(makeCompletedAttempt({ condition: 'weekend', cleanDecision: makeDecision({ exposure: -0.2 }), injectedDecision: makeDecision({ exposure: -0.2, claimAssessment: 'uncertain' }) }));
    }
    const validated = validateAndClassify(attempts);
    const primary = computePrimaryAnalysis(validated.weekdayPairs, validated.weekendPairs, { seed: ANALYSIS_SEED, numPermutations: 2000, numResamples: 2000 });
    assert.strictEqual(primary.pointEstimate.did, 0);
    assert.strictEqual(primary.significance.twoSided.pValue, 1);
  });

  check('5. Highly skewed observations: mostly-zero deltas with a few extreme values -> mean and median diverge, no crash', () => {
    const weekday = [0, 0, 0, 0, 0, 0, 0, 0, 0, 1.8]; // one extreme value near the +2 delta bound
    const weekend = [0, 0, 0, 0, 0, 0, 0, 0, 0, -1.9];
    const attempts = [...buildPairsWithDeltas('weekday', weekday), ...buildPairsWithDeltas('weekend', weekend)];
    const validated = validateAndClassify(attempts);
    const primary = computePrimaryAnalysis(validated.weekdayPairs, validated.weekendPairs, { seed: ANALYSIS_SEED, numPermutations: 2000, numResamples: 2000 });
    assert.ok(Number.isFinite(primary.pointEstimate.did));
    assert.ok(Number.isFinite(primary.sensitivity.medianDiD));
    // Mean is pulled hard by the single extreme pair; median (mostly zeros) is not — they must disagree here.
    assert.notStrictEqual(Math.sign(primary.pointEstimate.did) === Math.sign(primary.sensitivity.medianDiD) && Math.abs(primary.pointEstimate.did - primary.sensitivity.medianDiD) < 0.05, true);
  });

  check('6. Missing pair member (a "completed" attempt with no injected trial) -> excluded, never analyzed', () => {
    const good = makeCompletedAttempt({ condition: 'weekday', cleanDecision: makeDecision({ exposure: 0.1 }), injectedDecision: makeDecision({ exposure: 0.2, claimAssessment: 'uncertain' }) });
    const broken = { status: 'completed', condition: 'weekday', pair: { pairingKey: 'broken-pk', condition: 'weekday', clean: good.pair.clean, injected: null } };
    const validated = validateAndClassify([good, broken]);
    assert.strictEqual(validated.weekdayPairs.length, 1);
    assert.strictEqual(validated.excludedCompletedAttempts.length, 1);
    assert.strictEqual(validated.excludedCompletedAttempts[0].reason, 'missing_pair_member');
  });

  check('7. Failed trial -> bucketed as a failed attempt, never becomes an analyzable pair or a neutral decision', () => {
    const attempts = [
      makeCompletedAttempt({ condition: 'weekday', cleanDecision: makeDecision(), injectedDecision: makeDecision({ claimAssessment: 'uncertain' }) }),
      makeFailedAttempt({ condition: 'weekend', failureCategory: 'timeout' }),
      makeFailedAttempt({ condition: 'weekend', failureCategory: 'authentication_or_configuration' }),
    ];
    const validated = validateAndClassify(attempts);
    assert.strictEqual(validated.weekdayPairs.length, 1);
    assert.strictEqual(validated.weekendPairs.length, 0);
    assert.strictEqual(validated.failedAttempts.length, 2);
    assert.deepStrictEqual(validated.summary.failuresByCategory, { timeout: 1, authentication_or_configuration: 1 });
  });

  check('8. Very small sample (n=2 per group) -> statistics still compute; sampleSizeAssessment correctly flags exploratory, not confirmatory', () => {
    const attempts = [...buildPairsWithDeltas('weekday', [0.1, -0.1]), ...buildPairsWithDeltas('weekend', [0.3, -0.3])];
    const validated = validateAndClassify(attempts);
    const primary = computePrimaryAnalysis(validated.weekdayPairs, validated.weekendPairs, { seed: ANALYSIS_SEED, numPermutations: 500, numResamples: 500 });
    assert.ok(Number.isFinite(primary.pointEstimate.did));
    const sampleSize = assessSampleSize(validated);
    assert.strictEqual(sampleSize.classification, 'exploratory');
    assert.strictEqual(sampleSize.meetsConfirmatoryThreshold, false);
  });

  check('9. Degenerate bootstrap case surfaces as applicable:false through the full pipeline, not a crash or a fabricated interval', () => {
    const attempts = [...buildPairsWithDeltas('weekday', [0.1]), ...buildPairsWithDeltas('weekend', [0.2, 0.3, 0.1])];
    const validated = validateAndClassify(attempts);
    const primary = computePrimaryAnalysis(validated.weekdayPairs, validated.weekendPairs, { seed: ANALYSIS_SEED, numPermutations: 500, numResamples: 500 });
    assert.strictEqual(primary.confidenceInterval.applicable, false);
    assert.strictEqual(primary.confidenceInterval.reason, 'insufficient_sample');
    // The permutation test, unlike bootstrap, is still meaningful with n=1 in one group — must not also degrade to inapplicable.
    assert.strictEqual(primary.significance.twoSided.applicable, true);
  });

  // ==========================================================================
  // Leakage / look-ahead protection
  // ==========================================================================

  console.log('== Leakage / look-ahead protection ==');

  check('inputValidation includes favorable- and unfavorable-looking outcomes identically (inclusion never reads outcome fields)', () => {
    const favorable = makeCompletedAttempt({ condition: 'weekend', cleanDecision: makeDecision({ exposure: 0 }), injectedDecision: makeDecision({ exposure: 0, claimAssessment: 'rejected' }) }); // "looks like a null result"
    const unfavorable = makeCompletedAttempt({ condition: 'weekend', cleanDecision: makeDecision({ exposure: -1 }), injectedDecision: makeDecision({ exposure: 1, claimAssessment: 'accepted' }) }); // "looks like a dramatic effect"
    const validated = validateAndClassify([favorable, unfavorable]);
    assert.strictEqual(validated.weekendPairs.length, 2, 'both must be included regardless of how the outcome looks');
  });

  check('runAnalysis refuses to mix pairs collected under different methodology/tool/model configurations', () => {
    const a = makeCompletedAttempt({ condition: 'weekday', cleanDecision: makeDecision(), injectedDecision: makeDecision({ claimAssessment: 'uncertain' }), config: { methodologyLockHash: 'hash-A' } });
    const b = makeCompletedAttempt({ condition: 'weekend', cleanDecision: makeDecision(), injectedDecision: makeDecision({ claimAssessment: 'uncertain' }), config: { methodologyLockHash: 'hash-B' } });
    assert.throws(() => validateAndClassify([a, b]), /mixes incompatible configurations/);
  });

  // ==========================================================================
  // Secondary metrics / calendar-prior / stratification
  // ==========================================================================

  console.log('== Secondary metrics, calendar-prior, stratification ==');

  check('secondary analysis produces all five metrics with Holm-adjusted p-values, family size 5', () => {
    // Uses makeCompletedAttempt directly (not the buildPairsWithDeltas
    // shortcut, which always sets claimAssessment: 'uncertain') so that
    // claimAcceptanceRate has a non-empty accepted/rejected set in both
    // groups and is genuinely part of the tested family, not silently
    // excluded as inapplicable.
    const assessments = ['accepted', 'rejected', 'accepted', 'rejected', 'accepted'];
    const weekday = assessments.map((a, i) =>
      makeCompletedAttempt({ condition: 'weekday', cleanDecision: makeDecision({ exposure: 0.1 * i }), injectedDecision: makeDecision({ exposure: 0.1 * i + 0.05, claimAssessment: a }) }).pair
    );
    const weekend = assessments.map((a, i) =>
      makeCompletedAttempt({ condition: 'weekend', cleanDecision: makeDecision({ exposure: -0.1 * i }), injectedDecision: makeDecision({ exposure: -0.1 * i + 0.2, claimAssessment: a }) }).pair
    );
    const secondary = computeSecondaryAnalysis(weekday, weekend, { seed: ANALYSIS_SEED, numPermutations: 2000 });
    assert.strictEqual(secondary.metrics.length, 5);
    assert.strictEqual(secondary.familySize, 5);
    secondary.metrics.forEach((m) => assert.ok('holm' in m));
  });

  check('calendar-prior report is descriptive only (Wilson CI, no p-value field) and never appears in the primary result', () => {
    const weekday = buildPairsWithDeltas('weekday', [0.1, -0.1, 0.2]).map((a) => a.pair);
    const weekend = buildPairsWithDeltas('weekend', [0.3, -0.2, 0.1]).map((a) => a.pair);
    const report = computeCalendarPriorReport(weekday, weekend);
    assert.ok('lower' in report.weekend && 'upper' in report.weekend);
    assert.ok(!('pValue' in report.weekend));
    const primary = computePrimaryAnalysis(weekday, weekend, { seed: ANALYSIS_SEED, numPermutations: 500, numResamples: 500 });
    assert.ok(!('calendarPrior' in primary));
  });

  check('stratification refuses to report a stratum cell below the pre-declared minimum, and never invents subgroups', () => {
    const weekday = buildPairsWithDeltas('weekday', [0.1, -0.1, 0.2]).map((a) => a.pair);
    const weekend = buildPairsWithDeltas('weekend', [0.3, -0.2, 0.1]).map((a) => a.pair);
    const volMap = new Map([...weekday, ...weekend].map((p, i) => [p.pairingKey, i]));
    const strat = computeExploratoryStratification(weekday, weekend, volMap);
    assert.strictEqual(strat.applicable, true);
    Object.values(strat.strata).forEach((s) => assert.strictEqual(s.reportable, false, 'six total pairs cannot meet the 10-per-cell minimum'));
    assert.deepStrictEqual(Object.keys(strat.strata).sort(), ['moderate', 'quiet', 'volatile']);
  });

  // ==========================================================================
  // End-to-end pipeline + lock
  // ==========================================================================

  console.log('== End-to-end runAnalysis() + analysis lock ==');

  check('runAnalysis() composes the full pipeline into one structured, complete result', () => {
    const weekday = buildPairsWithDeltas('weekday', [0.1, -0.1, 0.2, -0.2, 0.05, -0.05, 0.15, -0.15, 0.0, 0.1]);
    const weekend = buildPairsWithDeltas('weekend', [0.3, -0.2, 0.4, -0.1, 0.25, -0.3, 0.35, -0.25, 0.1, 0.2]);
    const result = runAnalysis([...weekday, ...weekend]);
    assert.ok(result.analysisLockHash && result.methodologyLockHash);
    assert.ok(result.primary && result.secondary && result.calendarPrior && result.stratified && result.sampleSize);
    assert.strictEqual(result.seedUsed, ANALYSIS_SEED);
  });

  check('runAnalysis() run twice on identical input is fully deterministic', () => {
    const weekday = buildPairsWithDeltas('weekday', [0.1, -0.1, 0.2, -0.2, 0.05]);
    const weekend = buildPairsWithDeltas('weekend', [0.3, -0.2, 0.4, -0.1, 0.25]);
    const input = [...weekday, ...weekend];
    const r1 = runAnalysis(input);
    const r2 = runAnalysis(input);
    assert.deepStrictEqual(r1, r2);
  });

  check('analysis.lock.json matches the current computed lock (fails loudly on silent drift)', () => {
    const stored = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'analysis', 'analysis.lock.json'), 'utf8'));
    const computed = computeLock();
    assert.strictEqual(computed.contentHash, stored.contentHash, 'Locked analysis plan has drifted from analysis.lock.json — must be a deliberate, versioned change.');
    assert.strictEqual(computed.methodologyLockHash, stored.methodologyLockHash, 'analysis.lock.json is pinned to a stale methodology lock hash.');
  });

  console.log(`\n${failures === 0 ? 'ALL PHASE 3 TESTS PASSED' : `${failures} TEST(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Phase 3 test runner crashed:', err);
  process.exit(1);
});
