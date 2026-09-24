# Paper Trading Log — Bitget Demo Execution

This is the full, raw order-level run record behind [README.md § Bitget Demo execution](README.md#bitget-demo-execution--validated-separately-and-why-it-isnt-part-of-cdes-result). It exists to satisfy the hackathon submission form's Run records requirement (timestamp, instrument, direction, price, quantity, account balance change) with real numbers, not to add a new claim: **nothing here is part of CDE's frozen research result**, and none of it is presented as a trading strategy or a profitability claim. See [What CDE does NOT do](README.md#what-cde-does-not-do) for the boundary this respects.

**What this is:** authenticated execution against Bitget's UTA v3 **Demo (paper) trading** environment — real API authentication (HMAC-SHA256 signed requests, `paptrading: 1` header), real order placement, real fills, on fake money. No real funds were ever at risk.

**What this is for:** proving the execution infrastructure genuinely works — auth, signing, order placement, fills, position close, balance accounting — for the one instrument class Bitget's Demo environment actually allows (`BTCUSDT`). It is **not** connected to CDE's research question, which concerns weekday/weekend corroboration availability for real-world-asset (rToken) instruments; those instruments are demonstrably **not paper-tradable on Bitget today** — see [README.md's rToken rejection evidence](README.md#bitget-demo-execution--validated-separately-and-why-it-isnt-part-of-cdes-result) (`code 25200`, reproduced across four rToken symbols).

## Orders (chronological, all `BTCUSDT`, `SPOT`, market orders, all filled)

Two batches: the first pair (`2026-09-23`) was the original infrastructure smoke test. The remaining five pairs (`2026-09-24`) were run in direct succession specifically to produce a fuller run record for this submission — same account, same method, no code path changed in between.

| # | Timestamp (UTC) | Order ID | Direction | Avg. fill price (USDT) | Quantity (BTC) | Notional (USDT) | Fee |
|---|---|---|---|---|---|---|---|
| 1 | 2026-09-23T16:24:36.264Z | 1486690999181099008 | buy | 84254.33 | 0.000118 | 9.94201094 | 0.000000118 BTC |
| 2 | 2026-09-23T16:25:54.944Z | 1486691329188937728 | sell | 84220.49 | 0.000117 | 9.85379733 | 0.00985379733 USDT |
| 3 | 2026-09-24T10:58:56.977Z | 1486971433337114624 | buy | 83503.87 | 0.000119 | 9.93696053 | 0.000000119 BTC |
| 4 | 2026-09-24T10:59:16.708Z | 1486971516094926848 | sell | 83486.45 | 0.000119 | 9.93488755 | 0.00993488755 USDT |
| 5 | 2026-09-24T10:59:42.073Z | 1486971622483447808 | buy | 83501.13 | 0.000119 | 9.93663447 | 0.000000119 BTC |
| 6 | 2026-09-24T10:59:44.260Z | 1486971631656390656 | sell | 83486.45 | 0.000119 | 9.93488755 | 0.00993488755 USDT |
| 7 | 2026-09-24T10:59:46.494Z | 1486971641026465835 | buy | 83504.64 | 0.000119 | 9.93705216 | 0.000000119 BTC |
| 8 | 2026-09-24T10:59:48.340Z | 1486971648769150976 | sell | 83486.45 | 0.000119 | 9.93488755 | 0.00993488755 USDT |
| 9 | 2026-09-24T10:59:50.617Z | 1486971658319581184 | buy | 83504.64 | 0.000119 | 9.93705216 | 0.000000119 BTC |
| 10 | 2026-09-24T10:59:52.698Z | 1486971667047927808 | sell | 83486.45 | 0.000119 | 9.93488755 | 0.00993488755 USDT |
| 11 | 2026-09-24T10:59:54.947Z | 1486971676480917504 | buy | 83504.64 | 0.000119 | 9.93705216 | 0.000000119 BTC |
| 12 | 2026-09-24T10:59:57.230Z | 1486971686056513536 | sell | 83486.45 | 0.000119 | 9.93488755 | 0.00993488755 USDT |

All 12 orders are independently verifiable by calling `GET /api/v3/trade/history-orders` (category `SPOT`, symbol `BTCUSDT`) against this Demo account, or by re-reading `orderId` values individually via `GET /api/v3/trade/history-orders`. Each buy is immediately followed by a market sell of the exact filled base quantity (a flat round trip), so net BTC exposure returns to ~0 after every pair — the account is not holding a directional position.

## Account balance change

Direct before/after measurement, via `GET /api/v3/account/assets`, bracketing orders #3–#12 (the five pairs run for this submission):

| | USDT available |
|---|---|
| Before (immediately prior to order #3) | 49999.90193259 |
| After (immediately after order #12) | 49999.84194442 |
| **Change** | **-0.05998817 USDT** |

This is the net cost of 5 round-trip market buy/sell pairs — Bitget's taker fee plus the bid/ask movement between each buy fill and its immediately following sell fill (visible directly in the price column above: each sell fills slightly below its paired buy). It is transaction cost, not a loss on a held position — every pair closes flat. Order #1–#2 (the original 2026-09-23 pair) predates this measurement window; its own per-order fees are recorded in its `feeDetail` above (`0.000000118 BTC` on the buy, `0.00985379733 USDT` on the sell), consistent with the same per-round-trip cost pattern.

## Method (for reproducibility)

Requests were authenticated per Bitget's documented UTA v3 scheme: `ACCESS-KEY` / `ACCESS-SIGN` (HMAC-SHA256 over `timestamp + method + requestPath + queryString + body`, base64-encoded) / `ACCESS-TIMESTAMP` / `ACCESS-PASSPHRASE` headers, plus `paptrading: 1` to route to the Demo trading engine. This was run as a one-off authenticated script outside the repository (it needs live API credentials and places real — if paper — orders, so it is intentionally not part of `demo/server`, which is read-only and makes no live API calls anywhere). `.env.example` documents the credential shape needed to reproduce it.
