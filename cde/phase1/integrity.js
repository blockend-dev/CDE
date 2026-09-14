'use strict';
/**
 * Experimental-integrity assertions. These are the mechanical checks that
 * make the twelve rejection requirements enforceable in code, not just
 * documented. trial.js calls the relevant ones while constructing a pair;
 * cde/test/phase1.test.js calls them directly with deliberately-broken
 * inputs to prove each one actually rejects.
 */

const { CONDITIONS, CLAIM_STATUSES } = require('../lib/conditions');
const { validateProvenance } = require('../lib/provenance');
const { computeLock } = require('../lib/methodologyLock');
const fs = require('fs');
const path = require('path');

function assertConditionValid(condition) {
  if (!Object.values(CONDITIONS).includes(condition)) {
    throw new Error(`Invalid/unregistered condition: "${condition}". Must be derived via cde/lib/conditions.js classifyCondition(), never set manually.`);
  }
}

function assertCleanTrialHasNoClaim(trial) {
  if (trial.claimStatus !== CLAIM_STATUSES.CLEAN) throw new Error('assertCleanTrialHasNoClaim called on a non-clean trial');
  if (trial.claimFixtureId !== null) {
    throw new Error(`Clean trial must have claimFixtureId === null, got "${trial.claimFixtureId}" — a Clean trial containing a claim is a methodology violation.`);
  }
  if (trial.decision && trial.decision.claimAssessment !== 'no_claim_presented') {
    throw new Error(`Clean trial's decision.claimAssessment must be "no_claim_presented", got "${trial.decision.claimAssessment}".`);
  }
}

function assertInjectedTrialHasValidClaim(trial, allowedFixtureIds) {
  if (trial.claimStatus !== CLAIM_STATUSES.INJECTED) throw new Error('assertInjectedTrialHasValidClaim called on a non-injected trial');
  if (!trial.claimFixtureId || typeof trial.claimFixtureId !== 'string') {
    throw new Error('Injected trial must have exactly one claimFixtureId (a non-empty string) — none was found.');
  }
  if (!allowedFixtureIds.includes(trial.claimFixtureId)) {
    throw new Error(`Injected trial references claimFixtureId "${trial.claimFixtureId}", which is not in the locked corpus (${allowedFixtureIds.join(', ')}).`);
  }
}

/**
 * The core pairing check: everything the methodology requires to be shared
 * between a Clean trial and its Injected counterpart, verified field by
 * field rather than trusted from a single pairingKey match (a matching
 * pairingKey already implies these are equal by hash construction, but
 * this function re-derives the comparison explicitly so a bug in
 * pairingKey() itself cannot silently hide a real divergence).
 */
function assertPairInvariants(cleanTrial, injectedTrial) {
  const sharedFields = ['snapshotId', 'marketTimestampUtc', 'symbol', 'toolManifestHash', 'methodologyLockHash', 'modelConfigHash', 'experimentVersion', 'seed', 'condition'];
  for (const f of sharedFields) {
    if (cleanTrial[f] !== injectedTrial[f]) {
      throw new Error(`Pair invariant violated on field "${f}": clean="${JSON.stringify(cleanTrial[f])}" injected="${JSON.stringify(injectedTrial[f])}". A Clean/Injected pair must be identical everywhere except the claim.`);
    }
  }
  if (cleanTrial.pairingKey !== injectedTrial.pairingKey) {
    throw new Error('Pair invariant violated: pairingKey differs between the Clean and Injected trial.');
  }
  if (cleanTrial.claimStatus === injectedTrial.claimStatus) {
    throw new Error('Pair invariant violated: both trials have the same claimStatus — a pair must be exactly one Clean and one Injected.');
  }
  assertConditionValid(cleanTrial.condition);
}

function assertToolManifestInvariant(cleanTrial, injectedTrial, expectedHash) {
  if (cleanTrial.toolManifestHash !== expectedHash || injectedTrial.toolManifestHash !== expectedHash) {
    throw new Error('Tool manifest hash mismatch — every trial in every cell must use the exact same tool manifest.');
  }
}

/** Re-derives cde/lib/baseline.js's guarantee at the trial level: the market-only view passed to the baseline must never carry a claim field. */
function assertBaselineNeverSeesClaim(marketOnlyViewLike) {
  const claimKeys = Object.keys(marketOnlyViewLike).filter((k) => /claim|rumor|injected|headline/i.test(k));
  if (claimKeys.length > 0) {
    throw new Error(`A claim-shaped field reached the baseline's input: ${claimKeys.join(', ')}. This must never happen.`);
  }
}

function assertBaselineOutputsIdentical(cleanBaselineDecision, injectedBaselineDecision) {
  const quantitativeFields = ['direction', 'exposure', 'confidence'];
  for (const f of quantitativeFields) {
    if (cleanBaselineDecision[f] !== injectedBaselineDecision[f]) {
      throw new Error(`Baseline produced different "${f}" for Clean vs Injected (${cleanBaselineDecision[f]} vs ${injectedBaselineDecision[f]}) — the baseline must be claim-blind by construction.`);
    }
  }
}

function assertMethodologyLockValid() {
  const stored = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'methodology.lock.json'), 'utf8'));
  const computed = computeLock();
  if (computed.contentHash !== stored.contentHash) {
    throw new Error('Methodology lock mismatch: the locked methodology in cde/lib/ has drifted from cde/methodology.lock.json. This must be resolved as a deliberate version bump before running any trial.');
  }
  return stored.contentHash;
}

function assertSnapshotProvenancePresent(snapshot) {
  if (!snapshot.provenance) throw new Error('Snapshot is missing its provenance object entirely.');
  const required = ['bitgetEndpoint', 'capturedAtUtc', 'isLive'];
  for (const f of required) {
    if (!(f in snapshot.provenance)) throw new Error(`Snapshot provenance missing required field: ${f}`);
  }
}

function assertToolTracePresent(trial) {
  if (!Array.isArray(trial.decision.toolCalls) || trial.decision.toolCalls.length === 0) {
    throw new Error('Trial has no recorded tool-call trace — every trial must log at least its final propose_action call.');
  }
  for (const call of trial.decision.toolCalls) {
    if (call.trialKey !== trial.trialKey) {
      throw new Error(`Tool trace entry belongs to a different trial ("${call.trialKey}" vs "${trial.trialKey}") — trace/trial mismatch.`);
    }
  }
}

// Provenance markers this harness recognizes as non-live, audited sources:
// FIXTURE: (Phase 1/2 hand-authored synthetic data) and REPLAY: (Phase 4
// snapshots rebuilt from the precondition study's already-captured,
// immutable historical data — see cde/phase4/replaySnapshot.js). Anything
// else is presumed to be a live/unaudited endpoint string.
const RECOGNIZED_PROVENANCE_PREFIXES = ['FIXTURE:', 'REPLAY:'];

function assertNotResearchStudyOutput(candidate) {
  // The research pipeline's raw_dataset.json RAW records have a completely
  // different shape (observation.fridayRef, observation.weekendEndPrice,
  // metrics.errorReduction, etc.) than a real CDE snapshot and must never be
  // passed into this harness directly, regardless of provenance marker —
  // reject on shape first.
  if (candidate && candidate.observation && ('fridayRef' in candidate.observation || 'weekendEndPrice' in candidate.observation)) {
    throw new Error('Input has the shape of a research/weekend-informativeness precondition-study record, not a CDE snapshot — refusing to use empirical research output directly as a snapshot.');
  }
  if (candidate && candidate.provenance && typeof candidate.provenance.bitgetEndpoint === 'string' && !RECOGNIZED_PROVENANCE_PREFIXES.some((p) => candidate.provenance.bitgetEndpoint.startsWith(p))) {
    throw new Error(`Input's provenance.bitgetEndpoint ("${candidate.provenance.bitgetEndpoint}") looks like a real Bitget endpoint, not a recognized ${RECOGNIZED_PROVENANCE_PREFIXES.join('/')} marker — refusing.`);
  }
}

module.exports = {
  assertConditionValid,
  assertCleanTrialHasNoClaim,
  assertInjectedTrialHasValidClaim,
  assertPairInvariants,
  assertToolManifestInvariant,
  assertBaselineNeverSeesClaim,
  assertBaselineOutputsIdentical,
  assertMethodologyLockValid,
  assertSnapshotProvenancePresent,
  assertToolTracePresent,
  assertNotResearchStudyOutput,
  RECOGNIZED_PROVENANCE_PREFIXES,
};
