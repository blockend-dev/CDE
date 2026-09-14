'use strict';
/**
 * SYNTHETIC TEST FIXTURES — NOT EMPIRICAL BITGET DATA.
 *
 * Every value in this file is hand-authored and fixed. The symbol
 * ("RFIXTUSDT" / baseCoin "rFIXT") does not exist in Bitget's real
 * catalog, specifically so this data can never be mistaken for a real
 * market observation. provenance.bitgetEndpoint is prefixed "FIXTURE:" —
 * cde/phase1/fixtureLoader.js refuses to load anything without that
 * prefix, and refuses anything WITH it if used anywhere a real snapshot is
 * required. This file must never be presented as, or silently treated as,
 * evidence for the CDE hypothesis. It exists only to exercise the
 * deterministic execution harness end-to-end.
 *
 * Two snapshots, both built through the real cde/lib/snapshot.js contract
 * (same validation, same freezing, same content-hash identity rules as any
 * other snapshot) so the harness cannot tell fixture data apart from real
 * data by shape — only by the explicit FIXTURE: marker.
 */

const { buildSnapshot } = require('../../lib/snapshot');

const FIXTURE_SYMBOL = 'RFIXTUSDT';

function fixtureCandles(baseClose) {
  return [
    { ts: 1789995600000, open: baseClose - 2, high: baseClose - 0.5, low: baseClose - 2.5, close: baseClose - 1, baseVolume: 1000 },
    { ts: 1789999200000, open: baseClose - 1, high: baseClose + 0.5, low: baseClose - 1.2, close: baseClose, baseVolume: 1200 },
  ];
}

const WEEKDAY_SNAPSHOT = buildSnapshot(
  {
    symbol: FIXTURE_SYMBOL,
    marketTimestampUtc: '2026-09-11T15:00:00.000Z', // a Friday, mid-session — classifies as "weekday" via the real condition classifier
    price: { last: 100, bid: 99.9, ask: 100.1 },
    orderbook: { bids: [[99.9, 500]], asks: [[100.1, 500]], depthLevels: 5 },
    volume: { baseVolume: 50000, quoteVolume: 5000000, windowMinutes: 60 },
    candles: fixtureCandles(100),
    marketStatus: { underlyingNyseOpen: true, extendedSessionActive: false, sourceNote: 'synthetic fixture — not a real market read' },
  },
  {
    bitgetEndpoint: 'FIXTURE:synthetic-weekday-v1',
    requestParams: {},
    capturedAtUtc: '2026-09-11T15:00:00.000Z', // fixed, matches marketTimestampUtc by design — fixtures have no independent "capture time"
    isLive: false,
  }
);

const WEEKEND_SNAPSHOT = buildSnapshot(
  {
    symbol: FIXTURE_SYMBOL,
    marketTimestampUtc: '2026-09-19T12:00:00.000Z', // inside the real Sat 00:00Z-Mon 00:00Z (DST-era) Bitget weekend window — classifies as "weekend"
    price: { last: 100, bid: 99.5, ask: 100.5 }, // deliberately identical `last` to the weekday fixture and a WIDER synthetic spread, illustrating (not proving) the corroboration-quality distinction the harness is built to test
    orderbook: { bids: [[99.5, 80]], asks: [[100.5, 80]], depthLevels: 5 }, // thinner synthetic depth
    volume: { baseVolume: 4000, quoteVolume: 400000, windowMinutes: 60 }, // lower synthetic volume
    candles: fixtureCandles(100),
    marketStatus: { underlyingNyseOpen: false, extendedSessionActive: true, sourceNote: 'synthetic fixture — not a real market read' },
  },
  {
    bitgetEndpoint: 'FIXTURE:synthetic-weekend-v1',
    requestParams: {},
    capturedAtUtc: '2026-09-19T12:00:00.000Z',
    isLive: false,
  }
);

module.exports = { FIXTURE_SYMBOL, WEEKDAY_SNAPSHOT, WEEKEND_SNAPSHOT };
