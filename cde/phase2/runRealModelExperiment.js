'use strict';
/**
 * Phase 2 orchestrator. Reuses cde/phase1/trial.js's buildPair() UNCHANGED
 * in logic — this file supplies the real adapter and real config hashes
 * through buildPair's existing options parameter, exactly the seam
 * cde/phase1/trial.js was generalized for. No pairing/condition/tool-
 * manifest/integrity logic is duplicated here.
 *
 * Adds exactly one thing Phase 1 didn't need: the completed/failed
 * distinction, since a real model call can fail in ways the deterministic
 * fixture adapter never does. A retry is never a new trial (see
 * cde/phase2/provider/anthropicClient.js); a genuine failure after the
 * retry budget is exhausted is marked `status: 'failed'` here, never
 * silently turned into a fabricated decision.
 */

const { buildPair } = require('../phase1/trial');
const { classifyCondition } = require('../lib/conditions');
const { toolManifestHash } = require('../lib/tools');
const { LOCKED_FIXTURES } = require('../lib/corpus');
const { promptHash: computePromptHash } = require('./prompt');
const { modelConfigHash: computeModelConfigHash, ADAPTER_VERSION } = require('./config');
const { AdapterFailure } = require('./failures');
const integrity = require('../phase1/integrity');

/**
 * Wraps buildPair() so a real-adapter failure becomes a typed, reported
 * result instead of an unhandled rejection that would abort the whole run.
 */
async function buildPairSafely(snapshot, claimFixture, allowedFixtureIds, options) {
  try {
    const pair = await buildPair(snapshot, claimFixture, allowedFixtureIds, options);
    return { status: 'completed', condition: pair.condition, pair };
  } catch (err) {
    const category = err instanceof AdapterFailure ? err.category : 'unknown';
    return {
      status: 'failed',
      condition: classifyCondition(snapshot.marketTimestampUtc),
      failureCategory: category,
      message: err.message,
      // AdapterFailure.details is already secret-redacted by realModelAdapter.js before it ever reaches here.
      details: err.details || {},
    };
  }
}

/**
 * Runs the real adapter against one snapshot/claim pair. Exposed
 * separately from a "run all four cells" function because Phase 2's
 * required deliverable is a single-trial/single-pair smoke test, not a
 * research-scale run (see cde/phase2/smokeTest.js) — that distinction is
 * enforced by which function a caller uses, not by a flag.
 */
async function runOnePair({ snapshot, claimFixtureId, providerClient, adapterFactory }) {
  const claimFixture = LOCKED_FIXTURES.find((f) => f.id === claimFixtureId);
  if (!claimFixture) throw new Error(`Unknown claimFixtureId "${claimFixtureId}" — not in the locked corpus.`);
  const allowedFixtureIds = LOCKED_FIXTURES.map((f) => f.id);

  const adapter = adapterFactory(providerClient);
  const modelConfigHash = computeModelConfigHash({ toolManifestHash: toolManifestHash() });
  const promptHash = computePromptHash();

  return buildPairSafely(snapshot, claimFixture, allowedFixtureIds, {
    adapter,
    modelConfigHash,
    promptHash,
    experimentVersion: ADAPTER_VERSION,
    seed: 0, // no sampling seed control is used for Phase 2 (see README: provider-level nondeterminism is acknowledged, not hidden)
  });
}

module.exports = { buildPairSafely, runOnePair };
