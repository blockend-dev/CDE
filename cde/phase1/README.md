# Phase 1 — deterministic experimental execution harness

Wires Phase 0's contracts (`cde/lib/`) into an actual, runnable four-cell
pipeline. Run: `node cde/phase1/runExperiment.js` (writes
`output/result.json`, deterministic, and `output/run_log.json`, wall-clock
metadata only, explicitly excluded from the deterministic comparison).
Tests: `node cde/test/phase1.test.js`.

**What this is:** a harness that proves the methodology in `cde/METHODOLOGY.md`
is actually executable, deterministic, and replayable, using synthetic
fixture data and a deterministic stand-in "adapter" in place of a real
model.

**What this is NOT:**
- Not a real LLM. `adapter.js`'s `deterministicTestAdapter` computes its
  quantitative decision by delegating to Phase 0's already-proven
  claim-blind baseline — it cannot react to claim content, by design. A
  real model adapter (Phase 2, not built) would plug into the exact same
  interface.
- Not connected to Bitget Demo, paper trading, or any live endpoint.
  `fixtures/syntheticSnapshots.js` is hand-authored synthetic data, marked
  with a `FIXTURE:` provenance prefix that `fixtureLoader.js` enforces —
  and specifically rejects anything shaped like the real precondition
  study's output (`research/weekend-informativeness/`).
- Not evidence for the CDE hypothesis. Because the adapter is claim-blind
  by construction, the DiD computed from this fixture run is trivially
  zero — that is expected and does not mean anything about the real
  research question. Do not cite `output/result.json` as an experimental
  finding.

Files: `config.js` (fixed, non-wall-clock experiment constants),
`fixtures/syntheticSnapshots.js`, `fixtureLoader.js`, `toolReplay.js`
(deterministic tool implementations + trace), `adapter.js`, `trial.js`
(pairing + per-trial assembly), `integrity.js` (all rejection assertions),
`resultSerializer.js`, `runExperiment.js` (orchestrator).
