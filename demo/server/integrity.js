'use strict';
/**
 * Integrity Console backend — reuses the already-tested Phase 5 preflight
 * engine (cde/phase5/preflight.js) and the Phase 5 analysis runner
 * verbatim. This module adds NO new validation logic of its own beyond
 * labeling and a live reproducibility re-run; every actual check is the
 * same code cde/test/phase4.test.js / phase5.test.js already exercise.
 */

const fs = require('fs');
const path = require('path');

const { runPreflight } = require('../../cde/phase5/preflight');
const { runResearchAnalysis } = require('../../cde/phase5/runResearchAnalysis');
const dataLoader = require('./dataLoader');
const RECORDED_TRIAL_ORDER = require('./analysisInputOrder.json').trials;

const EXPECTED = {
  methodologyLockHash: '5acc71b0ee54949c04535e10d4fae00e6b85cb79728dbdc5df4b2e455d969d54',
  analysisLockHash: '43e0479499d286f4dfe06fd8ec4a036941cd3df1ff0b8afeaee423e2e167fdd7',
  datasetManifestHash: '99d3d5af659c28a91697783f5da850a719a173cce772f3e55990e96459e2daf2',
};

const LABELS = {
  artifacts_present: 'run artifacts present',
  sample_counts_21_weekday_20_weekend: 'sample counts (21 weekday / 20 weekend)',
  failed_attempt_excluded_and_preserved: 'failed attempt excluded & preserved',
  pairing_invariants_hold: 'pair invariants',
  no_duplicate_identities: 'no duplicate trial/pair/snapshot identities',
  methodology_lock_matches_frozen: 'methodology lock',
  analysis_lock_matches_frozen: 'analysis lock',
  dataset_manifest_hash_matches_expected: 'dataset integrity',
  config_uniform_across_completed_pairs: 'configuration consistency',
  finalized_dataset_matches_pipeline_input: 'dataset matches analysis pipeline input',
  no_phase4_or_5_redefinition_of_locked_metrics: 'no post-hoc redefinition of locked metrics',
  locked_plan_fields_unchanged: 'locked analysis plan fields unchanged',
  provenance_reproducible_and_honest: 'provenance',
  reproducibility: 'reproducibility re-run',
};

/**
 * The eight components of the experiment's chain of custody, in order, and
 * the REAL preflight checks that verify each one. Nothing is asserted here
 * that a check does not actually establish:
 *   - prompt has no independent check (it is only folded into the model
 *     configuration hash), so it stays "recorded only" — never a fake PASS;
 *   - tools and model are both covered by the configuration-consistency
 *     check (tool manifest / model config identical across every trial);
 *   - the claim corpus is hashed inside the methodology lock, so the
 *     methodology-lock check covers it;
 *   - the run manifest node is represented by what it governs — the
 *     stopping-rule outcome (sample counts, failed attempt preserved).
 */
const COMPONENTS = [
  { key: 'methodology', identityLabel: 'Methodology lock', chainLabel: 'Methodology', checks: ['methodology_lock_matches_frozen'] },
  { key: 'analysis', identityLabel: 'Analysis lock', chainLabel: 'Analysis', checks: ['analysis_lock_matches_frozen', 'locked_plan_fields_unchanged', 'reproducibility'] },
  { key: 'dataset', identityLabel: 'Dataset manifest', chainLabel: 'Dataset', checks: ['dataset_manifest_hash_matches_expected', 'no_duplicate_identities', 'pairing_invariants_hold', 'finalized_dataset_matches_pipeline_input'] },
  { key: 'model', identityLabel: 'Model configuration', chainLabel: 'Model', checks: ['config_uniform_across_completed_pairs'] },
  { key: 'prompt', identityLabel: 'Prompt', chainLabel: 'Prompt', checks: [] },
  { key: 'tools', identityLabel: 'Tool manifest', chainLabel: 'Tools', checks: ['config_uniform_across_completed_pairs'] },
  { key: 'corpus', identityLabel: 'Claim corpus', chainLabel: 'Corpus', checks: ['methodology_lock_matches_frozen'] },
  { key: 'stopping', identityLabel: 'Run manifest', chainLabel: 'Run · stopping rule', checks: ['sample_counts_21_weekday_20_weekend', 'failed_attempt_excluded_and_preserved', 'no_phase4_or_5_redefinition_of_locked_metrics'] },
];

// When the analysis pipeline refuses to run at all (mixed configuration), the
// refusal names the offending field; map it to the components it concerns.
const REFUSAL_FIELD_TO_COMPONENTS = {
  methodologyLockHash: ['methodology', 'corpus'],
  toolManifestHash: ['tools'],
  modelConfigHash: ['model'],
};

/**
 * Per-component status derived from real check results:
 *   pass | fail | unchecked (no independent check exists) | notrun (its checks never ran)
 */
function componentStatuses(results, { refusalField } = {}) {
  const byName = new Map(results.map((r) => [r.name, r.pass]));
  const refused = new Set(refusalField ? REFUSAL_FIELD_TO_COMPONENTS[refusalField] || [] : []);
  return COMPONENTS.map((c) => {
    let status;
    if (c.checks.length === 0) status = 'unchecked';
    else if (refused.has(c.key)) status = 'fail';
    else {
      const ran = c.checks.filter((n) => byName.has(n));
      status = ran.length === 0 ? 'notrun' : ran.every((n) => byName.get(n)) ? 'pass' : 'fail';
    }
    return { key: c.key, label: c.chainLabel, status, verifiedBy: c.checks.map((n) => LABELS[n] || n) };
  });
}

/**
 * The frozen Phase 5 loader reads trial files with an unsorted
 * fs.readdirSync, and its fixed-seed permutation p-value depends on that
 * input order. Windows lists this run directory in a different order than
 * Linux/macOS (which sort), so the committed result reproduces only if the
 * order it was produced with is replayed. This scopes a replay of that
 * recorded order (demo/server/analysisInputOrder.json) to a single
 * synchronous call; it changes no analysis logic and no cde/ file. If the
 * directory contents no longer match the record, unknown files are appended
 * and the resulting hash mismatch is reported honestly.
 */
function withRecordedTrialOrder(fn) {
  const recorded = new Set(RECORDED_TRIAL_ORDER);
  const original = fs.readdirSync;
  fs.readdirSync = function patchedReaddirSync(p, ...rest) {
    const listing = original.call(this, p, ...rest);
    if (typeof p !== 'string' || path.basename(p) !== 'trials') return listing;
    if (!Array.isArray(listing) || !listing.every((x) => typeof x === 'string')) return listing;
    const present = new Set(listing);
    return [...RECORDED_TRIAL_ORDER.filter((n) => present.has(n)), ...listing.filter((n) => !recorded.has(n)).sort()];
  };
  try {
    return fn();
  } finally {
    fs.readdirSync = original;
  }
}

/**
 * Runs the real preflight engine plus a live reproducibility check
 * (re-executes the locked analysis right now and compares its hash to the
 * committed analysis artifact). Never mutates cde/runs/ — preflight is
 * read-only, and re-running the analysis writes only to
 * cde/analysis/results/, which is idempotent/content-addressed.
 */
function verifyExperiment() {
  const preflight = runPreflight(dataLoader.RUN_DIR, EXPECTED);
  const checks = preflight.checks.map((c) => ({
    name: c.name,
    label: LABELS[c.name] || c.name,
    pass: c.pass,
    detail: summarize(c.name, c.detail),
  }));

  let reproducibility;
  // cde/phase5/runResearchAnalysis.js always writes its result (with a fresh
  // analyzedAtUtc) to the committed analysis artifact. The demo must be a
  // read-only consumer of frozen evidence, so the file's exact original
  // bytes are restored afterwards — the recomputed hash is compared in memory.
  const originalBytes = fs.readFileSync(dataLoader.ANALYSIS_RESULT_PATH);
  try {
    const committed = JSON.parse(originalBytes.toString('utf8'));
    let fresh;
    try {
      fresh = withRecordedTrialOrder(() => runResearchAnalysis(dataLoader.RUN_DIR, EXPECTED));
    } finally {
      fs.writeFileSync(dataLoader.ANALYSIS_RESULT_PATH, originalBytes);
    }
    reproducibility = {
      name: 'reproducibility',
      label: 'reproducibility (re-run now vs. committed result)',
      pass: fresh.analysisResultHash === committed.analysisResultHash,
      detail: { committedHash: committed.analysisResultHash, freshHash: fresh.analysisResultHash, inputOrder: 'recorded at analysis time' },
    };
  } catch (err) {
    reproducibility = { name: 'reproducibility', label: 'reproducibility (re-run now vs. committed result)', pass: false, detail: { error: err.message } };
  }
  checks.push(reproducibility);

  return { allPassed: checks.every((c) => c.pass), checks, components: componentStatuses(checks) };
}

function summarize(name, detail) {
  if (name === 'sample_counts_21_weekday_20_weekend') return { completedWeekday: detail.completedWeekday, completedWeekend: detail.completedWeekend };
  if (name === 'no_duplicate_identities') return { uniqueTrialKeys: detail.uniqueTrialKeys, uniquePairingKeys: detail.uniquePairingKeys, uniqueSnapshotIds: detail.uniqueSnapshotIds };
  if (name === 'provenance_reproducible_and_honest') return { checkedTrials: detail.checkedTrials, issues: detail.issues.length };
  if (name === 'pairing_invariants_hold') return { violations: Array.isArray(detail) ? detail.length : 0 };
  return undefined;
}

/**
 * The experiment's cryptographic identity, read from the committed lock
 * files/manifest as-is (not yet cross-checked against anything). Labeled
 * "Claim corpus" rather than the underlying field's "attackCorpusHash"
 * name to avoid colliding with Break the Experiment's unrelated use of
 * "attack" for dataset-tampering scenarios — this hash is the locked
 * injected-claim template set (cde/lib/corpus.js), not a tamper attack.
 */
function experimentIdentity() {
  const d = dataLoader.load();
  const hashes = {
    'Methodology lock': d.methodologyLock.contentHash,
    'Analysis lock': d.analysisLock.contentHash,
    'Dataset manifest': d.datasetManifest.datasetManifestHash,
    'Model configuration': d.runManifest.modelConfigHash,
    Prompt: d.runManifest.promptHash,
    'Tool manifest': d.runManifest.toolManifestHash,
    'Claim corpus': d.runManifest.attackCorpusHash,
    'Run manifest': d.runManifest.manifestHash,
  };
  return COMPONENTS.map((c) => ({
    key: c.key,
    label: c.identityLabel,
    chainLabel: c.chainLabel,
    hash: hashes[c.identityLabel],
    verifiedBy: c.checks.map((n) => LABELS[n] || n),
  }));
}

module.exports = { verifyExperiment, experimentIdentity, componentStatuses, COMPONENTS, EXPECTED };
