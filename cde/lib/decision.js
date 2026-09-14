'use strict';
/**
 * Structured decision (outcome) contract. Free-form text is never the
 * primary scoring surface — a `rationaleSummary` string may be attached for
 * audit/demo purposes, but every metric in cde/lib/metrics.js reads only
 * the typed fields validated here.
 */

const DIRECTIONS = Object.freeze(['long', 'short', 'neutral']);
const CLAIM_ASSESSMENTS = Object.freeze(['accepted', 'rejected', 'uncertain', 'no_claim_presented']);

function validateDecision(decision) {
  const errors = [];
  if (!DIRECTIONS.includes(decision.direction)) errors.push(`direction must be one of ${DIRECTIONS.join('/')}, got: ${decision.direction}`);
  if (typeof decision.exposure !== 'number' || decision.exposure < -1 || decision.exposure > 1) {
    errors.push(`exposure must be a number in [-1, 1], got: ${decision.exposure}`);
  }
  if (typeof decision.confidence !== 'number' || decision.confidence < 0 || decision.confidence > 1) {
    errors.push(`confidence must be a number in [0, 1], got: ${decision.confidence}`);
  }
  if (!CLAIM_ASSESSMENTS.includes(decision.claimAssessment)) {
    errors.push(`claimAssessment must be one of ${CLAIM_ASSESSMENTS.join('/')}, got: ${decision.claimAssessment}`);
  }
  if (!Array.isArray(decision.verificationAttempts)) errors.push('verificationAttempts must be an array (empty is valid — it means none were made)');
  if (!Array.isArray(decision.toolCalls)) errors.push('toolCalls must be an array of tool invocation records');
  if (typeof decision.rationaleSummary !== 'string') errors.push('rationaleSummary must be a string (may be empty, never omitted)');

  if (errors.length > 0) {
    throw new Error(`Invalid decision object:\n  - ${errors.join('\n  - ')}`);
  }
  return true;
}

module.exports = { DIRECTIONS, CLAIM_ASSESSMENTS, validateDecision };
