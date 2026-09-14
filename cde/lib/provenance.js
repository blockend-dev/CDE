'use strict';
/**
 * Provenance contract. Every experimental artifact (snapshot, trial,
 * result) must be able to answer, without inference: where did this market
 * observation come from, when was it captured, was it live or replayed,
 * which endpoint produced it, which condition/snapshot/claim/model it
 * represents. validateProvenance() is the single mechanical check for
 * "no undocumented synthetic market evidence."
 */

const REQUIRED_PROVENANCE_FIELDS = Object.freeze([
  'bitgetEndpoint',
  'capturedAtUtc',
  'isLive',
  'condition',
  'snapshotId',
  'pairingKey',
  'trialKey',
  'claimFixtureId', // null is a valid, explicit value for Clean trials — must be present, not omitted
  'modelConfigHash',
]);

function validateProvenance(record) {
  const errors = [];
  for (const f of REQUIRED_PROVENANCE_FIELDS) {
    if (!(f in record)) errors.push(`missing required provenance field: ${f}`);
  }
  if ('isLive' in record && typeof record.isLive !== 'boolean') errors.push('isLive must be an explicit boolean');
  if ('claimFixtureId' in record && record.claimFixtureId === undefined) {
    errors.push('claimFixtureId must be null (Clean trial) or a fixture id string (Injected trial) — never undefined/omitted');
  }
  if (errors.length > 0) throw new Error(`Invalid provenance record:\n  - ${errors.join('\n  - ')}`);
  return true;
}

module.exports = { REQUIRED_PROVENANCE_FIELDS, validateProvenance };
