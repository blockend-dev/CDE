'use strict';
/**
 * Read-only adapter between the demo and the frozen Phase 4/5 research
 * artifacts. Loads once per process (data is immutable — the canonical
 * run is never re-collected), computes UI-safe per-pair deltas by
 * calling the SAME cde/lib/metrics.js functions the locked analysis
 * uses, and never writes to cde/runs/ or cde/analysis/.
 */

const fs = require('fs');
const path = require('path');

const { injectedDelta, verificationDivergence } = require('../../cde/lib/metrics');
const { LOCKED_FIXTURES } = require('../../cde/lib/corpus');

const REPO_ROOT = path.join(__dirname, '..', '..');
const RUN_ID = 'run-2026-09-19T155659111Z';
const RUN_DIR = path.join(REPO_ROOT, 'cde', 'runs', RUN_ID);
const ANALYSIS_RESULT_PATH = path.join(REPO_ROOT, 'cde', 'analysis', 'results', RUN_ID, 'analysis_result.json');
const METHODOLOGY_LOCK_PATH = path.join(REPO_ROOT, 'cde', 'methodology.lock.json');
const ANALYSIS_LOCK_PATH = path.join(REPO_ROOT, 'cde', 'analysis', 'analysis.lock.json');

const FIXTURE_BY_ID = Object.fromEntries(LOCKED_FIXTURES.map((f) => [f.id, f]));

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function readJsonDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(dir, f)));
}

let cache = null;

function claimTextFor(claimFixtureId, symbol) {
  const fixture = FIXTURE_BY_ID[claimFixtureId];
  if (!fixture) return null;
  return {
    id: fixture.id,
    template: fixture.template,
    claimText: fixture.claimText.replace('{SYMBOL}', symbol),
    intendedFalseBelief: fixture.intendedFalseBelief,
  };
}

function buildPairRecord(trial) {
  const { clean, injected } = trial.pair;
  const delta = injectedDelta(clean.decision, injected.decision);
  const verifDiv = verificationDivergence(clean.decision, injected.decision);
  const claimStatusChanged = clean.decision.claimAssessment !== injected.decision.claimAssessment;
  // Deliberately matches cde/lib/metrics.js: injectedDelta()'s own three fields exactly — NOT
  // claimStatusChanged, which is expected/definitional (clean trials are claim-blind by
  // construction, so their claimAssessment is always "no_claim_presented"; it differs from the
  // injected member's assessment on every pair in this dataset and is therefore not a meaningful
  // "did the decision change" signal on its own).
  const structuredDecisionChanged = delta.exposureDelta !== 0 || delta.directionFlip || delta.confidenceDelta !== 0;
  const claim = claimTextFor(injected.claimFixtureId, injected.symbol);

  return {
    pairingKey: trial.pair.pairingKey,
    condition: trial.condition,
    candidateSnapshotId: trial.candidateSnapshotId,
    symbol: clean.symbol,
    marketTimestampUtc: clean.marketTimestampUtc,
    claimFixtureId: injected.claimFixtureId,
    claimTemplate: claim ? claim.template : null,
    claimText: claim ? claim.claimText : null,
    intendedFalseBelief: claim ? claim.intendedFalseBelief : null,
    exposureDelta: delta.exposureDelta,
    confidenceDelta: delta.confidenceDelta,
    directionFlip: delta.directionFlip,
    verificationDivergence: verifDiv,
    claimStatusChanged,
    structuredDecisionChanged,
    cleanClaimAssessment: clean.decision.claimAssessment,
    injectedClaimAssessment: injected.decision.claimAssessment,
    cleanDirection: clean.decision.direction,
    injectedDirection: injected.decision.direction,
    attemptedAtUtc: trial.attemptedAtUtc,
    clean,
    injected,
  };
}

function load() {
  if (cache) return cache;

  const runManifest = readJson(path.join(RUN_DIR, 'manifest.json'));
  const datasetManifest = readJson(path.join(RUN_DIR, 'dataset_manifest.json'));
  const analysisResult = readJson(ANALYSIS_RESULT_PATH);
  const methodologyLock = readJson(METHODOLOGY_LOCK_PATH);
  const analysisLock = readJson(ANALYSIS_LOCK_PATH);

  const trials = readJsonDir(path.join(RUN_DIR, 'trials'));
  const failures = readJsonDir(path.join(RUN_DIR, 'failures'));

  const pairs = trials.map(buildPairRecord).sort((a, b) => (a.marketTimestampUtc < b.marketTimestampUtc ? -1 : 1));
  const pairsByKey = new Map(pairs.map((p) => [p.pairingKey, p]));

  cache = {
    runId: RUN_ID,
    runDir: RUN_DIR,
    runManifest,
    datasetManifest,
    analysisResult,
    methodologyLock,
    analysisLock,
    trials,
    failures,
    pairs,
    pairsByKey,
  };
  return cache;
}

function getPair(pairingKey) {
  return load().pairsByKey.get(pairingKey) || null;
}

function listPairs(filters = {}) {
  let out = load().pairs;
  if (filters.condition) out = out.filter((p) => p.condition === filters.condition);
  if (filters.claimTemplate) out = out.filter((p) => p.claimTemplate === filters.claimTemplate);
  if (filters.direction) out = out.filter((p) => p.injectedDirection === filters.direction);
  if (filters.changed === 'true') out = out.filter((p) => p.structuredDecisionChanged);
  if (filters.changed === 'false') out = out.filter((p) => !p.structuredDecisionChanged);
  if (filters.claimAssessment) out = out.filter((p) => p.injectedClaimAssessment === filters.claimAssessment);
  return out;
}

function experimentSummary() {
  const d = load();
  return {
    runId: d.runId,
    completedPairs: d.pairs.length,
    completedByCondition: d.datasetManifest.completedByCondition,
    failedAttemptsCount: d.datasetManifest.failedAttemptsCount,
    attemptedTotal: d.datasetManifest.attemptedTotal,
    primary: {
      pointEstimate: d.analysisResult.primary.pointEstimate,
      confidenceInterval: d.analysisResult.primary.confidenceInterval,
      significance: d.analysisResult.primary.significance,
      sensitivity: d.analysisResult.primary.sensitivity,
    },
    sampleSize: d.analysisResult.sampleSize,
    hashes: {
      methodologyLockHash: d.methodologyLock.contentHash,
      analysisLockHash: d.analysisLock.contentHash,
      datasetManifestHash: d.datasetManifest.datasetManifestHash,
      modelConfigHash: d.runManifest.modelConfigHash,
      promptHash: d.runManifest.promptHash,
      toolManifestHash: d.runManifest.toolManifestHash,
      attackCorpusHash: d.runManifest.attackCorpusHash,
    },
    model: d.runManifest.model,
    provider: d.runManifest.provider,
  };
}

module.exports = { RUN_ID, RUN_DIR, ANALYSIS_RESULT_PATH, load, getPair, listPairs, experimentSummary };
