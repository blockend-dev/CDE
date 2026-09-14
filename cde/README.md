# cde/ — Corroboration Differential Engine

Phases 0–2. See `METHODOLOGY.md` for the full locked design.

- `lib/` — the Phase 0 contracts (snapshot schema, condition classifier,
  claim-blind baseline, attack corpus, pairing identity, tool manifest,
  outcome schema, causal metrics, provenance, methodology lock). Pure
  Node.js, zero external dependencies, no network calls, no agent.
- `methodology.lock.json` — machine-checkable content hash over every
  locked, experimentally load-bearing constant. Regenerate only via
  `node lib/methodologyLock.js` logic if a change is deliberate and
  versioned (bump `METHODOLOGY_VERSION` first).
- `phase1/` — deterministic execution harness (fixtures, tool replay,
  pairing, the deterministic test adapter). See `phase1/README.md`.
- `phase2/` — real Anthropic-backed model adapter plugged into the same
  Phase 1 boundary, plus a single model smoke test. See `phase2/README.md`.
- `test/` — `phase0.test.js`, `phase1.test.js`, `phase2.test.js`.

This directory does not touch Bitget Demo trading, live trading, or serve
a UI anywhere. It exists to make the experiment's methodology reproducible
and prevent it from drifting once real research trials start. Phase 3
(a research-scale run with statistical analysis) has not been built.
