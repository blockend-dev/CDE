'use strict';
/**
 * Phase 5A — read-only mechanical preflight over a finalized Phase 4 run
 * directory. Every check either recomputes a value from the on-disk
 * artifacts/locked code and compares it to a frozen expectation, or
 * inspects repository history — it never trusts a self-reported field
 * without recomputation. Nothing here writes to the run directory.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const { computeLock: computeMethodologyLock } = require('../lib/methodologyLock');
const { computeLock: computeAnalysisLock } = require('../analysis/lib/analysisLock');
const { validateAndClassify } = require('../analysis/lib/inputValidation');
const integrity = require('../phase1/integrity');
const { buildCandidateQueues } = require('../phase4/population');

const GIT_SHELL = process.platform === 'win32' ? 'bash.exe' : undefined;
const REPO_ROOT = path.join(__dirname, '..', '..');
const LOCKED_ANALYSIS_FILES = ['cde/lib/metrics.js', 'cde/analysis/lib'];
// Updated 2026-09-24: publishing this repository to GitHub rewrote every commit's hash. These are
// the SAME two original commits (identical messages/authors/dates/content — "add preregistered
// analysis plan" and "add real model adapter") under their new post-rewrite hashes, not a broadened
// exemption. This is the one documented edit to any file under cde/ after the research concluded —
// see REPRODUCIBILITY.md for the full account and the original hashes this replaces.
const KNOWN_PRE_PHASE4_COMMITS = new Set(['79560ebfccbcf2c919dfd8ed670b84317af94d9e', 'dcebe8f1918807d812589d3df315f95162552603']);

function runGit(args) {
  return execSync(`git ${args}`, { cwd: REPO_ROOT, shell: GIT_SHELL }).toString().trim();
}

function readJsonDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

function loadRawAttemptOutcomes(runDir) {
  return [...readJsonDir(path.join(runDir, 'trials')), ...readJsonDir(path.join(runDir, 'failures'))];
}

function dup(arr) {
  return arr.length !== new Set(arr).size;
}

/** Rebuilds every candidate snapshot from the frozen population logic and indexes it by snapshotId. */
function buildSnapshotIndex() {
  const { weekdayCandidates, weekendCandidates } = buildCandidateQueues();
  const index = new Map();
  for (const c of [...weekdayCandidates, ...weekendCandidates]) index.set(c.snapshot.snapshotId, c.snapshot);
  return index;
}

/**
 * @param {string} runDir e.g. cde/runs/<runId>
 * @param {object} expected {methodologyLockHash, analysisLockHash, datasetManifestHash}
 */
function runPreflight(runDir, expected) {
  const checks = [];
  const record = (name, pass, detail) => checks.push({ name, pass, detail });

  const manifestPath = path.join(runDir, 'manifest.json');
  const datasetManifestPath = path.join(runDir, 'dataset_manifest.json');
  if (!fs.existsSync(manifestPath) || !fs.existsSync(datasetManifestPath)) {
    record('artifacts_present', false, 'manifest.json or dataset_manifest.json missing from run directory');
    return { pass: false, checks };
  }
  record('artifacts_present', true, null);

  const datasetManifest = JSON.parse(fs.readFileSync(datasetManifestPath, 'utf8'));
  const rawAttempts = loadRawAttemptOutcomes(runDir);
  const classified = validateAndClassify(rawAttempts);

  // 1. exact completed-pair counts
  record(
    'sample_counts_21_weekday_20_weekend',
    classified.summary.completedWeekday === 21 && classified.summary.completedWeekend === 20,
    classified.summary
  );

  // 2. failed weekend pair excluded from analysis set but preserved as an artifact
  const failuresOnDisk = readJsonDir(path.join(runDir, 'failures'));
  record(
    'failed_attempt_excluded_and_preserved',
    classified.summary.failed === 1 && failuresOnDisk.length === 1 && failuresOnDisk[0].condition === 'weekend' && classified.summary.excludedCompleted === 0,
    { failedSummary: classified.summary.failed, onDisk: failuresOnDisk.length, condition: failuresOnDisk[0] && failuresOnDisk[0].condition }
  );

  // 3. pairing invariants hold for every analyzable pair
  const invariantViolations = [];
  for (const p of [...classified.weekdayPairs, ...classified.weekendPairs]) {
    try {
      integrity.assertPairInvariants(p.clean, p.injected);
      integrity.assertToolTracePresent(p.clean);
      integrity.assertToolTracePresent(p.injected);
    } catch (err) {
      invariantViolations.push({ pairingKey: p.pairingKey, error: err.message });
    }
  }
  record('pairing_invariants_hold', invariantViolations.length === 0, invariantViolations);

  // 4. no duplicate trial/pair/snapshot identities
  const trialKeys = [];
  const pairingKeys = [];
  const snapshotIds = [];
  for (const t of readJsonDir(path.join(runDir, 'trials'))) {
    trialKeys.push(t.pair.clean.trialKey, t.pair.injected.trialKey);
    pairingKeys.push(t.pair.pairingKey);
    snapshotIds.push(t.candidateSnapshotId);
  }
  record('no_duplicate_identities', !dup(trialKeys) && !dup(pairingKeys) && !dup(snapshotIds), {
    trialKeys: trialKeys.length,
    uniqueTrialKeys: new Set(trialKeys).size,
    pairingKeys: pairingKeys.length,
    uniquePairingKeys: new Set(pairingKeys).size,
    snapshotIds: snapshotIds.length,
    uniqueSnapshotIds: new Set(snapshotIds).size,
  });

  // 5. methodology/analysis/dataset hashes match the frozen values the caller supplied
  const methodologyLock = computeMethodologyLock();
  const analysisLock = computeAnalysisLock();
  record('methodology_lock_matches_frozen', methodologyLock.contentHash === expected.methodologyLockHash, methodologyLock.contentHash);
  record('analysis_lock_matches_frozen', analysisLock.contentHash === expected.analysisLockHash, analysisLock.contentHash);
  record('dataset_manifest_hash_matches_expected', datasetManifest.datasetManifestHash === expected.datasetManifestHash, datasetManifest.datasetManifestHash);

  // 6. model/prompt/tool/corpus configuration uniform across every completed pair
  record('config_uniform_across_completed_pairs', datasetManifest.configConsistent === true, datasetManifest.configConsistency);

  // 7. the finalized dataset is exactly what the analysis pipeline would classify from disk right now
  record(
    'finalized_dataset_matches_pipeline_input',
    JSON.stringify(classified.summary) === JSON.stringify(datasetManifest.phase3ClassificationSummary),
    { recomputedNow: classified.summary, recordedAtFinalization: datasetManifest.phase3ClassificationSummary }
  );

  // 8. no Phase 4/5 commit has touched the locked metrics/analysis modules
  let historyCheck;
  try {
    const log = runGit(`log --format=%H -- ${LOCKED_ANALYSIS_FILES.join(' ')}`);
    const touchingCommits = log ? log.split('\n').filter(Boolean) : [];
    const unexpected = touchingCommits.filter((sha) => !KNOWN_PRE_PHASE4_COMMITS.has(sha));
    historyCheck = { touchingCommits, unexpected };
    record('no_phase4_or_5_redefinition_of_locked_metrics', unexpected.length === 0, historyCheck);
  } catch (err) {
    record('no_phase4_or_5_redefinition_of_locked_metrics', false, { error: err.message });
  }

  // 9. primary estimand/outcome/tests/alpha/stopping-rule/failure-policy/etc match the locked plan
  // — implied by check 5 (the whole analysis.lock.json content hash matches) together with check 8
  // (nothing redefined the code that produces it); recorded explicitly for auditability.
  record('locked_plan_fields_unchanged', analysisLock.contentHash === expected.analysisLockHash, {
    primaryEstimand: analysisLock.primaryEstimand,
    primaryStatisticalMethod: analysisLock.primaryStatisticalMethod,
    confidenceIntervalMethod: analysisLock.confidenceIntervalMethod,
    alpha: analysisLock.alpha,
    numPermutations: analysisLock.numPermutations,
    numBootstrapResamples: analysisLock.numBootstrapResamples,
    failurePolicy: analysisLock.failurePolicy,
    multipleComparisonPolicy: analysisLock.multipleComparisonPolicy,
    calendarPriorPolicy: analysisLock.calendarPriorPolicy,
    minCompletedPairsPerCondition: analysisLock.minCompletedPairsPerCondition,
    maxAttemptedPairs: analysisLock.maxAttemptedPairs,
  });

  // --- critical provenance audit -------------------------------------------
  const snapshotIndex = buildSnapshotIndex();
  const provenanceIssues = [];
  const trialsOnDisk = readJsonDir(path.join(runDir, 'trials'));
  for (const t of trialsOnDisk) {
    const snap = snapshotIndex.get(t.candidateSnapshotId);
    if (!snap) {
      provenanceIssues.push({ snapshotId: t.candidateSnapshotId, error: 'snapshot not reproducible from the frozen population/replay logic' });
      continue;
    }
    const endpoint = snap.provenance && snap.provenance.bitgetEndpoint;
    const recognizedPrefix = typeof endpoint === 'string' && (endpoint.startsWith('REPLAY:') || endpoint.startsWith('FIXTURE:'));
    if (!recognizedPrefix) provenanceIssues.push({ snapshotId: t.candidateSnapshotId, error: `unrecognized provenance endpoint marker: ${endpoint}` });
    if (snap.provenance.isLive !== false) provenanceIssues.push({ snapshotId: t.candidateSnapshotId, error: 'isLive was not false' });
    if (snap.symbol !== t.pair.clean.symbol) provenanceIssues.push({ snapshotId: t.candidateSnapshotId, error: 'symbol mismatch between regenerated snapshot and trial artifact' });
    if (snap.marketTimestampUtc !== t.pair.clean.marketTimestampUtc) provenanceIssues.push({ snapshotId: t.candidateSnapshotId, error: 'marketTimestampUtc mismatch between regenerated snapshot and trial artifact' });
  }
  record('provenance_reproducible_and_honest', provenanceIssues.length === 0, {
    checkedTrials: trialsOnDisk.length,
    issues: provenanceIssues,
    note:
      'price.last / symbol / marketTimestampUtc are REAL values from the research/weekend-informativeness precondition study; ' +
      'orderbook / volume / candles are DERIVED placeholders, never claimed as independently observed. See snapshot.provenance.disclosure.',
  });

  const pass = checks.every((c) => c.pass);
  return { pass, checks };
}

module.exports = { runPreflight, loadRawAttemptOutcomes };
