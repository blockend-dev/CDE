'use strict';
/**
 * Computes the analysis-plan lock — a content hash over every
 * experimentally load-bearing statistical decision in ANALYSIS_PLAN.md.
 * Mirrors cde/lib/methodologyLock.js exactly in spirit: analysis.lock.json
 * stores the last-approved value; a test compares the two on every run.
 *
 * Also embeds the CURRENT methodologyLockHash, so any research result can
 * be cited as methodologyLockHash + analysisLockHash together (per the
 * brief's explicit requirement) and a change to the underlying methodology
 * is visible here too, not just in cde/methodology.lock.json.
 */

const { contentHash } = require('../../lib/hash');
const { computeLock: computeMethodologyLock } = require('../../lib/methodologyLock');
const { MIN_COMPLETED_PAIRS_PER_CONDITION, MAX_ATTEMPTED_PAIRS } = require('./sampleSizeAssessment');
const { MIN_OBSERVATIONS_PER_CELL, STRATUM_NAMES } = require('./stratification');

const ANALYSIS_PLAN_VERSION = '0.1.0-phase3';
const ANALYSIS_SEED = 424242; // fixed default seed for permutation/bootstrap — see ANALYSIS_PLAN.md §4

const SECONDARY_METRIC_METHODS = Object.freeze({
  meanAbsExposureDelta: 'permutation_test_mean_diff',
  meanConfidenceDelta: 'permutation_test_mean_diff',
  verificationDivergence: 'permutation_test_mean_diff',
  directionalFlipRate: 'fisher_exact_two_sided',
  claimAcceptanceRate: 'fisher_exact_two_sided',
});

function computeLock() {
  const methodologyLock = computeMethodologyLock();

  const lockedInputs = {
    version: ANALYSIS_PLAN_VERSION,
    methodologyLockHash: methodologyLock.contentHash,
    primaryEstimand: 'DiD(exposureDelta) = E[exposureDelta|weekend] - E[exposureDelta|weekday]',
    primaryOutcome: 'exposureDelta',
    primaryStatisticalMethod: 'two_sided_permutation_test_mean_diff',
    primarySecondarySidedTest: 'one_sided_permutation_test_mean_diff',
    confidenceIntervalMethod: 'stratified_percentile_bootstrap',
    confidenceLevel: 0.95,
    alpha: 0.05,
    numPermutations: 10000,
    numBootstrapResamples: 10000,
    analysisSeed: ANALYSIS_SEED,
    minCompletedPairsPerCondition: MIN_COMPLETED_PAIRS_PER_CONDITION,
    maxAttemptedPairs: MAX_ATTEMPTED_PAIRS,
    failurePolicy: 'pair_level_all_or_nothing_exclude_incomplete',
    retryPolicy: 'retries_within_one_trial_never_a_new_sample',
    secondaryMetricMethods: SECONDARY_METRIC_METHODS,
    multipleComparisonPolicy: 'holm_bonferroni_family_of_5_secondary_metrics',
    calendarPriorPolicy: 'descriptive_wilson_ci_only_no_adjustment',
    stratificationPolicy: 'exploratory_only_tercile_independent_volatility',
    minObservationsPerStratumCell: MIN_OBSERVATIONS_PER_CELL,
    stratumNames: STRATUM_NAMES,
    outlierPolicy: 'retain_all_no_transform_median_sensitivity_always_reported',
    modelScopePolicy: 'single_fixed_provider_model_config_per_analysis_version',
  };

  return { ...lockedInputs, contentHash: contentHash(lockedInputs) };
}

module.exports = { ANALYSIS_PLAN_VERSION, ANALYSIS_SEED, computeLock };
