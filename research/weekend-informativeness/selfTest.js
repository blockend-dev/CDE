'use strict';
/**
 * Pure, network-free self-test. Proves the analysis math and calendar
 * arithmetic are correct against hand-computed fixtures, independent of
 * whether real Bitget data was ever obtained. Run with: node selfTest.js
 * Exits non-zero on any failed assertion.
 */

const assert = require('assert');
const {
  computeWeekendMetrics,
  aggregate,
  stratifyByIndependentVolatility,
} = require('./analysis');
const {
  nyseHolidays,
  isNyseHoliday,
  isNyseTradingDay,
  nextNyseTradingDay,
  isoDate,
} = require('./nyseCalendar');
const { weekendBoundsForSaturdayUTC8, enumerateCompletedWeekends } = require('./weekendSchedule');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (e) {
    failures += 1;
    console.error(`FAIL  ${name}\n      ${e.message}`);
  }
}

console.log('== analysis.js: computeWeekendMetrics ==');

check('normal case: weekend price closer to Monday than Friday', () => {
  const m = computeWeekendMetrics({ fridayRef: 100, weekendEndPrice: 108, mondayRef: 110 });
  assert.strictEqual(m.valid, true);
  assert.strictEqual(m.fridayBaselineError, 10);
  assert.strictEqual(m.weekendError, 2);
  assert.ok(Math.abs(m.errorReduction - 0.8) < 1e-9, `errorReduction=${m.errorReduction}`);
  assert.strictEqual(m.directionalHit, true);
  assert.strictEqual(m.weekendBeatsFriday, true);
});

check('adversarial case: weekend price WORSE than naive Friday-held baseline', () => {
  const m = computeWeekendMetrics({ fridayRef: 100, weekendEndPrice: 95, mondayRef: 105 });
  assert.strictEqual(m.fridayBaselineError, 5);
  assert.strictEqual(m.weekendError, 10);
  assert.ok(Math.abs(m.errorReduction - -1) < 1e-9, `errorReduction=${m.errorReduction}`);
  assert.strictEqual(m.directionalHit, false);
  assert.strictEqual(m.weekendBeatsFriday, false);
});

check('degenerate case: Friday == Monday (zero net move) is flagged undefined, not scored', () => {
  const m = computeWeekendMetrics({ fridayRef: 100, weekendEndPrice: 105, mondayRef: 100 });
  assert.strictEqual(m.errorReduction, null);
  assert.strictEqual(m.errorReductionUndefinedReason, 'friday_baseline_error_zero');
  assert.strictEqual(m.directionalHit, null);
  assert.strictEqual(m.directionalUndefinedReason, 'no_net_move_friday_to_monday');
});

check('perfect case: weekend price exactly predicts Monday', () => {
  const m = computeWeekendMetrics({ fridayRef: 100, weekendEndPrice: 120, mondayRef: 120 });
  assert.strictEqual(m.errorReduction, 1);
  assert.strictEqual(m.directionalHit, true);
});

check('missing data is flagged invalid, never coerced to a number', () => {
  const m = computeWeekendMetrics({ fridayRef: 100, weekendEndPrice: NaN, mondayRef: 110 });
  assert.strictEqual(m.valid, false);
  assert.strictEqual(m.reason, 'missing_or_non_finite_price');
});

console.log('== analysis.js: aggregate ==');

check('aggregate over mixed valid/invalid/degenerate records matches hand computation', () => {
  const records = [
    { symbol: 'rTEST', saturdayIso: '2026-01-03', metrics: computeWeekendMetrics({ fridayRef: 100, weekendEndPrice: 108, mondayRef: 110 }) },
    { symbol: 'rTEST', saturdayIso: '2026-01-10', metrics: computeWeekendMetrics({ fridayRef: 100, weekendEndPrice: 95, mondayRef: 105 }) },
    { symbol: 'rTEST', saturdayIso: '2026-01-17', metrics: computeWeekendMetrics({ fridayRef: 100, weekendEndPrice: 105, mondayRef: 100 }) },
    { symbol: 'rTEST', saturdayIso: '2026-01-24', metrics: computeWeekendMetrics({ fridayRef: 100, weekendEndPrice: 120, mondayRef: 120 }) },
    { symbol: 'rTEST', saturdayIso: '2026-01-31', metrics: computeWeekendMetrics({ fridayRef: 100, weekendEndPrice: NaN, mondayRef: 110 }) },
  ];
  const agg = aggregate(records);
  assert.strictEqual(agg.totalObservations, 5);
  assert.strictEqual(agg.invalidObservations, 1);
  assert.strictEqual(agg.validObservations, 4);
  assert.strictEqual(agg.errorReductionSampleSize, 3); // one degenerate excluded
  assert.strictEqual(agg.undefinedErrorReductionCount, 1);
  assert.ok(Math.abs(agg.medianErrorReduction - 0.8) < 1e-9, `median=${agg.medianErrorReduction}`);
  assert.ok(Math.abs(agg.meanErrorReduction - (0.8 - 1 + 1) / 3) < 1e-9, `mean=${agg.meanErrorReduction}`);
  assert.strictEqual(agg.beatsFridaySampleSize, 3);
  assert.ok(Math.abs(agg.pctWeekendBeatsFriday - 2 / 3) < 1e-9);
  assert.strictEqual(agg.directionalSampleSize, 3);
  assert.ok(Math.abs(agg.directionalAccuracy - 2 / 3) < 1e-9);
});

console.log('== analysis.js: stratifyByIndependentVolatility ==');

check('predeclared tercile split by an independent (non-circular) volatility proxy', () => {
  const records = Array.from({ length: 9 }, (_, i) => ({
    symbol: 'rTEST',
    saturdayIso: `2026-0${1 + Math.floor(i / 4)}-0${1 + (i % 4) * 7 || 1}`,
    metrics: computeWeekendMetrics({ fridayRef: 100, weekendEndPrice: 100 + i, mondayRef: 110 }),
  }));
  const volMap = new Map(records.map((r, i) => [r.saturdayIso, i])); // strictly increasing "volatility"
  const strat = stratifyByIndependentVolatility(records, volMap);
  assert.strictEqual(strat.applicable, true);
  assert.strictEqual(strat.quietCount, 3);
  assert.strictEqual(strat.moderateCount, 3);
  assert.strictEqual(strat.volatileCount, 3);
});

check('stratification correctly refuses when too few matched observations', () => {
  const records = [
    { symbol: 'rTEST', saturdayIso: '2026-01-03', metrics: computeWeekendMetrics({ fridayRef: 100, weekendEndPrice: 108, mondayRef: 110 }) },
  ];
  const strat = stratifyByIndependentVolatility(records, new Map([['2026-01-03', 1]]));
  assert.strictEqual(strat.applicable, false);
  assert.strictEqual(strat.reason, 'insufficient_matched_volatility_observations');
});

console.log('== nyseCalendar.js: 2026 holiday rules (hand-verified) ==');

check('2026 fixed-date holidays land where independently computed', () => {
  const h = nyseHolidays(2026);
  // Hand-computed via day-of-year arithmetic against Jan 1 2026 = Thursday.
  assert.ok(h.has('2026-01-01'), 'New Year\'s Day (Thu, no shift)');
  assert.ok(h.has('2026-01-19'), 'MLK Day = 3rd Monday of Jan');
  assert.ok(h.has('2026-02-16'), 'Presidents Day = 3rd Monday of Feb');
  assert.ok(h.has('2026-04-03'), 'Good Friday (Easter Sunday 2026 = Apr 5 via Meeus algorithm)');
  assert.ok(h.has('2026-05-25'), 'Memorial Day = last Monday of May');
  assert.ok(h.has('2026-06-19'), 'Juneteenth (Fri, no shift)');
  assert.ok(h.has('2026-07-03'), 'Independence Day observed (Jul 4 is a Saturday -> observed Friday)');
  assert.ok(h.has('2026-09-07'), 'Labor Day = 1st Monday of Sept');
  assert.ok(h.has('2026-11-26'), 'Thanksgiving = 4th Thursday of Nov');
  assert.ok(h.has('2026-12-25'), 'Christmas (Fri, no shift)');
  assert.strictEqual(h.size, 10);
});

check('isNyseTradingDay correctly excludes both weekends and holidays', () => {
  assert.strictEqual(isNyseTradingDay(new Date('2026-07-03T00:00:00Z')), false); // observed July 4th holiday
  assert.strictEqual(isNyseTradingDay(new Date('2026-07-04T00:00:00Z')), false); // Saturday
  assert.strictEqual(isNyseTradingDay(new Date('2026-07-06T00:00:00Z')), true); // Monday, ordinary trading day
});

check('nextNyseTradingDay skips a Monday holiday to Tuesday (Labor Day 2026)', () => {
  const fridayBeforeLaborDay = new Date('2026-09-04T00:00:00Z'); // Friday
  const next = nextNyseTradingDay(fridayBeforeLaborDay);
  assert.strictEqual(isoDate(next), '2026-09-08', 'Sat 9/5, Sun 9/6, Labor Day Mon 9/7 all skipped -> Tue 9/8');
});

console.log('== weekendSchedule.js: Bitget weekend boundary ==');

check('DST-era weekend (Sept 2026) uses 08:00 UTC+8 boundary', () => {
  const saturday = new Date('2026-09-19T00:00:00Z'); // Sept 19 2026 UTC+8 calendar Saturday
  const { weekendStartUTC, weekendEndUTC } = weekendBoundsForSaturdayUTC8(saturday);
  // 08:00 UTC+8 == 00:00 UTC
  assert.strictEqual(weekendStartUTC.toISOString(), '2026-09-19T00:00:00.000Z');
  assert.strictEqual(weekendEndUTC.toISOString(), '2026-09-21T00:00:00.000Z');
});

check('standard-time weekend (Dec 2026) uses 09:00 UTC+8 boundary', () => {
  const saturday = new Date('2026-12-05T00:00:00Z');
  const { weekendStartUTC, weekendEndUTC } = weekendBoundsForSaturdayUTC8(saturday);
  // 09:00 UTC+8 == 01:00 UTC
  assert.strictEqual(weekendStartUTC.toISOString(), '2026-12-05T01:00:00.000Z');
  assert.strictEqual(weekendEndUTC.toISOString(), '2026-12-07T01:00:00.000Z');
});

check('enumerateCompletedWeekends never includes a partially-elapsed weekend', () => {
  // "Now" is mid-way through the Sept 26-28 2026 weekend -> only Sept 19-21 is completed.
  const from = new Date('2026-06-13T00:00:00Z'); // first Saturday at/after rToken launch (2026-06-02)
  const to = new Date('2026-09-27T04:00:00Z'); // Sunday, inside the second weekend window
  const weekends = enumerateCompletedWeekends(from, to);
  const last = weekends[weekends.length - 1];
  assert.ok(last.weekendEndUTC <= to, 'last enumerated weekend must be fully completed');
  assert.strictEqual(isoDate(last.saturdayUTC8), '2026-09-19');
});

console.log(`\n${failures === 0 ? 'ALL SELF-TESTS PASSED' : `${failures} SELF-TEST(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
