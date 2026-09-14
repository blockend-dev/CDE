'use strict';
/**
 * Minimal Bitget public-market-data client. No API key required — every
 * endpoint used here is documented as public.
 *
 * Endpoints — VERIFIED directly against the live API (2026-09-18), not
 * assumed from documentation snippets:
 *   - GET /api/v2/spot/public/symbols         symbol/instrument enumeration.
 *       rToken symbols are identified by `baseCoin` matching /^r[A-Z]/
 *       (e.g. "rAAPL"), NOT by the `symbol` field (which is upper-cased and
 *       concatenated with the quote coin, e.g. "RAAPLUSDT" — a naive
 *       ^r[A-Z] test against `symbol` silently matches nothing, which is
 *       exactly the bug the first live run caught: "Found 0 candidate
 *       rToken symbols"). Each row also carries `openTime` (Unix ms — used
 *       here as the authoritative listing timestamp, more reliable than
 *       empirical inference from candles), `offTime` (delisting timestamp,
 *       empty if still listed), `status` ("online"/other), and `areaSymbol`
 *       (== "yes" for every rToken row sampled, a useful cross-check).
 *   - GET /api/v2/spot/market/history-candles historical OHLCV candles.
 *       granularity is case-sensitive and NOT what earlier documentation
 *       search results implied ("1H"/"1D" fail with error 400171) — the
 *       live API's accepted values are:
 *       1min,3min,5min,15min,30min,1h,4h,6h,12h,1day,1week,1M
 *       (plus *utc variants: 6Hutc,12Hutc,1Dutc,3Dutc,1Wutc,1Mutc).
 *
 * Candle response rows: [timestamp_ms, open, high, low, close, baseVolume, quoteVolume, ...]
 * limit: verified max 200 per call for this endpoint (see getHistoryCandles
 * doc below — documentation snippets claiming 1000 were wrong); endTime is
 * Unix ms, UTC (this client paginates backward from endTime; startTime is
 * accepted but not required per-call).
 */

const BASE_URL = 'https://api.bitget.com';
const PUBLIC_RATE_LIMIT_PER_SEC = 20; // documented public market-data limit

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Simple concurrency-limited request gate. The 20/sec Bitget limit bounds
 * how many requests may be *initiated* per second; observed round-trip
 * latency through this environment's network path is ~2-3s/request, so a
 * naive fully-serial client (await each call before starting the next)
 * would badly under-use the allowance and make a full-universe pull
 * impractically slow. This gate allows up to `maxConcurrent` in-flight
 * requests while still spacing *initiations* to stay under the per-second cap.
 */
class RateGate {
  constructor(maxConcurrent, minIntervalMs) {
    this.maxConcurrent = maxConcurrent;
    this.minIntervalMs = minIntervalMs;
    this._inFlight = 0;
    this._lastStart = 0;
  }

  async wrap(fn) {
    while (this._inFlight >= this.maxConcurrent) await sleep(15);
    const wait = this.minIntervalMs - (Date.now() - this._lastStart);
    if (wait > 0) await sleep(wait);
    this._lastStart = Date.now();
    this._inFlight += 1;
    try {
      return await fn();
    } finally {
      this._inFlight -= 1;
    }
  }
}

class BitgetClient {
  constructor({
    baseUrl = BASE_URL,
    // Effective observed limit is stricter than the documented 20/sec —
    // plausible cause: a shared VPN-exit IP splitting the per-IP budget
    // with other traffic (this environment's only path to api.bitget.com
    // requires an active VPN; see conversation history). Tuned down
    // empirically after repeated live 429s at the documented rate.
    minRequestIntervalMs = 1000 / 6,
    maxConcurrent = 5,
    fetchImpl = globalThis.fetch,
    maxRetries = 6,
  } = {}) {
    this.baseUrl = baseUrl;
    this._fetch = fetchImpl;
    this._gate = new RateGate(maxConcurrent, minRequestIntervalMs);
    this._maxRetries = maxRetries;
    if (!this._fetch) {
      throw new Error('No fetch implementation available (requires Node 18+ global fetch).');
    }
  }

  async _get(path, params = {}, { timeoutMs = 30000 } = {}) {
    let attempt = 0;
    for (;;) {
      try {
        return await this._gate.wrap(() => this._doGet(path, params, timeoutMs));
      } catch (err) {
        const isTransient = err.isRateLimit === true || err.isTransientNetwork === true;
        if (!isTransient || attempt >= this._maxRetries) throw err;
        attempt += 1;
        const backoffMs = Math.min(30000, 500 * 2 ** attempt) + Math.floor(Math.random() * 250);
        await sleep(backoffMs);
      }
    }
  }

  async _doGet(path, params, timeoutMs) {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let res;
      try {
        res = await this._fetch(url.toString(), { signal: controller.signal });
      } catch (fetchErr) {
        // Network-level failure (timeout/abort, connection reset, VPN hiccup) —
        // treated as transient and retried, distinct from a real API error.
        const e = new Error(`Network error calling ${path}: ${fetchErr.message}`);
        e.isTransientNetwork = true;
        throw e;
      }
      if (res.status === 429) {
        const e = new Error(`HTTP 429 Too Many Requests (path=${path})`);
        e.isRateLimit = true;
        throw e;
      }
      if (res.status >= 500) {
        const e = new Error(`HTTP ${res.status} from ${path}`);
        e.isTransientNetwork = true;
        throw e;
      }
      const body = await res.json();
      if (body.code !== undefined && body.code !== '00000') {
        if (body.code === '429' || /too many requests/i.test(body.msg || '')) {
          const e = new Error(`Bitget API error ${body.code}: ${body.msg} (path=${path})`);
          e.isRateLimit = true;
          throw e;
        }
        throw new Error(`Bitget API error ${body.code}: ${body.msg} (path=${path})`);
      }
      return body.data;
    } finally {
      clearTimeout(t);
    }
  }

  /** Returns raw instrument list; caller filters for rToken naming/category. */
  async getSpotSymbols() {
    return this._get('/api/v2/spot/public/symbols');
  }

  /**
   * Fetch candles in a [startTimeMs, endTimeMs) window, paginating backward
   * in chunks of `limit` since the API returns at most `limit` candles per
   * call. Default limit is 200 — VERIFIED empirically against the live API
   * (limit=200 succeeds, limit=250/300/500/1000 all fail with error 40020
   * "Parameter limit error"; documentation snippets found during research
   * claimed a max of 1000 for spot, which is wrong for this endpoint as of
   * 2026-09-18). Returns rows sorted ascending by timestamp, deduped.
   */
  async getHistoryCandles(symbol, granularity, startTimeMs, endTimeMs, { limit = 200 } = {}) {
    const rows = [];
    let cursorEnd = endTimeMs;
    let guard = 0;
    while (cursorEnd > startTimeMs && guard < 500) {
      guard += 1;
      const data = await this._get('/api/v2/spot/market/history-candles', {
        symbol,
        granularity,
        endTime: cursorEnd,
        limit,
      });
      if (!data || data.length === 0) break;
      // Bitget returns newest-first for history-candles in some versions;
      // normalize defensively rather than assume an order.
      const parsed = data.map((r) => ({
        ts: Number(r[0]),
        open: Number(r[1]),
        high: Number(r[2]),
        low: Number(r[3]),
        close: Number(r[4]),
        baseVolume: Number(r[5]),
        quoteVolume: Number(r[6]),
      }));
      parsed.sort((a, b) => a.ts - b.ts);
      rows.unshift(...parsed);
      const oldestTs = parsed[0].ts;
      if (oldestTs <= startTimeMs || oldestTs >= cursorEnd) break; // no progress, stop
      cursorEnd = oldestTs;
    }
    const seen = new Set();
    const deduped = rows.filter((r) => (seen.has(r.ts) ? false : (seen.add(r.ts), true)));
    deduped.sort((a, b) => a.ts - b.ts);
    return deduped.filter((r) => r.ts >= startTimeMs && r.ts < endTimeMs);
  }
}

module.exports = { BitgetClient, BASE_URL, PUBLIC_RATE_LIMIT_PER_SEC };
