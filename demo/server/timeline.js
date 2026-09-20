'use strict';
/**
 * Experiment Timeline — every entry is derived from real repository state
 * (the actual commit that first introduced each phase's marker file, and
 * the real lock/hash values), never hand-typed prose dates. Mirrors
 * cde/phase4/runManifest.js's GIT_SHELL workaround for UNC-path git calls.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const dataLoader = require('./dataLoader');

const GIT_SHELL = process.platform === 'win32' ? 'bash.exe' : undefined;
const REPO_ROOT = path.join(__dirname, '..', '..');

function runGit(args) {
  return execSync(`git ${args}`, { cwd: REPO_ROOT, shell: GIT_SHELL }).toString().trim();
}

function firstCommitAdding(relPath) {
  const out = runGit(`log --diff-filter=A --format=%H -- "${relPath}"`);
  if (!out) return null;
  const lines = out.split('\n').filter(Boolean);
  return lines[lines.length - 1]; // oldest
}

function commitMeta(sha) {
  if (!sha) return null;
  const out = runGit(`show -s --format=%H%x1f%s%x1f%cI "${sha}"`);
  const [hash, subject, date] = out.split('\x1f');
  return { sha: hash, subject, date };
}

function buildTimeline() {
  const d = dataLoader.load();

  const phase0Sha = firstCommitAdding('cde/methodology.lock.json');
  const phase1Sha = firstCommitAdding('cde/phase1/README.md');
  const phase2Sha = firstCommitAdding('cde/phase2/config.js');
  const phasesBundled = phase0Sha === phase1Sha && phase1Sha === phase2Sha;
  const phase3Sha = firstCommitAdding('cde/analysis/analysis.lock.json');
  const phase4FirstSha = firstCommitAdding('cde/phase4/population.js');
  const phase4DatasetSha = firstCommitAdding(`cde/runs/${dataLoader.RUN_ID}/manifest.json`);
  const phase5Sha = firstCommitAdding(`cde/analysis/results/${dataLoader.RUN_ID}/analysis_result.json`);

  return [
    {
      phase: 'Phase 0',
      title: 'Methodology Lock',
      note: 'Snapshot contract, condition classifier, claim-blind baseline, claim-template corpus, pairing identity, tool manifest — locked before any trial existed.',
      hashLabel: 'methodologyLockHash',
      hash: d.methodologyLock.contentHash,
      commit: commitMeta(phase0Sha),
      bundledWithNextPhases: phasesBundled,
    },
    {
      phase: 'Phase 1',
      title: 'Deterministic Fixture Validation',
      note: 'Harness validated end-to-end against hand-authored synthetic fixtures only — no research claim made yet.',
      hashLabel: 'toolManifestHash',
      hash: d.methodologyLock.toolManifestHash,
      commit: commitMeta(phase1Sha),
      bundledWithNextPhases: phasesBundled,
    },
    {
      phase: 'Phase 2',
      title: 'Real Model Adapter',
      note: 'Real Anthropic-backed adapter plugged into the same Phase 1 boundary, plus leakage tests. Still zero research-scale data collected.',
      hashLabel: 'modelConfigHash',
      hash: d.runManifest.modelConfigHash,
      commit: commitMeta(phase2Sha),
      bundledWithNextPhases: false,
    },
    {
      phase: 'Phase 3',
      title: 'Analysis Lock',
      note: 'Primary estimand, significance test, CI method, sample-size/stopping rule, and failure policy pre-registered — before any real trial data existed.',
      hashLabel: 'analysisLockHash',
      hash: d.analysisLock.contentHash,
      commit: commitMeta(phase3Sha),
    },
    {
      phase: 'Phase 4',
      title: 'Frozen Data Collection',
      note: `${d.datasetManifest.completedPairsCount} completed pairs collected against the real model, exactly per the Phase 0/3 locks. First engine commit / dataset-finalized commit shown.`,
      hashLabel: 'datasetManifestHash',
      hash: d.datasetManifest.datasetManifestHash,
      commit: commitMeta(phase4DatasetSha),
      firstCommit: commitMeta(phase4FirstSha),
    },
    {
      phase: 'Phase 5',
      title: 'Locked Analysis',
      note: 'The pre-registered analysis executed against the frozen dataset, unmodified — no post-hoc changes to estimand, test, or exclusions.',
      hashLabel: 'analysisResultHash',
      hash: fs.existsSync(dataLoader.ANALYSIS_RESULT_PATH) ? JSON.parse(fs.readFileSync(dataLoader.ANALYSIS_RESULT_PATH, 'utf8')).analysisResultHash : null,
      commit: commitMeta(phase5Sha),
    },
  ];
}

module.exports = { buildTimeline };
