'use strict';
/**
 * Generic two-sample resampling procedures: permutation test (primary
 * significance test, ANALYSIS_PLAN.md §3) and stratified percentile
 * bootstrap (primary CI method, §4). Both operate on the correct
 * experimental unit — one numeric value per PAIR (already a within-pair
 * contrast, e.g. exposureDelta) — never on individual trials.
 *
 * Pure, deterministic given a seed, no I/O.
 */

const { mulberry32, shuffleInPlace, resampleWithReplacement } = require('./prng');

function mean(arr) {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function median(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function meanDiff(groupB, groupA) {
  return mean(groupB) - mean(groupA);
}

function medianDiff(groupB, groupA) {
  return median(groupB) - median(groupA);
}

/**
 * Two-sample permutation test on a difference-of-summary-statistic
 * (default: mean difference, groupB - groupA, matching cde/lib/metrics.js
 * did()'s weekend-minus-weekday sign convention). Permutes CONDITION LABELS
 * across the combined pool of pair-level values — never splits a value
 * that belongs to one pair into pieces.
 *
 * @param {number[]} groupA e.g. weekday deltas
 * @param {number[]} groupB e.g. weekend deltas
 * @param {object} opts { statistic, numPermutations, seed, twoSided }
 */
function permutationTest(groupA, groupB, opts = {}) {
  const { statistic = meanDiff, numPermutations = 10000, seed, twoSided = true } = opts;
  if (seed === undefined || seed === null) throw new Error('permutationTest requires an explicit seed for determinism.');
  if (groupA.length === 0 || groupB.length === 0) {
    return { applicable: false, reason: 'empty_group', groupASize: groupA.length, groupBSize: groupB.length };
  }

  const observed = statistic(groupB, groupA);
  const nA = groupA.length;
  const nB = groupB.length;
  const combined = groupA.concat(groupB);
  const rng = mulberry32(seed);

  let asOrMoreExtreme = 0;
  for (let p = 0; p < numPermutations; p++) {
    shuffleInPlace(combined, rng);
    const permA = combined.slice(0, nA);
    const permB = combined.slice(nA, nA + nB);
    const stat = statistic(permB, permA);
    const extreme = twoSided ? Math.abs(stat) >= Math.abs(observed) - 1e-12 : stat >= observed - 1e-12;
    if (extreme) asOrMoreExtreme += 1;
  }
  // +1/+1 smoothing (standard practice) — a permutation p-value of exactly
  // 0 is never reported, since it would falsely imply infinite certainty.
  const pValue = (asOrMoreExtreme + 1) / (numPermutations + 1);

  return {
    applicable: true,
    observedStatistic: observed,
    pValue,
    twoSided,
    numPermutations,
    seed,
    groupASize: nA,
    groupBSize: nB,
  };
}

/**
 * Stratified percentile bootstrap CI for the same statistic. Resamples
 * WITH replacement, separately within groupA and groupB (never mixing
 * them), each resample the same size as its own group.
 */
function bootstrapCI(groupA, groupB, opts = {}) {
  const { statistic = meanDiff, numResamples = 10000, seed, confidenceLevel = 0.95 } = opts;
  if (seed === undefined || seed === null) throw new Error('bootstrapCI requires an explicit seed for determinism.');
  if (groupA.length < 2 || groupB.length < 2) {
    return { applicable: false, reason: 'insufficient_sample', groupASize: groupA.length, groupBSize: groupB.length };
  }

  const rng = mulberry32(seed);
  const stats = new Array(numResamples);
  for (let i = 0; i < numResamples; i++) {
    const resampledA = resampleWithReplacement(groupA, rng);
    const resampledB = resampleWithReplacement(groupB, rng);
    stats[i] = statistic(resampledB, resampledA);
  }
  stats.sort((a, b) => a - b);
  const alpha = 1 - confidenceLevel;
  const lowerIdx = Math.max(0, Math.floor((alpha / 2) * numResamples));
  const upperIdx = Math.min(numResamples - 1, Math.ceil((1 - alpha / 2) * numResamples) - 1);

  return {
    applicable: true,
    confidenceLevel,
    lower: stats[lowerIdx],
    upper: stats[upperIdx],
    numResamples,
    seed,
    groupASize: groupA.length,
    groupBSize: groupB.length,
  };
}

module.exports = { mean, median, meanDiff, medianDiff, permutationTest, bootstrapCI };
