'use strict';
/**
 * Classifies raw attempt outcomes (the exact shape
 * cde/phase2/runRealModelExperiment.js: buildPairSafely() already returns:
 * {status: 'completed', condition, pair} | {status: 'failed', condition,
 * failureCategory, message, details}) into analyzable pairs vs. excluded/
 * failed attempts, per ANALYSIS_PLAN.md §7/§15.
 *
 * LEAKAGE PROTECTION: this module reads ONLY `status`, `condition`, and
 * configuration-consistency fields (methodologyLockHash, toolManifestHash,
 * modelConfigHash). It never reads `exposure`, `direction`, `confidence`,
 * or any other outcome field to decide inclusion — verified directly in
 * cde/test/phase3.test.js with a synthetic fixture where favorable- and
 * unfavorable-looking outcomes are included identically.
 */

const { CONDITIONS } = require('../../lib/conditions');

function requireConfigField(pair, field) {
  const clean = pair.clean && pair.clean[field];
  const injected = pair.injected && pair.injected[field];
  if (clean === undefined || injected === undefined) return { ok: false, reason: `missing_${field}` };
  if (clean !== injected) return { ok: false, reason: `inconsistent_${field}_within_pair` };
  return { ok: true, value: clean };
}

/**
 * @param {Array} rawAttempts array of buildPairSafely()-shaped outcomes
 * @returns {{weekdayPairs, weekendPairs, failedAttempts, excludedCompletedAttempts, summary}}
 */
function validateAndClassify(rawAttempts) {
  const weekdayPairs = [];
  const weekendPairs = [];
  const failedAttempts = [];
  const excludedCompletedAttempts = []; // shape-valid failures caught defensively, never silently dropped
  let referenceConfig = null; // { methodologyLockHash, toolManifestHash, modelConfigHash } — must match across the whole batch

  for (const attempt of rawAttempts) {
    if (!attempt || (attempt.status !== 'completed' && attempt.status !== 'failed')) {
      excludedCompletedAttempts.push({ reason: 'malformed_attempt_shape', attempt });
      continue;
    }

    if (attempt.status === 'failed') {
      failedAttempts.push({
        condition: attempt.condition || null,
        failureCategory: attempt.failureCategory || 'unknown',
        message: attempt.message || null,
      });
      continue;
    }

    // status === 'completed' from here on.
    const pair = attempt.pair;
    if (!pair || !pair.clean || !pair.injected) {
      excludedCompletedAttempts.push({ reason: 'missing_pair_member', attempt });
      continue;
    }
    if (pair.clean.claimStatus !== 'clean' || pair.injected.claimStatus !== 'injected') {
      excludedCompletedAttempts.push({ reason: 'claim_status_mismatch', attempt });
      continue;
    }
    if (pair.clean.condition !== pair.injected.condition) {
      excludedCompletedAttempts.push({ reason: 'condition_mismatch_within_pair', attempt });
      continue;
    }
    if (![CONDITIONS.WEEKDAY, CONDITIONS.WEEKEND].includes(pair.clean.condition)) {
      excludedCompletedAttempts.push({ reason: 'invalid_condition', attempt });
      continue;
    }

    const configChecks = ['methodologyLockHash', 'toolManifestHash', 'modelConfigHash'].map((f) => ({ field: f, ...requireConfigField(pair, f) }));
    const badConfig = configChecks.find((c) => !c.ok);
    if (badConfig) {
      excludedCompletedAttempts.push({ reason: badConfig.reason, attempt });
      continue;
    }

    const thisConfig = Object.fromEntries(configChecks.map((c) => [c.field, c.value]));
    if (referenceConfig === null) {
      referenceConfig = thisConfig;
    } else {
      const mismatchField = Object.keys(referenceConfig).find((f) => referenceConfig[f] !== thisConfig[f]);
      if (mismatchField) {
        throw new Error(
          `Input batch mixes incompatible configurations on "${mismatchField}" ` +
            `(expected "${referenceConfig[mismatchField]}", got "${thisConfig[mismatchField]}"). ` +
            'Refusing to analyze pairs collected under different methodology/tool-manifest/model configurations together.'
        );
      }
    }

    (pair.clean.condition === CONDITIONS.WEEKEND ? weekendPairs : weekdayPairs).push(pair);
  }

  return {
    weekdayPairs,
    weekendPairs,
    failedAttempts,
    excludedCompletedAttempts,
    referenceConfig,
    summary: {
      totalAttempted: rawAttempts.length,
      completedWeekday: weekdayPairs.length,
      completedWeekend: weekendPairs.length,
      failed: failedAttempts.length,
      excludedCompleted: excludedCompletedAttempts.length,
      failuresByCategory: failedAttempts.reduce((acc, f) => {
        acc[f.failureCategory] = (acc[f.failureCategory] || 0) + 1;
        return acc;
      }, {}),
    },
  };
}

module.exports = { validateAndClassify };
