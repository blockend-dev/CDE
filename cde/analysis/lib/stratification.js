'use strict';
/**
 * Exploratory-only stratification — ANALYSIS_PLAN.md §11. Re-implements
 * the SAME procedure as research/weekend-informativeness/analysis.js's
 * stratifyByIndependentVolatility (independent volatility proxy, tercile
 * split, refuse-if-too-few) for CDE's own pair-record shape. Does NOT
 * import fixed numeric thresholds from that study — terciles are always
 * computed fresh from whatever volatility values are supplied here.
 *
 * This module does no data fetching — the caller supplies the volatility
 * proxy value per pair (e.g. realized BTCUSDT move over the pair's
 * snapshot window), keeping this module a pure function with no network
 * dependency, consistent with the rest of cde/analysis/.
 */

const { injectedDelta } = require('../../lib/metrics');
const { mean } = require('./resampling');

const MIN_OBSERVATIONS_PER_CELL = 10;
const STRATUM_NAMES = ['quiet', 'moderate', 'volatile'];

/**
 * @param {object[]} weekdayPairs
 * @param {object[]} weekendPairs
 * @param {Map<string, number>} volatilityByPairingKey independent proxy value per pair, keyed by pairingKey
 */
function computeExploratoryStratification(weekdayPairs, weekendPairs, volatilityByPairingKey) {
  const withVol = (pairs, condition) =>
    pairs
      .map((p) => ({ pair: p, condition, vol: volatilityByPairingKey.get(p.pairingKey) }))
      .filter((x) => typeof x.vol === 'number' && Number.isFinite(x.vol));

  const all = [...withVol(weekdayPairs, 'weekday'), ...withVol(weekendPairs, 'weekend')];
  const excludedForMissingVolatility = weekdayPairs.length + weekendPairs.length - all.length;

  if (all.length < STRATUM_NAMES.length) {
    return { applicable: false, reason: 'insufficient_matched_volatility_observations', excludedForMissingVolatility };
  }

  const sorted = [...all].sort((a, b) => a.vol - b.vol);
  const n = sorted.length;
  const cut1 = Math.floor(n / 3);
  const cut2 = Math.floor((2 * n) / 3);
  const buckets = { quiet: sorted.slice(0, cut1), moderate: sorted.slice(cut1, cut2), volatile: sorted.slice(cut2) };

  const strata = {};
  for (const name of STRATUM_NAMES) {
    const items = buckets[name];
    const weekday = items.filter((x) => x.condition === 'weekday');
    const weekend = items.filter((x) => x.condition === 'weekend');
    const reportable = weekday.length >= MIN_OBSERVATIONS_PER_CELL && weekend.length >= MIN_OBSERVATIONS_PER_CELL;
    strata[name] = {
      reportable,
      weekdayN: weekday.length,
      weekendN: weekend.length,
      ...(reportable
        ? {
            weekdayMeanExposureDelta: mean(weekday.map((x) => injectedDelta(x.pair.clean.decision, x.pair.injected.decision).exposureDelta)),
            weekendMeanExposureDelta: mean(weekend.map((x) => injectedDelta(x.pair.clean.decision, x.pair.injected.decision).exposureDelta)),
          }
        : { note: `below the pre-declared minimum of ${MIN_OBSERVATIONS_PER_CELL} observations per cell — not reported` }),
    };
  }

  return { applicable: true, excludedForMissingVolatility, minObservationsPerCell: MIN_OBSERVATIONS_PER_CELL, strata, note: 'Exploratory/descriptive only — no significance test is computed per stratum.' };
}

module.exports = { computeExploratoryStratification, MIN_OBSERVATIONS_PER_CELL, STRATUM_NAMES };
