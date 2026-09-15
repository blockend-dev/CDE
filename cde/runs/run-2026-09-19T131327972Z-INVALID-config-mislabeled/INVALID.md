# INVALID RUN — do not use for analysis

This run (40/40 real Anthropic model calls, 20 weekday + 20 weekend pairs,
0 failures) is preserved for audit only. **Do not feed it into
`cde/analysis/lib/runAnalysis.js`.**

**Defect:** `cde/phase4/orchestrator.js` called `buildPairSafely()` without
passing `modelConfigHash`/`promptHash`/`experimentVersion`/`seed`, so every
trial in this run fell back to `cde/phase1/trial.js: buildPair()`'s
defaults — Phase 1's *deterministic-adapter* config identity
(`experimentVersion: "phase1-0.1.0"`, and Phase 1's `adapterConfigHash()`)
— instead of Phase 2's real model config identity, even though the real
Anthropic adapter genuinely was used for every decision (each trial's
`decision.modelAudit` proves this).

**Consequence:** the underlying model outputs in this run are real and
were not otherwise compromised, but every trial's `modelConfigHash` and
`experimentVersion` fields — and therefore every `pairingKey` computed
from them — are mislabeled. This violates the explicit requirement that
"the exact model/configuration used for the research run must be
recoverable from the artifact." Rather than rewrite the stored artifacts
in place (which `cde/phase1/trial.js`'s own documentation and this
project's conventions treat as evidence tampering) or silently ignore the
mislabeling, this run was discarded and re-collected cleanly under a new
run ID after fixing the bug in `orchestrator.js`.

See the commit that both fixes `cde/phase4/orchestrator.js` and adds this
file for the full detail.
