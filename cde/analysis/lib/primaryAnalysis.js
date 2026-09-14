'use strict';
/**
 * Primary estimand computation — ANALYSIS_PLAN.md §1-§6, §12. Wraps
 * cde/lib/metrics.js's already-locked injectedDelta()/did() formulas
 * (never redefines them) with the significance test, CI, and sensitivity
 * check Phase 0 deliberately left unspecified.
 */

const { injectedDelta, did } = require('../../lib/metrics');
const { permutationTest, bootstrapCI, meanDiff, medianDiff } = require('./resampling');

/** Extracts the exposureDelta array for one condition's set of pairs. */
function deltasFor(pairs) {
  return pairs.map((pair) => injectedDelta(pair.clean.decision, pair.injected.decision));
}

/**
 * @param {object[]} weekdayPairs validated, analyzable pairs (cde/analysis/lib/inputValidation.js output)
 * @param {object[]} weekendPairs
 * @param {object} opts { seed, confidenceLevel, alpha, numPermutations, numResamples }
 */
function computePrimaryAnalysis(weekdayPairs, weekendPairs, opts) {
  const { seed, confidenceLevel = 0.95, alpha = 0.05, numPermutations = 10000, numResamples = 10000 } = opts;
  if (seed === undefined || seed === null) throw new Error('computePrimaryAnalysis requires an explicit seed.');

  const weekdayDeltaRecords = deltasFor(weekdayPairs);
  const weekendDeltaRecords = deltasFor(weekendPairs);
  const weekdayExposureDeltas = weekdayDeltaRecords.map((d) => d.exposureDelta);
  const weekendExposureDeltas = weekendDeltaRecords.map((d) => d.exposureDelta);

  // The already-locked point estimate, unchanged — cde/lib/metrics.js:did().
  const pointEstimate = did(weekdayDeltaRecords, weekendDeltaRecords);

  const twoSided = permutationTest(weekdayExposureDeltas, weekendExposureDeltas, { statistic: meanDiff, numPermutations, seed, twoSided: true });
  const oneSidedSecondary = permutationTest(weekdayExposureDeltas, weekendExposureDeltas, {
    statistic: meanDiff,
    numPermutations,
    seed, // same seed as the two-sided test — this is a re-labeling of the same permutation distribution's tail, not a second independent test
    twoSided: false,
  });
  const ci = bootstrapCI(weekdayExposureDeltas, weekendExposureDeltas, { statistic: meanDiff, numResamples, seed, confidenceLevel });

  const sensitivityMedian = weekdayExposureDeltas.length > 0 && weekendExposureDeltas.length > 0 ? medianDiff(weekendExposureDeltas, weekdayExposureDeltas) : null;

  return {
    estimand: 'DiD(exposureDelta) = E[exposureDelta | weekend] - E[exposureDelta | weekday]',
    pointEstimate,
    significance: {
      alpha,
      twoSided,
      oneSidedSecondary,
      note: 'twoSided is the primary, pre-registered test. oneSidedSecondary is an explicitly labeled secondary re-read of the same permutation distribution, never a substitute for the two-sided result.',
    },
    confidenceInterval: ci,
    sensitivity: {
      medianDiD: sensitivityMedian,
      note: 'Always computed and reported; never used to select between the mean- and median-based results.',
    },
    componentMeans: {
      weekdayInjectionEffect: pointEstimate.weekdayMeanExposureDelta,
      weekendInjectionEffect: pointEstimate.weekendMeanExposureDelta,
      note: 'The two main-effect components of the interaction — reported for transparency, neither is the primary estimand on its own (see ANALYSIS_PLAN.md §1).',
    },
  };
}

module.exports = { deltasFor, computePrimaryAnalysis };
