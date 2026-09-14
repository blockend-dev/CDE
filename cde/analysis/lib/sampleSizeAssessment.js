'use strict';
/**
 * Sample-size / stopping-rule assessment — ANALYSIS_PLAN.md §6. A pure
 * function of already-collected counts; does not itself decide when to
 * stop collecting (that happens during Phase 4 data collection, driven by
 * counts alone, never by outcome values — see §6/§17). This module only
 * classifies a finished batch as confirmatory or exploratory for
 * reporting purposes.
 */

const MIN_COMPLETED_PAIRS_PER_CONDITION = 20;
const MAX_ATTEMPTED_PAIRS = 120;

function assessSampleSize({ summary }) {
  const meetsConfirmatoryThreshold = summary.completedWeekday >= MIN_COMPLETED_PAIRS_PER_CONDITION && summary.completedWeekend >= MIN_COMPLETED_PAIRS_PER_CONDITION;
  const attemptedPairs = summary.completedWeekday + summary.completedWeekend + summary.failed;
  return {
    minCompletedPairsPerCondition: MIN_COMPLETED_PAIRS_PER_CONDITION,
    maxAttemptedPairs: MAX_ATTEMPTED_PAIRS,
    completedWeekday: summary.completedWeekday,
    completedWeekend: summary.completedWeekend,
    attemptedPairs,
    meetsConfirmatoryThreshold,
    exhaustedAttemptBudget: attemptedPairs >= MAX_ATTEMPTED_PAIRS,
    classification: meetsConfirmatoryThreshold ? 'confirmatory' : 'exploratory',
  };
}

module.exports = { assessSampleSize, MIN_COMPLETED_PAIRS_PER_CONDITION, MAX_ATTEMPTED_PAIRS };
