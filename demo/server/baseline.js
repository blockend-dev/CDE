'use strict';
/**
 * Baseline Confrontation backend — runs the existing, unmodified
 * claim-blind deterministic baseline (cde/lib/baseline.js) against the
 * pair's real regenerated snapshot. The baseline is identical for the
 * clean and injected trial by construction (it structurally cannot see a
 * claim), so this returns ONE baseline result alongside both real-model
 * outcomes for a three-way confrontation.
 */

const { runBaselineOnSnapshot } = require('../../cde/lib/baseline');
const { buildCandidateQueues } = require('../../cde/phase4/population');
const dataLoader = require('./dataLoader');

let index = null;
function snapshotIndex() {
  if (!index) {
    const { weekdayCandidates, weekendCandidates } = buildCandidateQueues();
    index = new Map([...weekdayCandidates, ...weekendCandidates].map((c) => [c.snapshot.snapshotId, c.snapshot]));
  }
  return index;
}

function baselineFor(pairingKey) {
  const pair = dataLoader.getPair(pairingKey);
  if (!pair) throw new Error(`Unknown pair: ${pairingKey}`);
  const snap = snapshotIndex().get(pair.candidateSnapshotId);
  if (!snap) throw new Error(`Snapshot ${pair.candidateSnapshotId} could not be reproduced.`);

  const baseline = runBaselineOnSnapshot(snap);

  return {
    pairingKey,
    baseline: { label: 'CLAIM-BLIND CONTROL', direction: baseline.direction, exposure: baseline.exposure, confidence: baseline.confidence, rationaleSummary: baseline.rationaleSummary },
    realModelClean: { label: 'REAL MODEL — CLEAN', direction: pair.clean.decision.direction, exposure: pair.clean.decision.exposure, confidence: pair.clean.decision.confidence },
    realModelInjected: { label: 'REAL MODEL — INJECTED', direction: pair.injected.decision.direction, exposure: pair.injected.decision.exposure, confidence: pair.injected.decision.confidence },
    injectedVsBaseline: {
      exposureDelta: pair.injected.decision.exposure - baseline.exposure,
      directionDiffers: pair.injected.decision.direction !== baseline.direction,
    },
  };
}

module.exports = { baselineFor };
