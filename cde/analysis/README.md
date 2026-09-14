# cde/analysis/ — pre-registered analysis plan (Phase 3)

See `ANALYSIS_PLAN.md` for the full, binding plan. `analysis.lock.json` is
the machine-checkable content hash over every statistical decision in it,
including the current `cde/methodology.lock.json` hash it was locked
against.

- `lib/` — pure functions only. No network calls, no model calls, no
  mutable global state, no hidden configuration.
  - `prng.js` — deterministic seeded PRNG (mulberry32), shuffle/resample helpers.
  - `resampling.js` — permutation test (primary significance test) and
    stratified percentile bootstrap (primary CI), both at the pair level.
  - `proportions.js` — Fisher's exact test, Wilson score interval,
    Holm-Bonferroni correction.
  - `inputValidation.js` — classifies raw attempt outcomes into analyzable
    pairs vs. excluded/failed, reading only status/config fields, never
    outcome values (leakage protection — §15/§17).
  - `primaryAnalysis.js` — wraps `cde/lib/metrics.js`'s already-locked
    `injectedDelta`/`did` with the significance test, CI, and median
    sensitivity check.
  - `secondaryAnalysis.js` — the five secondary metrics as formal group
    comparisons + Holm-Bonferroni + the calendar-prior descriptive report.
  - `stratification.js` — exploratory-only tercile stratification.
  - `sampleSizeAssessment.js` — confirmatory/exploratory classification
    against the pre-registered stopping rule.
  - `analysisLock.js` — computes the lock; `runAnalysis.js` — the top-level
    pure pipeline.

Run `node cde/test/phase3.test.js` for the synthetic validation suite —
deterministic fixtures only, never research evidence. No research-scale
data collection has happened; Phase 4 has not started.
