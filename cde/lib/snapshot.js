'use strict';
/**
 * Frozen market-snapshot contract.
 *
 * A snapshot is the ONLY thing a trial is allowed to treat as ground truth
 * about the market. It is never a live, mutable API response object — it is
 * a plain, deeply-frozen, content-addressed record. Two snapshots built
 * from identical market content always get the identical snapshotId,
 * whether captured live or replayed from storage — that is what makes an
 * experiment replayable: re-running against the same stored snapshot data
 * must be indistinguishable, at the trial level, from the original run.
 *
 * snapshotId is a hash of MARKET CONTENT ONLY (symbol, market timestamp,
 * price, orderbook, volume, candles, market status) — provenance fields
 * (which endpoint, when fetched, live-vs-replayed) are deliberately
 * excluded from the id so that re-fetching the same real market state
 * twice, or replaying it from storage, yields the same identity.
 */

const { contentHash } = require('./hash');
const { classifyCondition } = require('./conditions');

const REQUIRED_MARKET_FIELDS = ['symbol', 'marketTimestampUtc', 'price', 'orderbook', 'volume', 'candles', 'marketStatus'];
const REQUIRED_PROVENANCE_FIELDS = ['bitgetEndpoint', 'requestParams', 'capturedAtUtc', 'isLive'];

function deepFreeze(obj) {
  if (obj && typeof obj === 'object' && !Object.isFrozen(obj)) {
    Object.getOwnPropertyNames(obj).forEach((k) => deepFreeze(obj[k]));
    Object.freeze(obj);
  }
  return obj;
}

/**
 * Build an immutable snapshot from market content + provenance. Throws if
 * any required field is missing — a snapshot with silently-absent data is
 * exactly the "undocumented synthetic market evidence" this contract exists
 * to prevent.
 *
 * @param {object} market  { symbol, marketTimestampUtc, price, orderbook, volume, candles, marketStatus }
 * @param {object} provenance { bitgetEndpoint, requestParams, capturedAtUtc, isLive }
 */
function buildSnapshot(market, provenance) {
  for (const f of REQUIRED_MARKET_FIELDS) {
    if (!(f in market)) throw new Error(`Snapshot missing required market field: ${f}`);
  }
  for (const f of REQUIRED_PROVENANCE_FIELDS) {
    if (!(f in provenance)) throw new Error(`Snapshot missing required provenance field: ${f}`);
  }
  if (typeof provenance.isLive !== 'boolean') {
    throw new Error('provenance.isLive must be an explicit boolean (true=fetched live, false=replayed) — never left ambiguous');
  }

  const marketContent = {
    symbol: market.symbol,
    marketTimestampUtc: market.marketTimestampUtc,
    price: market.price,
    orderbook: market.orderbook,
    volume: market.volume,
    candles: market.candles,
    marketStatus: market.marketStatus,
  };

  const condition = classifyCondition(market.marketTimestampUtc);
  const snapshotId = contentHash(marketContent);

  const snapshot = {
    snapshotId,
    ...marketContent,
    condition, // derived from marketTimestampUtc via the real Bitget weekend schedule — never set independently
    provenance: { ...provenance, snapshotId },
  };

  return deepFreeze(snapshot);
}

/** Re-derive the content hash from a snapshot's own fields and compare — proves the object hasn't been mutated since creation. */
function verifySnapshotIntegrity(snapshot) {
  const marketContent = {
    symbol: snapshot.symbol,
    marketTimestampUtc: snapshot.marketTimestampUtc,
    price: snapshot.price,
    orderbook: snapshot.orderbook,
    volume: snapshot.volume,
    candles: snapshot.candles,
    marketStatus: snapshot.marketStatus,
  };
  return contentHash(marketContent) === snapshot.snapshotId;
}

module.exports = { buildSnapshot, verifySnapshotIntegrity, deepFreeze, REQUIRED_MARKET_FIELDS, REQUIRED_PROVENANCE_FIELDS };
