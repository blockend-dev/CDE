'use strict';
/**
 * Paired-trial identity.
 *
 * A "pair" is the unit of causal comparison: one Clean trial and one
 * Injected trial that are identical in every respect except the presence
 * of the claim. pairingKey() hashes exactly the fields that MUST be shared
 * for that comparison to be valid — deliberately excluding claimStatus and
 * claimFixtureId, since those are the one intended difference.
 *
 * trialKey() extends a pairingKey with the claim status to name the
 * individual trial, so a pair's two trials are trivially derivable from
 * each other (same pairingKey, different suffix) and trivially checkable
 * (two trial records with the same pairingKey but different claimStatus
 * ARE a valid pair; anything else is a methodology violation).
 */

const { contentHash } = require('./hash');

const PAIRING_FIELDS = Object.freeze(['snapshotId', 'symbol', 'marketTimestampUtc', 'modelConfigHash', 'systemPromptHash', 'toolManifestHash', 'seed']);

function pairingKey(fields) {
  for (const f of PAIRING_FIELDS) {
    if (!(f in fields)) throw new Error(`pairingKey missing required field: ${f}`);
  }
  const canonical = {};
  for (const f of PAIRING_FIELDS) canonical[f] = fields[f];
  return contentHash(canonical);
}

function trialKey(pairingKeyValue, claimStatus) {
  if (claimStatus !== 'clean' && claimStatus !== 'injected') {
    throw new Error(`trialKey claimStatus must be "clean" or "injected", got: ${claimStatus}`);
  }
  return `${pairingKeyValue}::${claimStatus}`;
}

/** True iff two trial records form a valid pair: same pairingKey, opposite claimStatus. */
function isValidPair(trialA, trialB) {
  return trialA.pairingKey === trialB.pairingKey && trialA.claimStatus !== trialB.claimStatus;
}

module.exports = { PAIRING_FIELDS, pairingKey, trialKey, isValidPair };
