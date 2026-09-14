'use strict';
/**
 * Pure computation layer — no network, no I/O. Every function here is
 * unit-tested against synthetic fixtures in selfTest.js so the statistics
 * can be trusted independently of whether real Bitget data was ever
 * obtained.
 */

/**
 * Core per-weekend metric, exactly as specified:
 *   frictionBaselineError = |Friday_ref - Monday_ref|
 *   weekendError          = |Weekend_end_price - Monday_ref|
 *   errorReduction        = 1 - (weekendError / frictionBaselineError)
 *   directionalHit        = sign(weekendEnd - Friday_ref) == sign(Monday_ref - Friday_ref)
 *
 * Division-by-zero and zero-move edge cases are handled explicitly and
 * flagged rather than silently producing Infinity/NaN or a fabricated hit/miss.
 */
function computeWeekendMetrics({ fridayRef, weekendEndPrice, mondayRef }) {
  if (![fridayRef, weekendEndPrice, mondayRef].every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return { valid: false, reason: 'missing_or_non_finite_price' };
  }

  const fridayBaselineError = Math.abs(fridayRef - mondayRef);
  const weekendError = Math.abs(weekendEndPrice - mondayRef);

  let errorReduction = null;
  let errorReductionUndefinedReason = null;
  if (fridayBaselineError === 0) {
    errorReductionUndefinedReason = 'friday_baseline_error_zero';
  } else {
    errorReduction = 1 - weekendError / fridayBaselineError;
  }

  const fridayToMondaySign = Math.sign(mondayRef - fridayRef);
  const fridayToWeekendSign = Math.sign(weekendEndPrice - fridayRef);
  let directionalHit = null;
  let directionalUndefinedReason = null;
  if (fridayToMondaySign === 0) {
    // Monday reopened exactly at Friday's reference price: "direction" is undefined,
    // not a free win for either the weekend price or the baseline.
    directionalUndefinedReason = 'no_net_move_friday_to_monday';
  } else {
    directionalHit = fridayToWeekendSign === fridayToMondaySign;
  }

  return {
    valid: true,
    fridayBaselineError,
    weekendError,
    errorReduction, // null if undefined
    errorReductionUndefinedReason,
    weekendBeatsFriday: fridayBaselineError === 0 ? null : weekendError < fridayBaselineError,
    directionalHit, // null if undefined
    directionalUndefinedReason,
  };
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(values) {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Aggregate a list of per-weekend metric records (output of
 * computeWeekendMetrics, each tagged with symbol/weekend identifiers) into
 * the summary statistics required by the precondition test. Records with
 * valid=false or an undefined errorReduction/directionalHit are excluded
 * from the relevant statistic, with the exclusion count reported explicitly
 * — never silently dropped.
 */
function aggregate(records) {
  const validRecords = records.filter((r) => r.metrics.valid);
  const invalidCount = records.length - validRecords.length;

  const errorReductions = validRecords
    .map((r) => r.metrics.errorReduction)
    .filter((v) => v !== null);
  const undefinedErrorReductionCount = validRecords.length - errorReductions.length;

  const beatsFriday = validRecords
    .map((r) => r.metrics.weekendBeatsFriday)
    .filter((v) => v !== null);

  const directionalCalls = validRecords
    .map((r) => r.metrics.directionalHit)
    .filter((v) => v !== null);
  const undefinedDirectionalCount = validRecords.length - directionalCalls.length;

  return {
    totalObservations: records.length,
    invalidObservations: invalidCount,
    validObservations: validRecords.length,
    medianFridayBaselineError: median(validRecords.map((r) => r.metrics.fridayBaselineError)),
    medianWeekendError: median(validRecords.map((r) => r.metrics.weekendError)),
    medianErrorReduction: median(errorReductions),
    meanErrorReduction: mean(errorReductions),
    errorReductionSampleSize: errorReductions.length,
    undefinedErrorReductionCount,
    pctWeekendBeatsFriday: beatsFriday.length ? beatsFriday.filter(Boolean).length / beatsFriday.length : null,
    beatsFridaySampleSize: beatsFriday.length,
    directionalAccuracy: directionalCalls.length ? directionalCalls.filter(Boolean).length / directionalCalls.length : null,
    directionalSampleSize: directionalCalls.length,
    undefinedDirectionalCount,
  };
}

/** Per-symbol breakdown, reusing aggregate() grouped by record.symbol. */
function aggregateBySymbol(records) {
  const bySymbol = new Map();
  for (const r of records) {
    if (!bySymbol.has(r.symbol)) bySymbol.set(r.symbol, []);
    bySymbol.get(r.symbol).push(r);
  }
  const out = {};
  for (const [symbol, recs] of bySymbol) {
    out[symbol] = aggregate(recs);
  }
  return out;
}

/**
 * Predeclared stratification rule: split completed weekends into terciles
 * by an INDEPENDENT volatility proxy that does not use the rToken's own
 * weekend or Monday price (to avoid circularity) — the realized 48h BTCUSDT
 * move magnitude over the same weekend window. This must be computed and
 * frozen BEFORE inspecting any rToken error-reduction results.
 *
 * `weekendVolatilityBySaturday` maps ISO date (UTC+8 Saturday) -> abs %
 * BTCUSDT move over that weekend window. Records without a matching entry
 * are excluded from the stratified (but not the overall) analysis.
 */
function stratifyByIndependentVolatility(records, weekendVolatilityBySaturday) {
  const withVol = records
    .map((r) => ({ r, vol: weekendVolatilityBySaturday.get(r.saturdayIso) }))
    .filter((x) => typeof x.vol === 'number' && Number.isFinite(x.vol));

  const excluded = records.length - withVol.length;
  if (withVol.length < 3) {
    return { applicable: false, reason: 'insufficient_matched_volatility_observations', excluded };
  }

  const sortedVols = [...withVol].sort((a, b) => a.vol - b.vol);
  const n = sortedVols.length;
  const cut1 = Math.floor(n / 3);
  const cut2 = Math.floor((2 * n) / 3);

  const quiet = sortedVols.slice(0, cut1).map((x) => x.r);
  const moderate = sortedVols.slice(cut1, cut2).map((x) => x.r);
  const volatile = sortedVols.slice(cut2).map((x) => x.r);

  return {
    applicable: true,
    excluded,
    quiet: aggregate(quiet),
    moderate: aggregate(moderate),
    volatile: aggregate(volatile),
    quietCount: quiet.length,
    moderateCount: moderate.length,
    volatileCount: volatile.length,
  };
}

module.exports = {
  computeWeekendMetrics,
  aggregate,
  aggregateBySymbol,
  stratifyByIndependentVolatility,
  median,
  mean,
};
