'use strict';
/**
 * Orchestrator for the weekend-informativeness precondition test.
 *
 * Pipeline: enumerate rToken symbols -> infer listing dates empirically ->
 * enumerate every COMPLETED Bitget weekend per symbol -> fetch Friday
 * reference / weekend-end observation / Monday post-reopen reference ->
 * compute metrics (analysis.js) -> write raw dataset + summary.
 *
 * This script requires real network access to api.bitget.com. It has been
 * written to run correctly in an environment that has it. In THIS sandbox,
 * api.bitget.com is unreachable (DNS resolution fails — see README
 * "Verification status"), so running this here produces a documented
 * BLOCKED report, not fabricated numbers. Any failed network call is
 * caught, logged with its real error, and surfaces as an explicit blocker
 * in the output rather than a crash or a silently-substituted value.
 */

const fs = require('fs');
const path = require('path');
const { BitgetClient } = require('./bitgetClient');
const { isNyseTradingDay, nextNyseTradingDay, isUsDst, isoDate } = require('./nyseCalendar');
const { enumerateCompletedWeekends } = require('./weekendSchedule');
const { computeWeekendMetrics, aggregate, aggregateBySymbol, stratifyByIndependentVolatility } = require('./analysis');

const OUT_DIR = path.join(__dirname, 'output');

// --- config, all fixed BEFORE inspecting any result -----------------------

const RTOKEN_LAUNCH_FLOOR = new Date('2026-01-01T00:00:00Z'); // scan floor; real listing dates are inferred per-symbol, not assumed
const ANALYSIS_HORIZON_END = new Date(); // "now" at run time
// NOTE: Bitget's actual accepted granularity strings (confirmed empirically
// against a live error response, since documentation snippets found during
// research incorrectly implied "1H"/"1D") are lowercase: 1min,3min,5min,
// 15min,30min,1h,4h,6h,12h,1day,1week,1M (plus *utc variants).
const FRIDAY_REF_GRANULARITY = '1h';
const WEEKEND_END_GRANULARITY = '1h';
const MONDAY_VWAP_GRANULARITY = '1min';
const MONDAY_VWAP_WINDOW_MINUTES = 30; // first 30 minutes of the NYSE regular session — predeclared (see README)
const BTC_SYMBOL = 'BTCUSDT'; // independent volatility proxy for stratification, per analysis.js

function etOpenUtc(nyseTradingDayUTC) {
  // 9:30 AM ET regular-session open, expressed in UTC. ET = UTC-4 during US
  // DST, UTC-5 standard time — the same US DST convention used throughout.
  const dst = isUsDst(nyseTradingDayUTC);
  const offsetHours = dst ? 4 : 5;
  return new Date(nyseTradingDayUTC.getTime() + (9 * 60 + 30 + offsetHours * 60) * 60 * 1000);
}

function lastCandleAtOrBefore(candles, tsMs) {
  let best = null;
  for (const c of candles) {
    if (c.ts <= tsMs && (best === null || c.ts > best.ts)) best = c;
  }
  return best;
}

function vwap(candles) {
  let num = 0;
  let den = 0;
  for (const c of candles) {
    const vol = c.baseVolume || 0;
    num += c.close * vol;
    den += vol;
  }
  if (den === 0) return candles.length ? candles[candles.length - 1].close : null; // fallback: last close if no volume reported
  return num / den;
}

/**
 * Fallback ONLY: empirically infer a symbol's first available candle
 * timestamp when the API's own `openTime` field is missing. Not the
 * primary method — see main() — because it needs its own network call and
 * `openTime` (verified present on every sampled rToken row) is a more
 * direct, authoritative source.
 */
async function inferListingDate(client, symbol) {
  const candles = await client.getHistoryCandles(symbol, '1day', RTOKEN_LAUNCH_FLOOR.getTime(), Date.now(), { limit: 1000 });
  if (candles.length === 0) return null;
  return new Date(candles[0].ts);
}

/** Concurrency-limited map, used for cross-symbol parallelism (see header note on latency). */
async function mapConcurrent(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * Cheap screening check: does this symbol show ANY real trading activity
 * (a non-empty candle set) during the single most recent completed
 * weekend? rToken weekend-trading support was rolled out to Bitget's
 * catalog gradually, symbol by symbol (documented growth: 20 -> 61 -> 93+
 * symbols across mid-2026) — most of the ~1,650 general rToken listings are
 * NOT weekend-tradable at all. This check exists purely so the full pull
 * below doesn't spend 15+ weekends' worth of calls on ~1,500 symbols that
 * would return empty data for every single one of them. It is applied
 * identically to every symbol before any result is inspected, so it is a
 * cost-saving filter, not a result-driven exclusion — and any symbol that
 * passes still gets its FULL weekend history pulled and every non-empty
 * weekend counted, not just the one checked here.
 */
async function hasRecentWeekendActivity(client, symbol, mostRecentWeekend) {
  const candles = await client.getHistoryCandles(
    symbol,
    WEEKEND_END_GRANULARITY,
    mostRecentWeekend.weekendStartUTC.getTime(),
    mostRecentWeekend.weekendEndUTC.getTime(),
    {}
  );
  return candles.length > 0;
}

async function fetchWeekendObservation(client, symbol, weekend) {
  const { weekendStartUTC, weekendEndUTC } = weekend;
  const fridayWindowStart = weekendStartUTC.getTime() - 6 * 3600 * 1000; // look back up to 6h for the last real weekday print
  const friday1h = await client.getHistoryCandles(symbol, FRIDAY_REF_GRANULARITY, fridayWindowStart, weekendStartUTC.getTime(), {});
  const fridayCandle = lastCandleAtOrBefore(friday1h, weekendStartUTC.getTime() - 1);

  // Full-window fetch (not just a lookback tail) so we can distinguish
  // "weekend trading wasn't enabled yet for this symbol at this date" (zero
  // candles across the ENTIRE weekend) from ordinary missing-data gaps.
  const weekendFull = await client.getHistoryCandles(symbol, WEEKEND_END_GRANULARITY, weekendStartUTC.getTime(), weekendEndUTC.getTime(), {});
  const weekendTradingInactive = weekendFull.length === 0;
  const weekendEndCandle = lastCandleAtOrBefore(weekendFull, weekendEndUTC.getTime() - 1);

  const mondayCalendarDate = new Date(Date.UTC(weekendEndUTC.getUTCFullYear(), weekendEndUTC.getUTCMonth(), weekendEndUTC.getUTCDate()));
  let mondayTradingDay = mondayCalendarDate;
  let mondayHolidayShift = false;
  if (!isNyseTradingDay(mondayTradingDay)) {
    mondayTradingDay = nextNyseTradingDay(new Date(mondayTradingDay.getTime() - 24 * 3600 * 1000));
    mondayHolidayShift = true;
  }
  const openUtc = etOpenUtc(mondayTradingDay);
  const vwapEndUtc = new Date(openUtc.getTime() + MONDAY_VWAP_WINDOW_MINUTES * 60 * 1000);
  const mondayMinuteCandles = await client.getHistoryCandles(symbol, MONDAY_VWAP_GRANULARITY, openUtc.getTime(), vwapEndUtc.getTime(), {});
  const mondayRef = mondayMinuteCandles.length ? vwap(mondayMinuteCandles) : null;

  return {
    fridayRef: fridayCandle ? fridayCandle.close : null,
    fridayCandleTs: fridayCandle ? fridayCandle.ts : null,
    weekendEndPrice: weekendEndCandle ? weekendEndCandle.close : null,
    weekendEndCandleTs: weekendEndCandle ? weekendEndCandle.ts : null,
    weekendCandleCount: weekendFull.length,
    weekendTradingInactive, // true = zero candles across the WHOLE weekend window (not yet weekend-enabled), distinct from a partial gap
    mondayRef,
    mondayRefCandleCount: mondayMinuteCandles.length,
    mondayTradingDayIso: isoDate(mondayTradingDay),
    mondayHolidayShift,
    missingDataFlags: {
      friday: !fridayCandle,
      weekendEnd: !weekendEndCandle,
      monday: mondayMinuteCandles.length === 0,
    },
  };
}

async function fetchBtcWeekendVolatility(client, weekend) {
  const { weekendStartUTC, weekendEndUTC } = weekend;
  const candles = await client.getHistoryCandles(BTC_SYMBOL, '1h', weekendStartUTC.getTime(), weekendEndUTC.getTime(), {});
  if (candles.length < 2) return null;
  const start = candles[0].close;
  const end = candles[candles.length - 1].close;
  return Math.abs(end - start) / start;
}

// App-level worker counts; actual request pacing is enforced centrally by
// BitgetClient's RateGate (see bitgetClient.js), so these just need to be
// >= the client's own maxConcurrent to keep the gate saturated.
const SYMBOL_SCREEN_CONCURRENCY = 8;
const SYMBOL_PULL_CONCURRENCY = 8;

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const client = new BitgetClient();

  console.log('Step 1/6: enumerating spot symbols and identifying rTokens...');
  const allSymbols = await client.getSpotSymbols(); // throws here if api.bitget.com is unreachable
  // VERIFIED against the live schema (2026-09-18): rToken identity lives in
  // `baseCoin` (e.g. "rAAPL"), not `symbol` (e.g. "RAAPLUSDT") — see
  // bitgetClient.js header note for how the original ^r[A-Z] filter on the
  // wrong field silently produced zero matches on the first real run.
  const rTokenRows = allSymbols.filter(
    (s) => typeof s.baseCoin === 'string' && /^r[A-Z]/.test(s.baseCoin) && s.quoteCoin === 'USDT'
  );
  const delistedCount = rTokenRows.filter((s) => s.offTime && s.offTime !== '' && s.offTime !== '0').length;
  const candidates = rTokenRows
    .filter((s) => s.status === 'online')
    .map((s) => {
      let listedAt = null;
      if (s.openTime && !Number.isNaN(Number(s.openTime)) && Number(s.openTime) > 0) {
        listedAt = new Date(Number(s.openTime));
      }
      return { symbol: s.symbol, baseCoin: s.baseCoin, listedAt, openTimeSource: listedAt ? 'api_openTime' : 'missing' };
    });

  console.log(
    `rToken rows: ${rTokenRows.length} total (quote=USDT), ${delistedCount} flagged delisted (offTime set), ` +
      `${candidates.length} online with a usable openTime.`
  );

  console.log('Step 2/6: inferring listing dates for any symbol missing openTime (fallback path)...');
  const missingOpenTime = candidates.filter((c) => c.listedAt === null);
  if (missingOpenTime.length > 0) {
    await mapConcurrent(missingOpenTime, SYMBOL_SCREEN_CONCURRENCY, async (c) => {
      c.listedAt = await inferListingDate(client, c.symbol);
      c.openTimeSource = c.listedAt ? 'inferred_from_candles' : 'unresolved';
    });
  }
  const eligible = candidates.filter((c) => c.listedAt !== null);
  console.log(`${eligible.length} symbols have a resolved listing date and are eligible for screening.`);

  console.log('Step 3/6: screening each eligible symbol for weekend-trading activity (most recent completed weekend only — see run.js comment on why)...');
  const mostRecentWeekend = enumerateCompletedWeekends(RTOKEN_LAUNCH_FLOOR, ANALYSIS_HORIZON_END).slice(-1)[0];
  if (!mostRecentWeekend) throw new Error('No completed Bitget weekend found in the configured horizon.');
  console.log(`  Most recent completed weekend: Saturday ${isoDate(mostRecentWeekend.saturdayUTC8)} (${mostRecentWeekend.weekendStartUTC.toISOString()} -> ${mostRecentWeekend.weekendEndUTC.toISOString()})`);

  const screenResults = await mapConcurrent(eligible, SYMBOL_SCREEN_CONCURRENCY, async (c) => {
    const active = await hasRecentWeekendActivity(client, c.symbol, mostRecentWeekend);
    return { ...c, weekendActiveNow: active };
  });
  const weekendActiveSymbols = screenResults.filter((c) => c.weekendActiveNow);
  console.log(`${weekendActiveSymbols.length} / ${eligible.length} symbols show real weekend-trading activity in the most recent completed weekend. Pulling full history for these only.`);

  console.log('Step 4/6: pulling full completed-weekend history for every weekend-active symbol (no cherry-picking of weekends)...');
  const records = [];
  const weekendVolCache = new Map();
  const volLock = {}; // simple per-key mutex so concurrent symbols don't double-fetch the same weekend's BTC volatility

  async function getCachedBtcVol(weekend, saturdayIso) {
    if (weekendVolCache.has(saturdayIso)) return weekendVolCache.get(saturdayIso);
    if (volLock[saturdayIso]) return volLock[saturdayIso];
    const p = fetchBtcWeekendVolatility(client, weekend);
    volLock[saturdayIso] = p;
    const v = await p;
    weekendVolCache.set(saturdayIso, v);
    return v;
  }

  const symbolErrors = [];
  let completedSymbolCount = 0;

  await mapConcurrent(weekendActiveSymbols, SYMBOL_PULL_CONCURRENCY, async (c) => {
    const weekends = enumerateCompletedWeekends(c.listedAt, ANALYSIS_HORIZON_END);
    try {
      for (const weekend of weekends) {
        const saturdayIso = isoDate(weekend.saturdayUTC8);
        const obs = await fetchWeekendObservation(client, c.symbol, weekend);
        await getCachedBtcVol(weekend, saturdayIso);
        const metrics = obs.weekendTradingInactive
          ? { valid: false, reason: 'weekend_trading_not_yet_enabled_for_symbol' }
          : computeWeekendMetrics({ fridayRef: obs.fridayRef, weekendEndPrice: obs.weekendEndPrice, mondayRef: obs.mondayRef });
        records.push({
          symbol: c.symbol,
          baseCoin: c.baseCoin,
          saturdayIso,
          listedAt: c.listedAt.toISOString(),
          listedAtSource: c.openTimeSource,
          weekend: { weekendStartUTC: weekend.weekendStartUTC.toISOString(), weekendEndUTC: weekend.weekendEndUTC.toISOString() },
          observation: obs,
          metrics,
        });
      }
      completedSymbolCount += 1;
      console.log(`  done: ${c.symbol} (${weekends.length} completed weekends since listing) [${completedSymbolCount}/${weekendActiveSymbols.length}]`);
    } catch (err) {
      // A single symbol's failure (after the client's own retry budget is
      // exhausted) must not discard every other symbol's already-collected
      // data. Recorded explicitly, never silently dropped or fabricated.
      symbolErrors.push({ symbol: c.symbol, error: err.message });
      console.error(`  FAILED: ${c.symbol} — ${err.message} (${weekends.length} weekends were being processed; any already-fetched weekends for this symbol before the failure are retained)`);
    }
    // Incremental checkpoint after every symbol so a later crash doesn't lose
    // already-collected data — this file is overwritten, not appended, each time.
    fs.writeFileSync(path.join(OUT_DIR, 'raw_dataset.partial.json'), JSON.stringify({ records, symbolErrors }, null, 2));
  });

  if (symbolErrors.length > 0) {
    console.log(`\n${symbolErrors.length} / ${weekendActiveSymbols.length} symbols failed after retries and were skipped (see summary.json "symbolErrors"). All other symbols' data is retained.`);
  }

  console.log('Step 5/6: aggregating...');
  // "weekend_trading_not_yet_enabled_for_symbol" is excluded from the informativeness
  // statistics (it is not a data-quality failure, it is a true structural absence of a
  // weekend session for that symbol at that date) but reported separately, never merged
  // into the generic invalidObservations bucket silently.
  const structurallyInactive = records.filter((r) => r.metrics.reason === 'weekend_trading_not_yet_enabled_for_symbol');
  const analyzable = records.filter((r) => r.metrics.reason !== 'weekend_trading_not_yet_enabled_for_symbol');

  const overall = aggregate(analyzable);
  const perSymbol = aggregateBySymbol(analyzable);
  const volMap = new Map([...weekendVolCache].filter(([, v]) => v !== null));
  const stratified = stratifyByIndependentVolatility(analyzable, volMap);

  console.log('Step 6/6: writing output...');
  fs.writeFileSync(path.join(OUT_DIR, 'raw_dataset.json'), JSON.stringify(records, null, 2));
  fs.writeFileSync(
    path.join(OUT_DIR, 'summary.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        rTokenRowsTotal: rTokenRows.length,
        delistedCount,
        eligibleForScreening: eligible.length,
        weekendActiveSymbolCount: weekendActiveSymbols.length,
        weekendActiveSymbols: weekendActiveSymbols.map((c) => c.symbol),
        symbolErrors,
        totalWeekendObservations: records.length,
        structurallyInactiveCount: structurallyInactive.length,
        analyzableCount: analyzable.length,
        overall,
        perSymbol,
        stratified,
      },
      null,
      2
    )
  );
  try {
    fs.unlinkSync(path.join(OUT_DIR, 'raw_dataset.partial.json')); // superseded by the completed raw_dataset.json
  } catch (_) {
    /* fine if it never existed */
  }

  console.log('\n=== OVERALL (weekend-trading-active symbols only, structurally-inactive weekends excluded) ===');
  console.log(overall);
  return { overall, perSymbol, stratified, records, weekendActiveSymbols, structurallyInactive };
}

if (require.main === module) {
  main().catch((err) => {
    const blocked = {
      status: 'BLOCKED',
      reason: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString(),
      note:
        'Real Bitget API call failed. This is reported as a blocker, not silently ' +
        'worked around. No fabricated or placeholder results are produced.',
    };
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, 'blocked_report.json'), JSON.stringify(blocked, null, 2));
    console.error('\nBLOCKED — see output/blocked_report.json');
    console.error(err.message);
    process.exit(2);
  });
}

module.exports = { main };
