'use strict';
/**
 * Secondary metrics — ANALYSIS_PLAN.md §9. Formalizes each of the five
 * secondary metrics from cde/lib/metrics.js as a weekday-vs-weekend group
 * comparison, using the method justified per-metric in the plan, then
 * applies Holm-Bonferroni across exactly that family of five.
 */

const { injectedDelta, verificationDivergence, calendarPriorFlag } = require('../../lib/metrics');
const { permutationTest, meanDiff } = require('./resampling');
const { fisherExactTwoSided, wilsonScoreInterval95, holmBonferroni } = require('./proportions');

function countBy(items, predicate) {
  return items.filter(predicate).length;
}

/**
 * @param {object[]} weekdayPairs
 * @param {object[]} weekendPairs
 * @param {object} opts { seed, numPermutations, alpha }
 */
function computeSecondaryAnalysis(weekdayPairs, weekendPairs, opts) {
  const { seed, numPermutations = 10000, alpha = 0.05 } = opts;
  if (seed === undefined || seed === null) throw new Error('computeSecondaryAnalysis requires an explicit seed.');

  const weekdayDeltas = weekdayPairs.map((p) => injectedDelta(p.clean.decision, p.injected.decision));
  const weekendDeltas = weekendPairs.map((p) => injectedDelta(p.clean.decision, p.injected.decision));

  // --- meanAbsExposureDelta: permutation test on |exposureDelta| ---
  const meanAbsExposureDelta = permutationTest(
    weekdayDeltas.map((d) => Math.abs(d.exposureDelta)),
    weekendDeltas.map((d) => Math.abs(d.exposureDelta)),
    { statistic: meanDiff, numPermutations, seed, twoSided: true }
  );

  // --- meanConfidenceDelta: permutation test on confidenceDelta ---
  const meanConfidenceDelta = permutationTest(
    weekdayDeltas.map((d) => d.confidenceDelta),
    weekendDeltas.map((d) => d.confidenceDelta),
    { statistic: meanDiff, numPermutations, seed, twoSided: true }
  );

  // --- verificationDivergence: permutation test on the per-pair integer divergence ---
  const weekdayVerifDiv = weekdayPairs.map((p) => verificationDivergence(p.clean.decision, p.injected.decision));
  const weekendVerifDiv = weekendPairs.map((p) => verificationDivergence(p.clean.decision, p.injected.decision));
  const verificationDivergenceTest = permutationTest(weekdayVerifDiv, weekendVerifDiv, { statistic: meanDiff, numPermutations, seed, twoSided: true });

  // --- directionalFlipRate: Fisher's exact on flip/no-flip counts ---
  const weekdayFlips = countBy(weekdayDeltas, (d) => d.directionFlip);
  const weekendFlips = countBy(weekendDeltas, (d) => d.directionFlip);
  const directionalFlipRateTest =
    weekdayDeltas.length > 0 && weekendDeltas.length > 0
      ? fisherExactTwoSided(weekdayFlips, weekdayDeltas.length - weekdayFlips, weekendFlips, weekendDeltas.length - weekendFlips)
      : { applicable: false, reason: 'empty_group' };

  // --- claimAcceptanceRate: Fisher's exact on accepted/rejected counts (uncertain excluded, matching cde/lib/metrics.js's own filter) ---
  const scoredAssessment = (pairs) => pairs.map((p) => p.injected.decision.claimAssessment).filter((a) => a === 'accepted' || a === 'rejected');
  const weekdayScored = scoredAssessment(weekdayPairs);
  const weekendScored = scoredAssessment(weekendPairs);
  const weekdayAccepted = countBy(weekdayScored, (a) => a === 'accepted');
  const weekendAccepted = countBy(weekendScored, (a) => a === 'accepted');
  const claimAcceptanceRateTest =
    weekdayScored.length > 0 && weekendScored.length > 0
      ? fisherExactTwoSided(weekdayAccepted, weekdayScored.length - weekdayAccepted, weekendAccepted, weekendScored.length - weekendAccepted)
      : { applicable: false, reason: 'empty_scored_set' };

  const family = [
    { name: 'meanAbsExposureDelta', result: meanAbsExposureDelta },
    { name: 'meanConfidenceDelta', result: meanConfidenceDelta },
    { name: 'verificationDivergence', result: verificationDivergenceTest },
    { name: 'directionalFlipRate', result: directionalFlipRateTest },
    { name: 'claimAcceptanceRate', result: claimAcceptanceRateTest },
  ];

  const applicableIndices = family.map((f, i) => (f.result.applicable ? i : -1)).filter((i) => i >= 0);
  const rawPValues = applicableIndices.map((i) => family[i].result.pValue);
  const holmResults = holmBonferroni(rawPValues, alpha);

  const metrics = family.map((f, i) => {
    const holmIdx = applicableIndices.indexOf(i);
    return {
      name: f.name,
      result: f.result,
      holm: holmIdx >= 0 ? holmResults[holmIdx] : { applicable: false, reason: 'not_applicable_to_family' },
    };
  });

  return {
    familyAlpha: alpha,
    familySize: applicableIndices.length,
    metrics,
    descriptive: {
      weekdayDirectionalFlipRate: weekdayDeltas.length ? weekdayFlips / weekdayDeltas.length : null,
      weekendDirectionalFlipRate: weekendDeltas.length ? weekendFlips / weekendDeltas.length : null,
      weekdayClaimAcceptanceRate: weekdayScored.length ? weekdayAccepted / weekdayScored.length : null,
      weekendClaimAcceptanceRate: weekendScored.length ? weekendAccepted / weekendScored.length : null,
    },
  };
}

/**
 * Calendar-prior descriptive report — ANALYSIS_PLAN.md §10. One-sample
 * proportion (Wilson CI) only; no group comparison, no p-value, never
 * used to adjust the primary estimate.
 */
function computeCalendarPriorReport(weekdayPairs, weekendPairs) {
  const flagAll = (pairs) => pairs.flatMap((p) => [p.clean.decision, p.injected.decision]).map((d) => calendarPriorFlag(d));

  const weekendFlags = flagAll(weekendPairs);
  const weekdayFlags = flagAll(weekdayPairs);
  const weekendDriven = countBy(weekendFlags, (f) => f.likelyCalendarPriorDriven);
  const weekdayDriven = countBy(weekdayFlags, (f) => f.likelyCalendarPriorDriven);

  return {
    weekend: weekendFlags.length ? wilsonScoreInterval95(weekendDriven, weekendFlags.length) : { applicable: false, reason: 'empty_group' },
    weekday: weekdayFlags.length ? wilsonScoreInterval95(weekdayDriven, weekdayFlags.length) : { applicable: false, reason: 'empty_group' },
    note: 'Descriptive only. Not a group comparison, not a significance test, not used to adjust the primary DiD — see ANALYSIS_PLAN.md §10 for the explicit non-separability limitation.',
  };
}

module.exports = { computeSecondaryAnalysis, computeCalendarPriorReport };
