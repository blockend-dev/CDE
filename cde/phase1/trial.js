'use strict';
/**
 * Trial construction and Clean/Injected pairing.
 *
 * buildPair() is the single entry point: given one frozen snapshot and one
 * claim fixture, it produces exactly one Clean trial (claim=null) and one
 * Injected trial (claim=that fixture), sharing everything the methodology
 * requires them to share, and running every integrity assertion before
 * returning. There is no code path that constructs a "pair" from two
 * different snapshots, or a Clean trial that received a claim, or an
 * Injected trial with more or less than exactly one claim — the function
 * signature itself only accepts one snapshot and one claim slot.
 *
 * PHASE 2 NOTE: this file was modified, minimally and deliberately, to
 * accept a pluggable `adapter` (and its associated config hashes) instead
 * of hardcoding cde/phase1/adapter.js's deterministicTestAdapter. This is
 * the one intentional seam Phase 2 needed: swapping the implementation
 * behind the adapter boundary, per cde/phase2's own design goal. Nothing
 * about pairing logic, condition classification, tool manifest, or
 * integrity checks changed — the default values reproduce Phase 1's exact
 * original behavior byte-for-byte (see cde/test/phase1.test.js, unchanged
 * assertions, still passing). The only other change is that both functions
 * are now `async`, because a real model call is inherently asynchronous;
 * `await` on the Phase 1 deterministic adapter's plain return value is a
 * no-op, so this is backward compatible.
 */

const { pairingKey, trialKey } = require('../lib/pairing');
const { toolManifestHash } = require('../lib/tools');
const { classifyCondition } = require('../lib/conditions');
const { createToolClient } = require('./toolReplay');
const { deterministicTestAdapter } = require('./adapter');
const { EXPERIMENT_VERSION, adapterConfigHash, systemPromptHash, SEED } = require('./config');
const integrity = require('./integrity');

async function runSingleTrial({ snapshot, claimFixture, claimStatus, pk, methodologyLockHash, adapter, modelConfigHash, experimentVersion, seed }) {
  const claimFixtureId = claimFixture ? claimFixture.id : null;
  const key = trialKey(pk, claimStatus);
  // Deterministic "requested at" time for replay: the snapshot's own market
  // timestamp, never wall-clock (see runExperiment.js for why this matters
  // for the byte-identical-replay requirement). A real-model adapter's own
  // request/response timestamps live inside its decision/trace metadata,
  // not here — this field describes when the FIXTURE was notionally read.
  const toolClient = createToolClient(snapshot, claimFixture, key, snapshot.marketTimestampUtc);
  const decision = await adapter({ snapshot, claimFixture, toolClient });

  const trial = {
    trialKey: key,
    pairingKey: pk,
    claimStatus,
    claimFixtureId,
    snapshotId: snapshot.snapshotId,
    symbol: snapshot.symbol,
    marketTimestampUtc: snapshot.marketTimestampUtc,
    condition: snapshot.condition,
    toolManifestHash: toolManifestHash(),
    methodologyLockHash,
    modelConfigHash,
    experimentVersion,
    seed,
    decision,
  };

  integrity.assertConditionValid(trial.condition);
  integrity.assertSnapshotProvenancePresent(snapshot);
  integrity.assertToolTracePresent(trial);
  if (claimStatus === 'clean') integrity.assertCleanTrialHasNoClaim(trial);

  return trial;
}

/**
 * @param {object} snapshot       frozen snapshot (fixture or real) — condition is derived from it, never overridden
 * @param {object} claimFixture   one entry from cde/lib/corpus.js LOCKED_FIXTURES
 * @param {string[]} allowedFixtureIds  the locked corpus's fixture ids, for the injected-claim validity check
 * @param {object} [options]
 * @param {Function} [options.adapter]            decision adapter, `({snapshot, claimFixture, toolClient}) => decision | Promise<decision>`. Defaults to Phase 1's deterministicTestAdapter.
 * @param {string}   [options.modelConfigHash]     defaults to Phase 1's adapterConfigHash()
 * @param {string}   [options.promptHash]          defaults to Phase 1's systemPromptHash()
 * @param {string}   [options.experimentVersion]   defaults to Phase 1's EXPERIMENT_VERSION
 * @param {number}   [options.seed]                defaults to Phase 1's SEED
 */
async function buildPair(snapshot, claimFixture, allowedFixtureIds, options = {}) {
  const {
    adapter = deterministicTestAdapter,
    modelConfigHash = adapterConfigHash(),
    promptHash = systemPromptHash(),
    experimentVersion = EXPERIMENT_VERSION,
    seed = SEED,
  } = options;

  integrity.assertNotResearchStudyOutput(snapshot);
  const methodologyLockHash = integrity.assertMethodologyLockValid();

  // classifyCondition() is the ONLY source of a trial's condition — it is
  // read from the snapshot (which itself derived it the same way in
  // buildSnapshot()), never passed in or set by this function.
  const derivedCondition = classifyCondition(snapshot.marketTimestampUtc);
  if (derivedCondition !== snapshot.condition) {
    throw new Error(`Snapshot's stored condition ("${snapshot.condition}") does not match a fresh re-derivation ("${derivedCondition}") from its own timestamp — refusing to proceed.`);
  }

  const pk = pairingKey({
    snapshotId: snapshot.snapshotId,
    symbol: snapshot.symbol,
    marketTimestampUtc: snapshot.marketTimestampUtc,
    modelConfigHash,
    systemPromptHash: promptHash,
    toolManifestHash: toolManifestHash(),
    seed,
  });

  const trialArgs = { pk, methodologyLockHash, adapter, modelConfigHash, experimentVersion, seed };
  const cleanTrial = await runSingleTrial({ ...trialArgs, snapshot, claimFixture: null, claimStatus: 'clean' });
  const injectedTrial = await runSingleTrial({ ...trialArgs, snapshot, claimFixture, claimStatus: 'injected' });

  integrity.assertInjectedTrialHasValidClaim(injectedTrial, allowedFixtureIds);
  integrity.assertPairInvariants(cleanTrial, injectedTrial);
  integrity.assertToolManifestInvariant(cleanTrial, injectedTrial, toolManifestHash());
  // NOTE: assertBaselineOutputsIdentical is deliberately NOT called here.
  // It is a valid invariant only for a claim-blind adapter (Phase 1's
  // deterministic adapter) — the whole point of a real model adapter
  // (Phase 2) is that Clean and Injected decisions MAY legitimately
  // differ. Phase 1's own orchestrator (runExperiment.js) calls this
  // assertion itself, since it specifically knows it is always using the
  // claim-blind adapter; buildPair() stays adapter-agnostic.

  return { pairingKey: pk, condition: snapshot.condition, clean: cleanTrial, injected: injectedTrial };
}

module.exports = { buildPair, runSingleTrial };
