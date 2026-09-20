'use strict';
/**
 * Field-level provenance classification — regenerates the exact snapshot
 * a pair used (via the same frozen population/replay logic Phase 4/5
 * already use and test) and labels every field REAL, DERIVED, or FIXTURE.
 * Never invents a classification: it is read directly off
 * cde/phase4/replaySnapshot.js's own documented honesty boundary.
 */

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

function provenanceFor(pairingKey) {
  const pair = dataLoader.getPair(pairingKey);
  if (!pair) throw new Error(`Unknown pair: ${pairingKey}`);
  const snap = snapshotIndex().get(pair.candidateSnapshotId);
  if (!snap) throw new Error(`Snapshot ${pair.candidateSnapshotId} could not be reproduced from the frozen population/replay logic.`);

  return {
    experiment: { runId: dataLoader.RUN_ID, classification: 'CONFIRMATORY DATASET', note: 'Phase 4 real-model research collection — frozen, hash-locked, finalized.' },
    dataset: { datasetManifestHash: dataLoader.load().datasetManifest.datasetManifestHash },
    pair: { pairingKey: pair.pairingKey, condition: pair.condition },
    snapshot: {
      snapshotId: snap.snapshotId,
      provenanceMarker: snap.provenance.bitgetEndpoint,
      isLive: snap.provenance.isLive,
      disclosure: snap.provenance.disclosure,
      fields: [
        { path: 'symbol', classification: 'REAL', value: snap.symbol, note: 'Verbatim from the precondition study\'s captured historical record.' },
        { path: 'marketTimestampUtc', classification: 'REAL', value: snap.marketTimestampUtc, note: 'Verbatim from the precondition study.' },
        { path: 'price.last', classification: 'REAL', value: snap.price.last, note: 'Verbatim historical reference price.' },
        { path: 'price.bid / price.ask', classification: 'DERIVED', value: `${snap.price.bid} / ${snap.price.ask}`, note: 'Synthetic 0.1% spread computed around the real last price — never independently observed.' },
        { path: 'orderbook', classification: 'DERIVED', value: snap.orderbook, note: 'Single-level synthetic placeholder — the precondition study never captured real order-book depth.' },
        { path: 'volume', classification: 'DERIVED', value: snap.volume, note: 'Fixed zero placeholder — no real volume was captured.' },
        { path: 'candles', classification: 'DERIVED', value: snap.candles, note: 'Single flat synthetic candle derived from the real price — not a real OHLCV series.' },
        { path: 'marketStatus.underlyingNyseOpen', classification: 'DERIVED', value: snap.marketStatus.underlyingNyseOpen, note: 'Computed from the real timestamp\'s weekday/weekend classification, not an independently observed live NYSE feed.' },
      ],
    },
    claim: {
      classification: 'FIXTURE',
      id: pair.claimFixtureId,
      template: pair.claimTemplate,
      text: pair.claimText,
      note: 'Locked, hand-authored synthetic corpus fixture (cde/lib/corpus.js) — never presented as a real market event.',
    },
  };
}

module.exports = { provenanceFor };
