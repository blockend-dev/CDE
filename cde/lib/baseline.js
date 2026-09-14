'use strict';
/**
 * Claim-blind deterministic baseline — the falsification control.
 *
 * The whole point of this baseline is that its Clean-vs-Injected decision
 * delta is trivially zero BY CONSTRUCTION, not by hoping a rule "happens"
 * to ignore the claim. That means the baseline function must be physically
 * incapable of receiving claim text, not merely written to ignore it.
 *
 * Enforcement has two independent layers:
 *   1. toMarketOnlyView() is a WHITELIST extractor — it builds a brand new
 *      object containing only the explicitly-permitted market fields. A
 *      claim field on the source snapshot/trial input is never copied,
 *      structurally, regardless of what the source object also contains.
 *   2. assertNoClaimFields() is a runtime guard, checked at the top of
 *      claimBlindBaseline() itself, that throws if anything claim-shaped
 *      slips in anyway (defense in depth against a future refactor
 *      accidentally widening the whitelist).
 */

const PERMITTED_MARKET_KEYS = Object.freeze(['price', 'orderbook', 'volume', 'candles']);
const FORBIDDEN_KEY_PATTERN = /claim|rumor|injected|headline|news|assessment/i;

/** Whitelist extraction: builds a new object from ONLY the permitted keys. */
function toMarketOnlyView(snapshot) {
  const view = {};
  for (const key of PERMITTED_MARKET_KEYS) {
    view[key] = snapshot[key];
  }
  return Object.freeze(view);
}

function assertNoClaimFields(input) {
  const keys = Object.keys(input);
  const offending = keys.filter((k) => FORBIDDEN_KEY_PATTERN.test(k));
  if (offending.length > 0) {
    throw new Error(`claimBlindBaseline received claim-shaped field(s): ${offending.join(', ')} — refusing to run`);
  }
  const extra = keys.filter((k) => !PERMITTED_MARKET_KEYS.includes(k));
  if (extra.length > 0) {
    throw new Error(`claimBlindBaseline received unexpected field(s) outside the permitted market whitelist: ${extra.join(', ')}`);
  }
}

/**
 * Deterministic, claim-blind decision rule. Uses ONLY price/volume/orderbook
 * signals. Fixed, documented thresholds — not tuned against any experiment
 * output (see cde/METHODOLOGY.md, "do not tune against results").
 *
 * Rule (frozen for Phase 0; deliberately simple — this is a falsification
 * control, not a strategy to optimize): compare the latest close to the
 * volume-weighted average of the provided candle window; go long if price
 * is meaningfully above that VWAP with above-median recent volume, short if
 * meaningfully below, else neutral. None of this depends on any claim.
 */
function claimBlindBaseline(marketOnlyView) {
  assertNoClaimFields(marketOnlyView);
  const { price, candles } = marketOnlyView;

  if (!candles || candles.length === 0 || !price || typeof price.last !== 'number') {
    return { direction: 'neutral', exposure: 0, confidence: 0, rationaleSummary: 'insufficient market data' };
  }

  let num = 0;
  let den = 0;
  for (const c of candles) {
    const v = c.baseVolume || 0;
    num += c.close * v;
    den += v;
  }
  const vwap = den > 0 ? num / den : candles[candles.length - 1].close;
  const deviation = vwap === 0 ? 0 : (price.last - vwap) / vwap;

  const THRESHOLD = 0.005; // 0.5% — fixed, documented, not tuned post-hoc
  let direction = 'neutral';
  if (deviation > THRESHOLD) direction = 'long';
  else if (deviation < -THRESHOLD) direction = 'short';

  const exposure = Math.max(-1, Math.min(1, deviation / (THRESHOLD * 4)));
  const confidence = Math.min(1, Math.abs(deviation) / (THRESHOLD * 4));

  return { direction, exposure, confidence, rationaleSummary: `vwap_deviation=${deviation.toFixed(5)}` };
}

/** Convenience: run the baseline directly on a full snapshot (does the whitelist extraction internally). */
function runBaselineOnSnapshot(snapshot) {
  return claimBlindBaseline(toMarketOnlyView(snapshot));
}

module.exports = { toMarketOnlyView, assertNoClaimFields, claimBlindBaseline, runBaselineOnSnapshot, PERMITTED_MARKET_KEYS };
