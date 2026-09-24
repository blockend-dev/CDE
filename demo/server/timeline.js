'use strict';
/**
 * Experiment Timeline — every entry is derived from real repository state
 * (the actual commit that first introduced each phase's marker file, and
 * the real lock/hash values), never hand-typed prose dates.
 *
 * Commit metadata comes from timelineCommits.json, recorded once from a
 * full-history local clone, rather than a live `git log` at request time.
 * Many deploy platforms (Render confirmed) shallow-clone (`--depth=1`) by
 * default, under which `git log -- <path>` can only see the single fetched
 * commit and would silently report it as having introduced every file —
 * this is display-only content, not a tamper-detection check, so recording
 * the real, independently-verifiable answer once is strictly more correct
 * than a live query that depends on the deploy environment's history depth.
 * See REPRODUCIBILITY.md.
 */

const fs = require('fs');

const dataLoader = require('./dataLoader');
const RECORDED = require('./timelineCommits.json').byKey;

function commitMeta(entry) {
  if (!entry) return null;
  return { sha: entry.sha, subject: entry.subject, date: entry.date };
}

function buildTimeline() {
  const d = dataLoader.load();

  const phase0Sha = RECORDED.phase0;
  const phase1Sha = RECORDED.phase1;
  const phase2Sha = RECORDED.phase2;
  const phasesBundled = phase0Sha.sha === phase1Sha.sha && phase1Sha.sha === phase2Sha.sha;
  const phase3Sha = RECORDED.phase3;
  const phase4FirstSha = RECORDED.phase4First;
  const phase4DatasetSha = RECORDED.phase4Dataset;
  const phase5Sha = RECORDED.phase5;

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
