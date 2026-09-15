'use strict';
/**
 * Dataset finalization — Phase 4 §17. Runs ONLY mechanical validation
 * (counts, duplicate detection, integrity checks, config consistency) and
 * writes a content-addressed dataset manifest. Deliberately does NOT
 * compute or report any statistic (no p-value, no DiD, no interpretation)
 * — that is explicitly out of scope for this phase.
 *
 * Reuses cde/analysis/lib/inputValidation.js: validateAndClassify()
 * directly to prove the collected artifacts are consumable by the Phase 3
 * analysis pipeline without modification — it is called here ONLY for its
 * classification/counting behavior, never for computing a result.
 */

const fs = require('fs');
const path = require('path');

const { contentHash } = require('../lib/hash');
const integrity = require('../phase1/integrity');
const { validateAndClassify } = require('../analysis/lib/inputValidation');

function readJsonDir(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: f, content: JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) }));
}

function findDuplicates(values) {
  const seen = new Set();
  const dupes = new Set();
  for (const v of values) {
    if (seen.has(v)) dupes.add(v);
    seen.add(v);
  }
  return [...dupes];
}

/**
 * @param {string} runDir e.g. cde/runs/<runId>
 * @returns the dataset manifest (also written to runDir/dataset_manifest.json)
 */
function finalizeDataset(runDir) {
  const manifestPath = path.join(runDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) throw new Error(`No manifest.json found in ${runDir} — not a valid run directory.`);
  const runManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  const trialEntries = readJsonDir(path.join(runDir, 'trials'));
  const failureEntries = readJsonDir(path.join(runDir, 'failures'));

  const completedPairs = trialEntries.map((e) => e.content);
  const failedAttempts = failureEntries.map((e) => e.content);

  // --- duplicate detection -------------------------------------------------
  const trialKeys = [];
  const pairingKeys = [];
  const snapshotIds = [];
  for (const p of completedPairs) {
    trialKeys.push(p.pair.clean.trialKey, p.pair.injected.trialKey);
    pairingKeys.push(p.pair.pairingKey);
    snapshotIds.push(p.candidateSnapshotId);
  }
  const duplicateTrialKeys = findDuplicates(trialKeys);
  const duplicatePairingKeys = findDuplicates(pairingKeys);
  const duplicateSnapshotIds = findDuplicates(snapshotIds);

  // --- per-pair integrity (exactly one clean + one injected, invariants hold) ---
  const integrityViolations = [];
  for (const p of completedPairs) {
    try {
      integrity.assertPairInvariants(p.pair.clean, p.pair.injected);
      if (p.pair.clean.claimStatus !== 'clean') throw new Error('clean member does not have claimStatus "clean"');
      if (p.pair.injected.claimStatus !== 'injected') throw new Error('injected member does not have claimStatus "injected"');
      integrity.assertToolTracePresent(p.pair.clean);
      integrity.assertToolTracePresent(p.pair.injected);
    } catch (err) {
      integrityViolations.push({ snapshotId: p.candidateSnapshotId, error: err.message });
    }
  }

  // --- config consistency across every analyzed pair ------------------------
  const configFields = ['methodologyLockHash', 'toolManifestHash', 'modelConfigHash', 'experimentVersion'];
  const configConsistency = {};
  for (const f of configFields) {
    const values = new Set(completedPairs.map((p) => p.pair.clean[f]));
    configConsistency[f] = { distinctValues: values.size, consistent: values.size <= 1, value: values.size === 1 ? [...values][0] : null };
  }
  const configConsistent = configFields.every((f) => configConsistency[f].consistent);

  // --- consumable by the Phase 3 pipeline without modification --------------
  // Rebuild the exact buildPairSafely()-shaped array and classify it —
  // classification/counting ONLY, no statistic is computed here.
  const rawAttemptOutcomes = [...completedPairs, ...failedAttempts];
  let classification = null;
  let classificationError = null;
  try {
    classification = validateAndClassify(rawAttemptOutcomes);
  } catch (err) {
    classificationError = err.message;
  }

  const completedByCondition = { weekday: completedPairs.filter((p) => p.condition === 'weekday').length, weekend: completedPairs.filter((p) => p.condition === 'weekend').length };
  const failedByCategory = failedAttempts.reduce((acc, f) => {
    acc[f.failureCategory] = (acc[f.failureCategory] || 0) + 1;
    return acc;
  }, {});

  // NOTE: deliberately excludes any wall-clock value — the hash must be a
  // pure function of the run directory's CONTENT, so finalizing the same
  // directory twice (e.g. to double-check) always produces the same
  // datasetManifestHash. `finalizedAtUtc` is real wall-clock information
  // worth recording, so it is attached to the written file as a sibling
  // field, outside what gets hashed — the same pattern Phase 1's
  // resultSerializer/run_log split already uses for the same reason.
  const datasetManifestCore = {
    runId: runManifest.runId,
    runManifestHash: runManifest.manifestHash,
    attemptedTotal: completedPairs.length + failedAttempts.length,
    completedPairsCount: completedPairs.length,
    completedByCondition,
    failedAttemptsCount: failedAttempts.length,
    failedByCategory,
    duplicateTrialKeyCount: duplicateTrialKeys.length,
    duplicatePairingKeyCount: duplicatePairingKeys.length,
    duplicateSnapshotIdCount: duplicateSnapshotIds.length,
    integrityViolationCount: integrityViolations.length,
    integrityViolations,
    configConsistent,
    configConsistency,
    consumableByPhase3Pipeline: classificationError === null,
    phase3ClassificationSummary: classification ? classification.summary : null,
    phase3ClassificationError: classificationError,
    artifactSnapshotIds: [...snapshotIds].sort(),
  };

  const datasetManifest = { ...datasetManifestCore, datasetManifestHash: contentHash(datasetManifestCore), finalizedAtUtc: new Date().toISOString() };

  fs.writeFileSync(path.join(runDir, 'dataset_manifest.json'), JSON.stringify(datasetManifest, null, 2));
  return datasetManifest;
}

module.exports = { finalizeDataset, findDuplicates };
