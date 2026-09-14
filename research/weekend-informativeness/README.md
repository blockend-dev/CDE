# Weekend informativeness precondition test

Standalone, dependency-free (Node.js built-ins only) research script that
tests one narrow empirical question, independent of the eventual CDE
implementation:

> Are Bitget rToken weekend prices actually informative about the
> subsequent underlying-market reopen, or are they close to a naive
> Friday-close-held baseline?

This is a precondition gate for the corroboration-degradation thesis, not
part of the CDE system itself. It is kept in its own directory on purpose
and has no dependency on (and is not depended on by) any future agent,
injection-corpus, or trading code.

## Status: BLOCKED (network), not run against real data

This sandbox cannot resolve or reach `api.bitget.com` (confirmed via both
`curl` — DNS resolution failure, `getaddrinfo`/exit 28 — and Node's `fetch`
— `TypeError: fetch failed` from `undici`, see `output/blocked_report.json`
for the exact stack trace and timestamp from an actual attempted run). This
appears to be an environment-level network restriction affecting the
`bitget.com` domain broadly (every subdomain and endpoint tried failed the
same way across multiple research sessions), not a code bug or a Bitget
data-availability problem.

**Every number in this repository's `output/` directory, if any exists
beyond `blocked_report.json`, is either real data fetched from Bitget or
explicitly synthetic test fixtures — never a plausible-looking placeholder.**
`selfTest.js` uses hand-computed synthetic fixtures on purpose, and its
output is clearly separate from `run.js`'s output.

**To actually run this test:** execute `node run.js` from a machine/environment
with real internet access to `api.bitget.com` (no API key required — every
endpoint used is public). It will write `output/raw_dataset.json` and
`output/summary.json` on success, or `output/blocked_report.json` with the
real error on failure. Run `node selfTest.js` first (works anywhere, no
network) to confirm the calculation logic itself is intact in that
environment before trusting `run.js`'s output.

## Files

| File | Purpose | Needs network? |
|---|---|---|
| `nyseCalendar.js` | Deterministic US market holiday calendar (rule-based: nth-weekday-of-month + Meeus/Jones/Butcher Easter algorithm, not a hardcoded date list) and US DST bounds. | No |
| `weekendSchedule.js` | Bitget's documented weekend-session boundary (Sat 08:00→Mon 08:00 UTC+8 during US DST, 09:00→09:00 standard time) and completed-weekend enumeration. | No |
| `bitgetClient.js` | Thin public-market-data client: symbol enumeration, paginated historical candles. | Yes |
| `analysis.js` | Pure metric computation (Friday-baseline error, weekend error, error reduction, directional accuracy, aggregation, predeclared stratification). No I/O. | No |
| `selfTest.js` | Fixture-based proof that `analysis.js` and `nyseCalendar.js`/`weekendSchedule.js` are correct. **Run this and read its output before trusting anything else.** | No |
| `run.js` | Orchestrates the full pipeline against real Bitget data. | Yes |

## Verification status of the data substrate (per the request's §1)

| Item | Status | Notes |
|---|---|---|
| Symbol enumeration method | **PARTIALLY VERIFIED** | `GET /api/v2/spot/public/symbols` confirmed to exist via search-synthesized documentation snippets of `bitget.com/api-doc`; exact response schema (which field carries the rToken/stock category tag, if any) was not independently confirmed by reading the raw doc page, since `bitget.com` is unreachable here. `run.js` currently filters by the documented `r` + uppercase-ticker naming convention (`rAAPL`, `rNVDA`, ...) as the primary signal — this must be cross-checked against the real response schema on first real run, and the filter tightened if the naming convention alone produces false positives (e.g. an unrelated symbol that happens to start with a capital-following "r"). |
| Historical rToken universe / listing dates | **NOT a documented field found anywhere.** | `run.js` infers each symbol's listing date empirically — the timestamp of its earliest returned 1-day candle — rather than trusting an assumed or hardcoded date. This is a deliberate design choice, not a shortcut: it is the only method that doesn't require trusting secondary-source claims about when a given symbol was added. |
| Candle endpoint, intervals, pagination | **VERIFIED** (via consistent, repeated search-documentation confirmation across multiple sessions) | `GET /api/v2/spot/market/history-candles`; granularities 1min/5min/15min/1H/4H/1day; max 1000 candles/call; `bitgetClient.js` paginates backward from `endTime` in 1000-row chunks. |
| Timestamp semantics | **VERIFIED** | Unix milliseconds, UTC. All internal date handling in this codebase is UTC-based; no local-timezone `Date` methods are used anywhere in `nyseCalendar.js`/`weekendSchedule.js`/`run.js` (audit this if modifying — a single stray `getMonth()` instead of `getUTCMonth()` would silently corrupt every downstream boundary). |
| Historical depth back to each symbol's listing | **UNVERIFIED**, expected fine for candles (unlike order-book depth, which is known from separate research to not be retained historically) — candles are a standard OHLCV archive and Bitget's own documentation elsewhere confirms daily-bar history back to a symbol's listing (a concurrent hackathon submission independently reported "90 daily bars since listing" for one instrument). | Confirm on first real run by checking `listingDates` output against any independently known launch date. |
| Delisting/renaming | **UNCHECKED**, flagged as a known risk, not addressed. | If a symbol is renamed or delisted mid-sample, `getHistoryCandles` will simply return fewer/no rows for it going forward — `run.js` does not special-case this, and any symbol with abnormally few weekends relative to its inferred listing date should be manually inspected before trusting its per-symbol row in `summary.json`. |
| Explicit "indicative/weekend/MM-derived" price flag | **UNVERIFIED, leaning absent.** | No such field surfaced in any endpoint's documented response fields across repeated targeted searches. This is exactly why this precondition test exists — Bitget's own weekend-informativeness claim is tested empirically here rather than trusted from an API flag or from marketing prose. |

## Methodology (fixed before any result exists)

### Weekend enumeration
Bitget's documented boundary — Saturday 08:00→Monday 08:00 UTC+8 during US
DST, 09:00→09:00 UTC+8 standard time — implemented in `weekendSchedule.js`
using the *US* DST calendar (the boundary is DST-dependent because the NYSE
session it brackets is DST-dependent; China does not observe DST). A
weekend is only included if it is **fully completed** at analysis time —
`enumerateCompletedWeekends` explicitly excludes any weekend whose end
boundary falls after "now" (self-tested).

### Benchmark (fixed exactly as specified, before inspecting results)
```
fridayBaselineError = |Friday_ref  - Monday_ref|
weekendError         = |WeekendEnd  - Monday_ref|
errorReduction        = 1 - (weekendError / fridayBaselineError)
directionalHit         = sign(WeekendEnd - Friday_ref) == sign(Monday_ref - Friday_ref)
```
Both `errorReduction` (when `fridayBaselineError == 0`) and `directionalHit`
(when Friday and Monday are exactly equal) are explicitly flagged as
undefined rather than silently producing `Infinity`/`NaN`/a coerced
true-or-false — and are excluded from the relevant statistic with the
exclusion count reported, never hidden.

### Friday reference
The last available 1-hour candle close at or before the computed weekend-start
boundary, searched over a 6-hour lookback window. This is "whatever the last
real, weekday-hours print was," not an arbitrarily chosen tick.

### Weekend-end observation
The last available 1-hour candle close at or before the computed weekend-end
boundary, same 6-hour lookback methodology.

### Monday reference — chosen deliberately, before inspecting any result
**Volume-weighted average price (VWAP) over the first 30 minutes of the
NYSE regular session (9:30–10:00 AM ET) on the next real NYSE trading day**,
computed from 1-minute candles. Rationale:

- A single first-tick price is noisy and vulnerable to a thin/erratic
  opening-auction print; a fixed 30-minute VWAP window is a standard
  convention in market-microstructure research for "post-reopen price
  discovery has substantially completed" without waiting so long that
  unrelated intervening news contaminates what's meant to be a read of the
  reopen itself.
- 9:30 AM ET is used uniformly for every rToken's underlying (all rToken
  underlyings covered by Bitget are US-listed common equities/ETFs sharing
  one NYSE/Nasdaq regular-session open) — there is no need to normalize
  across different underlying-market hours because there aren't different
  underlying markets in this sample, only one (per §4 of the request: this
  is documented explicitly rather than assumed, and would need revisiting
  if a future rToken tracked a non-US-listed underlying).
- Expressed in UTC via the same US-DST convention used throughout (ET =
  UTC-4 during DST, UTC-5 standard time), computed in `etOpenUtc()`.

### Monday holidays
If the calendar-Monday following a weekend is not a real NYSE trading day
(federal holiday, via the rule-based `nyseCalendar.js` — not weekends,
since Monday itself is never a weekend day by construction), the Monday
reference shifts forward to the next actual NYSE trading day
(`nextNyseTradingDay`), and this shift is recorded per-observation
(`mondayHolidayShift: true`) rather than silently applied.

### Missing/gap data
Any of the three reference prices (Friday, weekend-end, Monday-VWAP) that
cannot be obtained from the API response is recorded as `null` and flagged
per-field in `missingDataFlags`; `computeWeekendMetrics` marks the whole
observation `valid: false` rather than computing a partial or interpolated
result. Invalid observations are counted and reported in every aggregate
(`invalidObservations`), never dropped silently.

### Stratification (predeclared, not post-hoc)
Weekends are split into terciles by an **independent** volatility proxy —
the realized 48-hour BTCUSDT move magnitude over the same weekend window —
computed and frozen from the same data pull, before any rToken
error-reduction number is inspected. BTCUSDT is used specifically because
it does not use the rToken's own price in its computation, avoiding the
circularity of stratifying a market's informativeness by its own
volatility. If fewer than 3 weekends have a matched volatility observation,
`stratifyByIndependentVolatility` explicitly refuses to stratify
(`applicable: false`) rather than producing a stratified result from too
small a sample.

## Explicit safeguards against the failure modes named in the request

- No future information is used to choose any reference — Friday/weekend-end
  references only ever look backward from their own boundary; the Monday
  reference only ever looks forward from the weekend boundary, at a fixed,
  predeclared offset.
- No symbol or weekend is cherry-picked — `run.js` processes every rToken
  symbol returned by the enumeration step and every completed weekend since
  each symbol's empirically-inferred listing date, unconditionally.
- No selectively-chosen Monday price — the VWAP window is fixed before any
  result exists (documented above), applied identically to every
  observation.
- Bitget's own description of its weekend pricing mechanism is treated
  throughout this project as a claim to be tested, never as evidence —
  this script exists specifically because that claim was not accepted at
  face value.
- The Hyperliquid finding (70.7% of weekends closer to reopen, 53% median
  error reduction) is used nowhere in this code as a pass/fail threshold —
  it does not appear in `analysis.js` at all. It is external context only,
  referenced in the final decision report alongside, never inside, this
  script's output.
