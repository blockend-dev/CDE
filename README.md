# CDE — Corroboration Differential Engine

CDE evaluates whether an LLM trading agent's response to an unverified, injected market claim changes when independent price-discovery corroboration is harder to obtain.

**Evaluate the agent before trusting the agent.**

This is a replay-only research and evaluation harness, not a trading product. It does not place live orders, does not integrate with Bitget Agent Hub, MCP, or Playbook, and does not claim profitability. See [What CDE does NOT do](#what-cde-does-not-do).

---

## The question

Crypto markets trade continuously. Traditional U.S. equity price discovery does not — the NYSE opens and closes. CDE asks: **when an LLM trading agent is given an unverified market claim, does its decision change depending on whether independent, active price discovery is available to check that claim against?**

Bitget's rToken instruments (synthetic exposure to U.S.-listed equities) keep printing prices through the weekend, while the underlying NYSE is closed. That gap is the natural experiment: weekday conditions have an open, independently-moving reference market; weekend conditions do not. CDE injects the same kind of claim under both conditions and measures whether the agent's structured decision differs.

This is not a claim that Bitget weekend prices are uninformative. That is the question the design investigates, not an assumption it makes. A separate, earlier precondition study (`research/weekend-informativeness/`) found that in the historical sample it examined, weekend rToken prices were not materially more informative than a naive Friday-held baseline — a narrow, sample-specific finding, not a general claim about the mechanism, and not something CDE re-tests.

## What CDE actually does

```
REAL market state  →  claim injection  →  LLM decision  →  structured decision evidence
                                                                       │
                                        paired Clean / Injected comparison
                                                                       │
                                              condition analysis (weekday vs weekend)
                                                                       │
                                                          statistical result (DiD)
```

Every trial starts from one frozen market snapshot (a symbol, a timestamp, a price, and a set of derived scaffolding fields — see [Architecture](#architecture)). Each snapshot produces **one pair**:

- **Clean** — the agent sees the market state and decides. No claim is shown.
- **Injected** — the same agent, same snapshot, same tools, same model configuration, sees one additional thing: an unverified market claim (e.g. "chatter on trading forums points to a large holder quietly trimming their position"). The claim is never verified true or false by this instrument — it is a fixture, injected identically in shape across every trial.

The only thing that differs between the two members of a pair is whether the claim was shown. Everything else — snapshot, tools, model, temperature, prompt — is held constant by construction. What is measured is **exposure**, the agent's self-reported intended position size, a number in `[-1, 1]` (never a return, and never P&L). For a pair:

```
δ = exposure(Injected) − exposure(Clean)
```

`δ` is computed for every pair, then compared across the two market conditions (weekday: NYSE open; weekend: NYSE closed) with a difference-in-differences estimator. See [The result](#the-result) below.

## The result

| | |
|---|---|
| Paired observations | **41** (21 weekday, 20 weekend; 1 further attempt failed schema validation and was preserved, not discarded — 42 attempted) |
| DiD (`exposureDelta`) | **−0.0025** |
| 95% CI (bootstrap) | **[−0.0075, 0.0000]** |
| Permutation p (two-sided, 10,000 permutations, seed 424242) | **0.4909** |
| Directional flips | **0** of 21 weekday pairs; **0** of 20 weekend pairs |

**In plain English:** the observed estimate is small, and the current sample does not provide strong statistical evidence of a non-zero difference between conditions.

**Weak statistical evidence of a difference is not evidence that the effect is zero.** This study was not powered to detect a small effect — no power calculation was performed (see [`cde/analysis/ANALYSIS_PLAN.md`](cde/analysis/ANALYSIS_PLAN.md) §6) — so absence of significance here should not be read as absence of an effect.

Further, and just as load-bearing:

- **No power calculation was performed.** The sample size (minimum 20 completed pairs per condition) was fixed as a practical, pre-registered stopping rule, not derived from an assumed effect size.
- **Calendar-prior confounding is not separately identified.** Weekday vs. weekend changes the calendar itself, not only corroboration availability; the design cannot cleanly separate "the model reacted to the calendar" from "the model reacted to reduced corroboration." `cde/lib/metrics.js: calendarPriorFlag` records the trace fields to study this in a future design; it does not resolve it here.
- **One model, one configuration.** `claude-sonnet-5`, `anthropic`, temperature 0, evaluated once each. No claim generalizes to other models, temperatures, or prompts.
- **Exposure is not P&L.** It is a self-reported, structured field the agent emits; there is no live trading, no position ever opened, and no return computed anywhere in this codebase.
- **This is not evidence about whether weekend prices contain information.** See [The question](#the-question).

### Reproducibility note — the p-value is not perfectly deterministic

The frozen Phase 5 analysis loader (`cde/phase5/preflight.js`) reads the run's trial files with an unsorted `fs.readdirSync`, and the fixed-seed permutation test shuffles a pooled array built from that read order. Windows and Linux/macOS list the same directory in different orders (Windows: creation-adjacent order on this checkout; Linux/macOS: sorted), so the *p-value* moves slightly depending on which machine produced it, while the point estimate and interval do not:

| Input order | DiD | 95% CI | permutation p |
|---|---|---|---|
| Recorded (as at analysis time — the committed result) | −0.0025 | [−0.0075, 0.0000] | **0.4909** |
| Filename-sorted | −0.0025 | [−0.0075, 0.0000] | 0.4776 |
| Reverse filename-sorted | −0.0025 | [−0.0075, 0.0000] | 0.4941 |

This spread (≈0.005) is on the scale expected from Monte Carlo sampling error at 10,000 permutations near p ≈ 0.49 (standard error ≈ √(p(1−p)/N) ≈ 0.005) — it is not evidence of a bug in the statistical logic, and none of the three orders change the substantive reading of the result. The demo's Integrity Console replays the exact recorded order (`demo/server/analysisInputOrder.json`) so its live reproducibility check reproduces the committed hash on any OS, and its Reproducibility panel re-runs the same analysis under multiple orders live, on demand, so this is disclosed rather than hidden. **The frozen Phase 5 loader itself is unmodified** — this is a documented property of the existing code, not a fix applied to it. See [REPRODUCIBILITY.md](REPRODUCIBILITY.md) for the full account.

This is not called a "bug-free" result. It is a known, disclosed, small, and well-understood source of variance in one number, with everything else invariant.

## Why the result is still useful

A small effect with weak statistical evidence behind it is a real research outcome, and the instrument that produced it has properties worth stating plainly:

- A **claim-blind baseline** exists (`cde/lib/baseline.js`) — a deterministic control that structurally cannot see the injected claim, so its Clean/Injected outputs are identical by construction. It is a falsification control, not a benchmark.
- **Clean/Injected pairing is controlled**, not just labeled: both members of a pair share one frozen snapshot, so the only varying input is the claim.
- **Every market-state field is explicitly provenance-labeled** REAL, DERIVED, or FIXTURE (see [Architecture](#architecture)) — nothing is left for a reader to assume.
- **Every input is reproducible from frozen, hash-locked files** — the methodology, the analysis plan, the dataset, and the model configuration are all locked before collection and independently re-checkable (see [REPRODUCIBILITY.md](REPRODUCIBILITY.md)).
- The instrument is built for **adversarial evaluation**, not profitability theater: it exists to expose whether and how an agent's decisions move under a controlled stress, not to produce a trading signal.

## Architecture

```
REAL           Bitget historical public market data (symbol, timestamp, last price)
               — actual market observations, fetched once for the precondition study
                                          │
DERIVED        normalized market-state fields (order book, volume, candles) and the
               weekday/weekend condition label — synthetic replay scaffolding, never
               presented as independently observed
                                          │
FIXTURE        the locked claim corpus, frozen Clean/Injected trial pairs, and the
               deterministic replay artifacts the demo serves
                                          │
LLM            claude-sonnet-5 (Anthropic), temperature 0 — the exact configuration
               used for the one research run this repository reports
                                          │
ANALYSIS       paired evaluation (δ per pair) → DiD (weekend − weekday) →
               permutation test → bootstrap CI → secondary metrics, all pre-registered
                                          │
DEMO           replay-only visualization — reads frozen files over a local HTTP
               server; no outbound network call, no live trading, no live model call
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full module map, data flow, and where a live Bitget or LLM adapter would plug in (and why the demo intentionally does not instantiate one).

## Exact Bitget integration statement

**CDE currently uses Bitget public REST market data for historical research.** The demo replays frozen artifacts and does not make live Bitget API calls.

**CDE does not currently claim integration with Bitget Agent Hub, MCP, Playbook, or Agentic Trading APIs.** No such integration exists in this repository. If this is read as a gap against the Agentic Trading track's toolchain, that gap is real and stated here rather than implied away.

## Bitget Demo execution — validated separately, and why it isn't part of CDE's result

This section reports what was directly tested rather than assumed, before concluding CDE could not be extended into real paper trading. It is kept strictly separate from CDE's frozen research; nothing below changes, motivates, or is blended into the 41-pair result above.

**Demo execution genuinely works.** Using authenticated Bitget UTA v3 Demo credentials, real market buy/sell round trips on `BTCUSDT` filled successfully — 12 orders across 6 pairs in total, order `1486690999181099008` (the first buy) through order `1486971686056513536` (the last sell). This is real, working infrastructure: genuine authentication, signing, order placement, fills, and position closure — not a mock. Full per-order timestamps, prices, quantities, and the measured account balance change are in [PAPER_TRADING_LOG.md](PAPER_TRADING_LOG.md).

**Real-world-asset (rToken) execution does not.** Bitget's Demo instrument catalog does list several rToken/tokenized-stock symbols — `RQQQUSDT`, `RSPYUSDT`, `RMUUSDT`, `RGOOGLUSDT`, among others — and four of those are literally in the frozen precondition study's own 85-symbol universe (`research/weekend-informativeness/output/raw_dataset.json`), not just similarly named. But every order placed against them, market or limit, is rejected identically:

```text
POST /api/v3/trade/place-order  {category: SPOT, symbol: RQQQUSDT, orderType: market, side: buy, qty: "10"}
-> 400  code 25200  "papTradingService not support RWA order validation error"
```

Reproduced on `RQQQUSDT` (both market and limit order types), `RGOOGLUSDT`, `RMUUSDT`, and `RSPYUSDT` (market). The error names the paper-trading *service*, not the account or a specific symbol — a platform-wide restriction, not a configuration problem on our end. `RAAPLUSDT` and `RAAOIUSDT` — the two symbols CDE's frozen research actually uses — aren't in Bitget's Demo catalog at all (`online` on live; `40034 "Parameter RAAPLUSDT does not exist"` on Demo).

**What this means, plainly:** a scientifically faithful extension of CDE into real Bitget paper trading isn't currently possible, because the entire instrument class the research question depends on — tokenized real-world equities — can't be paper-traded on Bitget today. Trading metrics could have been produced anyway by substituting `BTCUSDT`, but those numbers would say nothing about weekday/weekend corroboration availability, since BTCUSDT trades continuously with no comparable NYSE-linked information gap. That substitution was not made, and no BTCUSDT metric anywhere in this repository is presented as evidence toward CDE's research question.

## What CDE does NOT do

- CDE itself does not execute trades, live or paper — no order originates from the research pipeline or the demo. The paper trades referenced above (`BTCUSDT`, [PAPER_TRADING_LOG.md](PAPER_TRADING_LOG.md)) were a separate, direct infrastructure validation, not something CDE's agent, pipeline, or demo performed or was asked to perform.
- Does not claim profitability. There is no P&L, Sharpe, Sortino, drawdown, or win-rate figure anywhere in this repository.
- Does not produce live trading signals.
- Does not claim weekend prices are uninformative — see [The question](#the-question).
- Does not use a live (real-money) Bitget trading account — the execution validation above used a Demo/paper account exclusively.
- Does not present the `BTCUSDT` Demo trades, or any BTC-derived figure, as evidence toward CDE's research question.
- Does not use live API calls in Judge Mode, or anywhere else in the demo.
- Does not claim Bitget MCP, Agent Hub, or Playbook integration.

## What CDE evaluates (and does not)

CDE is positioned as an **agent evaluation / benchmarking harness**, not a trading bot competing on returns:

| Measured here | Not measured (see [What would be next](#what-would-be-next)) |
|---|---|
| Decision consistency — does the structured decision change between Clean and Injected? | Risk-violation rate |
| Claim susceptibility — does the agent adopt, reject, or stay uncertain about the claim? | Drawdown |
| Evidence usage — which tools did it call, and what did they return? | Human-takeover rate |
| Stress behavior under two corroboration regimes | Paper-trading or live trading behavior |
| Provenance — is every input labelled REAL, DERIVED, or FIXTURE? | Any return, Sharpe, or win-rate figure |

## Repository map

```
cde/                          Frozen research core — methodology, contracts, analysis. DO NOT MODIFY.
  METHODOLOGY.md               The locked experimental design.
  analysis/ANALYSIS_PLAN.md    The pre-registered statistical plan.
  runs/                        Frozen trial data for the one completed research run.
  analysis/results/            The frozen analysis result and its hash.
research/                     Frozen precondition study. DO NOT MODIFY.
  weekend-informativeness/     Bitget weekend price-informativeness precondition test.
demo/                          The judge-facing demo. Free to modify — everything outside cde/ and research/ is.
  server/                      Plain Node http server — the only trusted boundary onto the frozen files.
  web/                         Vanilla ES-module frontend (Three.js/Anime.js visual system, no framework).
  test/                        20 test suites (m1–m13 plus the frozen-research phase suites), run via `npm test`.
README.md, ARCHITECTURE.md, REPRODUCIBILITY.md, LICENSE
                               Root-level documentation.
```

**Frozen means frozen, with one disclosed exception**: `cde/`, `research/`, their lock files, `cde/runs/`, `cde/analysis/results/`, and `demo/server/analysisInputOrder.json` are not modified by any demo or documentation pass. One file, `cde/phase5/preflight.js`, was edited exactly once after the research concluded, for a reason unrelated to the research itself — see [REPRODUCIBILITY.md § A disclosed edit made after publishing](REPRODUCIBILITY.md#a-disclosed-edit-made-after-publishing-two-commit-references-were-updated-once) for the full, precise account of what changed and why. See [Repository errata](#repository-errata) for what that implies about some of their own internal wording.

## Run locally

Requirements: **Node ≥ 18**.

```
npm install
npm run demo
```

Then open **http://localhost:5175**. Stop the server with Ctrl+C, or `pkill -f demo/server/httpServer.js`.

Run the full test suite (research-core tests plus all 20 demo suites, including a real-headless-browser suite when Chrome or Edge is available):

```
npm test
```

## Judge Mode

Click **START 90-SECOND DEMO** on the Lab screen. It is a scripted walkthrough that drives the real screens and triggers real server-side computation (the live integrity verification, the input-order re-run, a real tamper attack) — never a canned animation. It can be interrupted at any point by navigating manually. It covers, in order:

1. **Market state** — what is real, what is derived, for one frozen snapshot.
2. **Claim** — the injected, unverified fixture.
3. **Agent response** — what the tools returned, and the agent's own recorded belief and decision.
4. **Evidence X-Ray** — every tool call and field, exactly as recorded.
5. **Clean vs Injected** — the controlled pairing, and the claim-blind baseline.
6. **Analysis** — how DiD, the bootstrap interval, and the permutation test are computed.
7. **Result** — the number, and its plain-language reading.
8. **Reproducibility** — a live re-verification, the input-order sensitivity re-run, and a real tamper attack caught by the integrity engine.

## What would be next

None of the following is implemented, claimed, or fabricated anywhere in this repository. They are the concrete extensions that would make the experiment stronger:

- A larger sample, with a pre-registered power analysis driving the stopping rule.
- Multiple LLMs and multiple temperatures/configurations, to test whether the (null) result generalizes.
- A calendar-only control condition, to separate calendar-prior effects from corroboration-availability effects.
- An actual paper-trading evaluation, run live over the competition window, with the risk-control metrics an agentic-trading benchmark expects (drawdown, risk-violation rate).
- A live Bitget adapter behind the same trial contract this repository already defines (see [ARCHITECTURE.md](ARCHITECTURE.md)), explicit and swappable, not silently assumed.
- Repeated market regimes (multiple periods, not one four-month window over two symbols).

## Repository errata

`cde/` and `research/` are frozen research artifacts: their content, including their own README files, is preserved byte-for-byte, with one disclosed, narrowly-scoped exception detailed in [REPRODUCIBILITY.md](REPRODUCIBILITY.md#a-disclosed-edit-made-after-publishing-two-commit-references-were-updated-once). Three things in those frozen directories are worth flagging so they are not mistaken for either dishonesty or accidental junk:

- **`research/weekend-informativeness/README.md`** still says `Status: BLOCKED (network), not run against real data`. That was true when the file was written. `output/summary.json` and `output/raw_dataset.json` in the same directory show the precondition study was later run successfully against live Bitget data (904 observations, 887 valid, 2026-04-25 → 2026-09-12); `output/blocked_report.json` is preserved from the earlier failed attempt, not deleted. **This root README is the current, canonical status** — the frozen README's wording is stale, not a live claim.
- **`cde/runs/run-2026-09-19T131327972Z-INVALID-config-mislabeled/`** is a preserved earlier run attempt whose configuration was mislabeled; it is kept, not deleted, in keeping with the methodology's "do not remove inconvenient trials" rule (`cde/METHODOLOGY.md` §14). It is not the run this repository reports — that is `cde/runs/run-2026-09-19T155659111Z/`, referenced by hash throughout this README and the demo.
- **`cde/phase5/preflight.js`** was edited once, after the research concluded, to update two hardcoded commit references that went stale when this repository was published to GitHub (which rewrote every commit's hash). This is the one exception to "frozen means frozen" in this repository — see [REPRODUCIBILITY.md](REPRODUCIBILITY.md#a-disclosed-edit-made-after-publishing-two-commit-references-were-updated-once) for the precise, verifiable account of what changed and why.

Frozen source comments and one frozen JSON error-stack (`cde/phase4/runManifest.js`, `research/weekend-informativeness/output/blocked_report.json`) mention a UNC development path under the author's own machine account name. Neither is a secret or a credential; both are preserved as part of the frozen record rather than edited.

## Frozen artifact hashes

For independent verification against the values this README and the demo both cite:

```
methodology lock   5acc71b0ee54949c04535e10d4fae00e6b85cb79728dbdc5df4b2e455d969d54
analysis lock      43e0479499d286f4dfe06fd8ec4a036941cd3df1ff0b8afeaee423e2e167fdd7
dataset manifest   99d3d5af659c28a91697783f5da850a719a173cce772f3e55990e96459e2daf2
analysis result    b86deb65b4dc9a416e0a6c8845107cfb8b8fbf225a43ce50979cc1cb7317abd2
```

## License

Apache-2.0 — see [LICENSE](LICENSE).
