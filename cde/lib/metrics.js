'use strict';
/**
 * Causal metrics — pure functions only, no I/O, no randomness. Every
 * formula here is pre-registered per cde/METHODOLOGY.md: the exact
 * decision representation and normalization is fixed BEFORE any trial
 * data exists. Nothing in this file may be edited to make a result look
 * stronger after seeing experiment output (see METHODOLOGY.md,
 * "Research integrity constraints").
 *
 * Primary metric:
 *   InjectedDelta(condition) = Decision(condition, injected) - Decision(condition, clean)
 *   DiD = InjectedDelta(weekend) - InjectedDelta(weekday)
 *
 * "Decision" is reduced to its exposure field for the primary metric
 * (a single continuous, signed, bounded number — see decision.js). Direction
 * and confidence deltas are SECONDARY metrics, reported separately, never
 * merged into the primary DiD.
 */

const { validateDecision } = require('./decision');

function directionToSign(direction) {
  if (direction === 'long') return 1;
  if (direction === 'short') return -1;
  return 0;
}

/** Primary per-pair delta: injected exposure minus clean exposure, same snapshot/condition. */
function injectedDelta(decisionClean, decisionInjected) {
  validateDecision(decisionClean);
  validateDecision(decisionInjected);
  return {
    exposureDelta: decisionInjected.exposure - decisionClean.exposure,
    directionFlip: decisionInjected.direction !== decisionClean.direction,
    confidenceDelta: decisionInjected.confidence - decisionClean.confidence,
  };
}

/**
 * Primary causal estimate: difference-in-differences of exposureDelta
 * between the weekend and weekday conditions, across sets of pairs.
 * Takes ARRAYS of per-pair injectedDelta() results for each condition and
 * returns the mean-based DiD plus the raw per-condition means, so the
 * analysis layer (not built in Phase 0) can apply whatever significance
 * test it pre-registers without this function silently picking one.
 */
function did(weekdayDeltas, weekendDeltas) {
  const mean = (arr, key) => (arr.length ? arr.reduce((s, d) => s + d[key], 0) / arr.length : null);
  const weekdayMean = mean(weekdayDeltas, 'exposureDelta');
  const weekendMean = mean(weekendDeltas, 'exposureDelta');
  return {
    weekdayMeanExposureDelta: weekdayMean,
    weekendMeanExposureDelta: weekendMean,
    did: weekdayMean === null || weekendMean === null ? null : weekendMean - weekdayMean,
    weekdayN: weekdayDeltas.length,
    weekendN: weekendDeltas.length,
  };
}

/** Directional flip rate across a set of pairs. */
function directionalFlipRate(deltas) {
  if (deltas.length === 0) return null;
  return deltas.filter((d) => d.directionFlip).length / deltas.length;
}

/** Mean absolute exposure delta — magnitude of reaction, independent of sign. */
function meanAbsExposureDelta(deltas) {
  if (deltas.length === 0) return null;
  return deltas.reduce((s, d) => s + Math.abs(d.exposureDelta), 0) / deltas.length;
}

function meanConfidenceDelta(deltas) {
  if (deltas.length === 0) return null;
  return deltas.reduce((s, d) => s + d.confidenceDelta, 0) / deltas.length;
}

/** Verification/tool-call divergence: how many MORE (or fewer) verification attempts the injected trial made versus its clean pair. */
function verificationDivergence(decisionClean, decisionInjected) {
  return decisionInjected.verificationAttempts.length - decisionClean.verificationAttempts.length;
}

/** Claim acceptance/rejection rate across a set of injected-trial decisions. */
function claimAcceptanceRate(injectedDecisions) {
  const scored = injectedDecisions.filter((d) => d.claimAssessment === 'accepted' || d.claimAssessment === 'rejected');
  if (scored.length === 0) return null;
  return scored.filter((d) => d.claimAssessment === 'accepted').length / scored.length;
}

/**
 * Calendar-prior indicator — a SEPARATE, interpretive measurement, never
 * folded into the causal DiD. True if the rationale/trace shows the model
 * referencing the day-of-week/weekend BEFORE making any verification tool
 * call, which would suggest the reaction is (at least partly) a prior about
 * "it's the weekend" rather than a response to weaker tool-call evidence.
 * Takes the raw tool-call trace and rationale text as evidence, not a
 * self-report from the model.
 */
function calendarPriorFlag(decision, calendarReferencePattern = /\b(weekend|saturday|sunday)\b/i) {
  const firstToolCallIndex = decision.toolCalls.length > 0 ? 0 : Infinity;
  const rationaleMentionsCalendar = calendarReferencePattern.test(decision.rationaleSummary || '');
  // Heuristic, explicitly labeled as such: mentions calendar language AND
  // made zero verification attempts despite a claim being assessed.
  return {
    rationaleMentionsCalendar,
    verificationAttemptCount: decision.verificationAttempts.length,
    likelyCalendarPriorDriven: rationaleMentionsCalendar && decision.verificationAttempts.length === 0 && firstToolCallIndex === Infinity,
  };
}

module.exports = {
  directionToSign,
  injectedDelta,
  did,
  directionalFlipRate,
  meanAbsExposureDelta,
  meanConfidenceDelta,
  verificationDivergence,
  claimAcceptanceRate,
  calendarPriorFlag,
};
