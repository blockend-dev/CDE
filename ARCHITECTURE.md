# Architecture

Written for a technical judge or an engineer inheriting this repository. It explains system boundaries, module responsibilities, and — deliberately — what is *not* built and why. Nothing here describes a refactor; it is a map of what the code in [`README.md`'s repository map](README.md#repository-map) already does.

## System boundaries

```
┌─────────────────────────────────────────────────────────────────┐
│  cde/  +  research/            FROZEN RESEARCH CORE               │
│  (methodology, contracts, one completed research run, analysis)   │
│  No code here is modified by the demo or by this documentation.   │
└─────────────────────────────────────────────────────────────────┘
                              │  read-only
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  demo/server/                  THE ONLY TRUSTED BOUNDARY          │
│  Plain Node http server. Reads frozen files, calls already-tested │
│  cde/ functions directly (no reimplementation). No outbound       │
│  network call anywhere in this process.                           │
└─────────────────────────────────────────────────────────────────┘
                              │  JSON over localhost
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  demo/web/                     BROWSER, JUDGE-FACING              │
│  Vanilla ES modules. Never touches the filesystem or cde/ code    │
│  directly — every fact on screen came from a demo/server/ route.  │
└─────────────────────────────────────────────────────────────────┘
```

The browser never has filesystem or `cde/` access. The demo server never mutates `cde/runs/` or `cde/analysis/results/` — see [Why replay is deterministic](#why-replay-is-deterministic-and-what-the-server-does-and-does-not-write) for the one operation that looks like a write and is not.

## Data flow

```
cde/runs/<runId>/                    one frozen research run: 41 completed trial
  manifest.json                       pairs (82 trials), 1 preserved failed attempt,
  dataset_manifest.json               plus its manifest, dataset manifest, and the
  trials/*.json                       hashes that lock the methodology/analysis/model
  failures/*.json                     configuration this run used.
        │
        ▼  cde/phase5/preflight.js + cde/phase5/runResearchAnalysis.js  (unmodified)
cde/analysis/results/<runId>/analysis_result.json
  the one committed, hash-addressed analysis output: DiD, CI, permutation p,
  secondary metrics, sample-size classification, calendar-prior report.
        │
        ▼  demo/server/dataLoader.js  (reads only, builds in-memory pair records)
        ▼  demo/server/integrity.js, orderSensitivity.js, tamper.js, provenance.js,
           baseline.js, timeline.js  (each wraps dataLoader + cde/ functions)
        ▼  demo/server/httpServer.js  (routes → JSON)
        │
        ▼  demo/web/js/api.js  (fetch wrapper)
demo/web/js/screens/*, screens/tabs/*, components/*
  render the frozen facts. demo/web/js/visual/* (scene.js, motion.js, glass.js,
  particles.js) is presentation only — it never originates a fact, only animates
  one already returned by the server.
```

## Module responsibilities

### `cde/` (frozen)

| Path | Responsibility |
|---|---|
| `lib/` | Phase 0 contracts: snapshot schema (`snapshot.js`), condition classification (`conditions.js`), the claim-blind baseline (`baseline.js`), the claim corpus contract (`corpus.js`), pairing identity (`pairing.js`), the tool manifest (`tools.js`), the decision schema (`decision.js`), causal metrics (`metrics.js`), provenance (`provenance.js`), and the methodology lock (`methodologyLock.js`). Pure functions, no network, no agent. |
| `phase1/` | Deterministic execution harness — fixtures, tool replay, pairing, the deterministic test adapter (`adapter.js`, `toolReplay.js`, `trial.js`). Used to validate the harness before any real model was involved. |
| `phase2/` | The real model boundary: `provider/anthropicClient.js` is the one place an Anthropic API call is made, `realModelAdapter.js` wires it into the Phase 1 contract, `prompt.js` and `schema.js` define what the model sees and must return. `secretRedaction.js` keeps API keys out of any logged output. |
| `phase4/` | Research execution: `population.js` builds candidate snapshots from the precondition study's data (`replaySnapshot.js`), `orchestrator.js` runs paired trials against Phase 2's real adapter, `datasetFinalize.js` and `runManifest.js` produce the frozen manifests. This is the one place the real model was actually called for research purposes. |
| `phase5/` | `preflight.js` re-derives and checks every invariant of a finished run (hashes, pairing, sample counts, no post-hoc redefinition); `runResearchAnalysis.js` executes the locked analysis and writes the one committed `analysis_result.json`. |
| `analysis/lib/` | The pre-registered statistical plan as pure functions: `primaryAnalysis.js` (DiD, permutation test, bootstrap CI), `secondaryAnalysis.js`, `stratification.js`, `resampling.js`/`prng.js` (seeded, deterministic), `sampleSizeAssessment.js`, `inputValidation.js`. |

### `research/weekend-informativeness/` (frozen)

A standalone precondition study, independent of the CDE trial pipeline: does Bitget publish weekend rToken prices that are informative relative to a naive Friday-held baseline? `bitgetClient.js` is the only place in the entire repository that calls the live Bitget REST API — a one-time historical data pull, not something the demo or any research trial re-invokes. `run.js`/`analysis.js`/`selfTest.js` produced the frozen `output/` this study reports; `cde/phase4/population.js` reads that output, never re-fetches it.

### `demo/server/` (the trusted boundary)

| File | Responsibility |
|---|---|
| `dataLoader.js` | Reads the one frozen run and its analysis result into memory once; builds pair records; every other module gets data through this, never by reading `cde/` files itself. |
| `httpServer.js` | Plain `http` server, hand-rolled router, static file serving with path-traversal guards, and the read-only `/vendor/` routes that serve `three`/`animejs` from `node_modules` (no CDN). |
| `integrity.js` | Wraps `cde/phase5/preflight.js` and `runResearchAnalysis.js` verbatim. `verifyExperiment()` re-runs the real preflight checks and a live reproducibility re-run, then restores `analysis_result.json`'s exact original bytes — see below. |
| `orderSensitivity.js` | Re-runs `cde/analysis/lib/runAnalysis.js` (unmodified) in memory under several trial-file orders, to make the p-value's known order-sensitivity (see [REPRODUCIBILITY.md](REPRODUCIBILITY.md)) inspectable rather than asserted. |
| `tamper.js` | Runs a real, disposable-copy mutation against a temp directory and re-runs the real preflight engine against it, to demonstrate the integrity checks actually catch tampering. Never touches `cde/runs/`. |
| `provenance.js`, `baseline.js`, `timeline.js` | Thin, single-purpose wrappers: field-level REAL/DERIVED/FIXTURE classification, the claim-blind baseline comparison, and the commit-anchored experiment timeline. |

### `demo/web/` (judge-facing, presentation only)

`js/main.js` is the router; `js/screens/*` and `js/screens/tabs/*` render one server route each; `js/components/*` are shared, stateless render helpers (the integrity chain-of-custody rail, the experiment diagram, the order-sensitivity table, the replay-mode notice); `js/visual/*` is the Three.js/Anime.js/glass presentation layer, which only ever animates a state some screen already computed from real data — it has no data of its own.

## The REAL / DERIVED / FIXTURE distinction

Every market-state field the demo shows is labeled with exactly one of three provenance classes, enforced in `cde/lib/provenance.js` and re-asserted per-field in `demo/server/provenance.js`:

- **REAL** — `symbol`, `marketTimestampUtc`, `price.last`. Taken verbatim from the precondition study's already-captured historical Bitget record (`research/weekend-informativeness/output/raw_dataset.json`). Never refetched, never recomputed.
- **DERIVED** — order book, volume, and candle fields. The precondition study never captured order-book depth or full OHLCV candles, so `cde/phase4/replaySnapshot.js` builds minimal, clearly-labeled placeholders (a fixed small synthetic spread, zero volume) — never presented as independently observed.
- **FIXTURE** — the injected claim text and template. A member of `cde/lib/corpus.js`'s locked, versioned corpus, injected identically in shape across every trial. Never verified true or false by this instrument.

This split exists specifically so a reader never has to guess which number in a snapshot was actually observed and which is scaffolding required to make the trial replayable.

## Why replay is deterministic (and what the server does, and does not, write)

The demo's factual claims all trace back to `cde/runs/<runId>/` and `cde/analysis/results/<runId>/analysis_result.json`, which are content-hashed and committed. `demo/server/integrity.js`'s live re-verification calls `cde/phase5/runResearchAnalysis.js`, which — by its own frozen design — writes a fresh copy of `analysis_result.json` (with a new timestamp) every time it runs. The demo needs to stay a strictly read-only consumer of frozen evidence, so `verifyExperiment()` reads the file's original bytes first, lets the real function write, compares the freshly computed hash against the original in memory, and then restores the file to its exact original bytes — every time, including on error. Nothing under `cde/analysis/results/` is left modified after a verification run; `npm test`'s suite runner additionally re-asserts this after every test file, in case a suite exercises the same path directly.

`demo/server/analysisInputOrder.json` is a second, narrower determinism concern: it records the exact trial-file read order the committed `analysis_result.json` was produced with, so the live reproducibility check replays that order (via a function-scoped `fs.readdirSync` patch, restored immediately after) rather than whatever order the current OS happens to list files in. See [REPRODUCIBILITY.md](REPRODUCIBILITY.md) for why that matters and what it does not paper over.

## Where a live Bitget adapter would belong

It would sit beside `cde/phase2/provider/anthropicClient.js`, as `cde/phase2/provider/bitgetClient.js` (parallel in shape to `research/weekend-informativeness/bitgetClient.js`, which already exists and already knows the two live endpoints this project has used) implementing the same `get_quote`/`get_orderbook`/`get_market_status` tool responses that `cde/lib/tools.js` already specifies, but backed by live data instead of `cde/phase4/replaySnapshot.js`'s replay. It does not exist. The tool *contract* (`cde/lib/tools.js`) was written condition-agnostic on purpose, specifically so a live adapter could be substituted later without touching the methodology.

## Where a live LLM adapter would belong

One already exists — `cde/phase2/provider/anthropicClient.js` plus `realModelAdapter.js` is exactly this, and it is what actually produced the 41 pairs this repository reports. What does not exist is a *demo-time* invocation of it: the demo never calls out to Anthropic at request time, only replays what Phase 2 already recorded.

## Why the demo intentionally does not instantiate either live dependency

Three reasons, all deliberate:

1. **Reproducibility.** A judge re-running `npm run demo` a week from now, on a different machine, with no API keys configured, sees exactly the same evidence the research run produced — because nothing is being asked again.
2. **Cost and safety.** Every judge click on `VERIFY EXPERIMENT` or the tamper buttons would otherwise cost a real model call or a real market-data call; multiplied across every judge, every reviewer, every re-run, that is neither necessary nor safe to leave switched on by default.
3. **Scope.** This is a hackathon submission's evaluation harness, not a production trading system. The honest boundary — replay-only, one research run, one model configuration — is stated everywhere rather than implied away; see [What CDE does NOT do](README.md#what-cde-does-not-do).

If a live version is ever built, the module boundaries above (`phase2/provider/`, `phase4/`) are exactly where it would plug in, without touching `cde/lib/`'s contracts or `cde/analysis/`'s statistical plan.
