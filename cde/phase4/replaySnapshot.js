'use strict';
/**
 * Builds a single CDE snapshot from one precondition-study record
 * (research/weekend-informativeness/output/raw_dataset.json) — never from
 * a live Bitget call. Uses cde/lib/snapshot.js: buildSnapshot() directly,
 * so condition derivation, content-addressing, and freezing are all the
 * SAME code Phase 1/2 already use — nothing about snapshot identity is
 * reimplemented here.
 *
 * HONESTY BOUNDARY (per the resolved Phase 4 methodology question):
 *   REAL:    symbol, marketTimestampUtc, price.last — taken verbatim from
 *            the precondition study's already-captured, immutable
 *            historical data.
 *   DERIVED: orderbook, volume, the single-point candle entry — the
 *            precondition study never captured order-book depth or full
 *            OHLCV candles, so these are minimal, clearly-labeled
 *            placeholders (a fixed small synthetic spread, zero volume),
 *            never presented as independently observed.
 * This split is recorded both in provenance (audit-only) and, briefly and
 * non-leakingly, in marketStatus.sourceNote (the one field the model
 * itself sees via get_market_status) — consistent with Phase 1's fixture
 * precedent of a short model-visible sourceNote.
 */

const { buildSnapshot } = require('../lib/snapshot');

const REPLAY_ENDPOINT_MARKER = 'REPLAY:research/weekend-informativeness/output/raw_dataset.json';
const DERIVED_SPREAD_FRACTION = 0.001; // 0.1% each side — same convention as cde/phase1/fixtures/syntheticSnapshots.js

function fieldsFor(record, condition) {
  if (condition === 'weekday') {
    return { price: record.observation.fridayRef, ts: record.observation.fridayCandleTs, sourceField: 'fridayRef' };
  }
  if (condition === 'weekend') {
    return { price: record.observation.weekendEndPrice, ts: record.observation.weekendEndCandleTs, sourceField: 'weekendEndPrice' };
  }
  throw new Error(`buildReplaySnapshot: unknown condition "${condition}" — must be "weekday" or "weekend".`);
}

/**
 * @param {object} record one entry from raw_dataset.json (must have metrics.valid === true — checked by the caller, population.js)
 * @param {'weekday'|'weekend'} condition which real reference point to use
 */
function buildReplaySnapshot(record, condition) {
  const { price, ts, sourceField } = fieldsFor(record, condition);
  if (typeof price !== 'number' || !Number.isFinite(price) || typeof ts !== 'number' || !Number.isFinite(ts)) {
    throw new Error(
      `Precondition record ${record.symbol}/${record.saturdayIso} is missing real ${sourceField}/timestamp data for condition "${condition}" ` +
        'despite being marked valid — refusing to fabricate a value.'
    );
  }

  const marketTimestampUtc = new Date(ts).toISOString();
  const spread = price * DERIVED_SPREAD_FRACTION;
  const bid = price - spread / 2;
  const ask = price + spread / 2;

  const market = {
    symbol: record.symbol,
    marketTimestampUtc,
    price: { last: price, bid, ask },
    orderbook: { bids: [[bid, 100]], asks: [[ask, 100]], depthLevels: 1 },
    volume: { baseVolume: 0, quoteVolume: 0, windowMinutes: 0 },
    candles: [{ ts, open: price, high: price, low: price, close: price, baseVolume: 0 }],
    marketStatus: {
      underlyingNyseOpen: condition === 'weekday',
      extendedSessionActive: condition === 'weekend',
      sourceNote: 'price derived from historical reference data; depth and volume are placeholders, not independently observed',
    },
  };

  const provenance = {
    bitgetEndpoint: REPLAY_ENDPOINT_MARKER,
    requestParams: { symbol: record.symbol, saturdayIso: record.saturdayIso, condition, sourceField },
    capturedAtUtc: marketTimestampUtc,
    isLive: false,
    disclosure:
      'price.last, symbol, and marketTimestampUtc are REAL historical Bitget data captured by the ' +
      'research/weekend-informativeness precondition study (immutable, already audited). orderbook, volume, ' +
      'and the single-point candles entry are MINIMALLY DERIVED placeholders (fixed synthetic spread, zero ' +
      'volume) because that study did not capture order-book depth or full OHLCV candles — never presented as independently real.',
  };

  return buildSnapshot(market, provenance);
}

module.exports = { buildReplaySnapshot, REPLAY_ENDPOINT_MARKER, DERIVED_SPREAD_FRACTION };
