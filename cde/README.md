# cde/ — Corroboration Differential Engine

Phases 0–3. See `METHODOLOGY.md` for the locked design and
`analysis/ANALYSIS_PLAN.md` for the pre-registered statistical analysis
plan.

```
Phase 0 — methodology/contracts       (cde/lib/, cde/METHODOLOGY.md)
Phase 1 — deterministic harness       (cde/phase1/)
Phase 2 — real model boundary         (cde/phase2/)
Phase 3 — pre-registered analysis     (cde/analysis/)
Phase 4 — research execution          NOT STARTED
```

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
- `analysis/` — the pre-registered statistical analysis plan and its pure
  implementation (primary/secondary metrics, significance test, CI method,
  sample-size rule, failure/outlier/stratification policy). Validated only
  against deterministic synthetic fixtures — never research evidence. See
  `analysis/ANALYSIS_PLAN.md` and `analysis/README.md`.
- `test/` — `phase0.test.js`, `phase1.test.js`, `phase2.test.js`,
  `phase3.test.js`.

This directory does not touch Bitget Demo trading, live trading, or serve
a UI anywhere. **No research-scale experiment has been run and no
experimental findings exist yet** — every number produced anywhere under
`cde/` so far is either a deterministic fixture result or a single,
explicitly-labeled model smoke test. Phase 4 (executing the analysis plan
against a real research-scale sample) has not started.
