'use strict';
/**
 * Top-level analysis pipeline — pure composition of the modules above.
 * No network calls, no model calls, no mutable global state, no hidden
 * configuration: every parameter that affects the result is either passed
 * in explicitly or read from the frozen analysis lock.
 *
 *   analysis input (raw attempt outcomes)
 *   -> validation / classification            (inputValidation.js)
 *   -> primary estimator + CI + sensitivity   (primaryAnalysis.js)
 *   -> secondary metrics + multiple-comparison (secondaryAnalysis.js)
 *   -> calendar-prior descriptive report       (secondaryAnalysis.js)
 *   -> exploratory stratification              (stratification.js)
 *   -> sample-size / stopping-rule assessment  (sampleSizeAssessment.js)
 *   -> one structured, deterministically-serializable result
 */

const { validateAndClassify } = require('./inputValidation');
const { computePrimaryAnalysis } = require('./primaryAnalysis');
const { computeSecondaryAnalysis, computeCalendarPriorReport } = require('./secondaryAnalysis');
const { computeExploratoryStratification } = require('./stratification');
const { assessSampleSize } = require('./sampleSizeAssessment');
const { computeLock, ANALYSIS_SEED } = require('./analysisLock');

/**
 * @param {Array} rawAttemptOutcomes buildPairSafely()-shaped outcomes (completed + failed)
 * @param {object} [opts]
 * @param {number} [opts.seed] overrides the locked default analysis seed — only for testing; a real research report must use the locked default
 * @param {Map<string, number>} [opts.volatilityByPairingKey] optional, for exploratory stratification only
 */
function runAnalysis(rawAttemptOutcomes, opts = {}) {
  const lock = computeLock();
  const seed = opts.seed !== undefined ? opts.seed : ANALYSIS_SEED;
  const volatilityByPairingKey = opts.volatilityByPairingKey || new Map();

  const validated = validateAndClassify(rawAttemptOutcomes);
  const sampleSize = assessSampleSize(validated);

  const primary = computePrimaryAnalysis(validated.weekdayPairs, validated.weekendPairs, {
    seed,
    confidenceLevel: lock.confidenceLevel,
    alpha: lock.alpha,
    numPermutations: lock.numPermutations,
    numResamples: lock.numBootstrapResamples,
  });

  const secondary = computeSecondaryAnalysis(validated.weekdayPairs, validated.weekendPairs, {
    seed,
    numPermutations: lock.numPermutations,
    alpha: lock.alpha,
  });

  const calendarPrior = computeCalendarPriorReport(validated.weekdayPairs, validated.weekendPairs);

  const stratified = computeExploratoryStratification(validated.weekdayPairs, validated.weekendPairs, volatilityByPairingKey);

  return {
    analysisLockHash: lock.contentHash,
    methodologyLockHash: lock.methodologyLockHash,
    analysisPlanVersion: lock.version,
    seedUsed: seed,
    sampleSize,
    exclusions: {
      summary: validated.summary,
      failedAttempts: validated.failedAttempts,
      excludedCompletedAttempts: validated.excludedCompletedAttempts,
    },
    primary,
    secondary,
    calendarPrior,
    stratified,
  };
}

module.exports = { runAnalysis };
