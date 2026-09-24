# Reproducibility

What is frozen, what is hash-checked, what is deterministic, and the one known place where re-running this analysis does not reproduce a single bit-identical number. Written so a skeptical, quantitative reader can verify these claims themselves rather than take them on faith.

## The frozen-artifact concept

`cde/` and `research/` are treated as an immutable experimental record, not a live codebase. Once a run completes and its analysis is committed, nothing under `cde/runs/<runId>/`, `cde/analysis/results/<runId>/`, or `research/weekend-informativeness/output/` is edited — corrections, if ever needed, would be a new, separately-dated run, never an in-place edit of this one. This repository as published contains exactly one completed research run: `cde/runs/run-2026-09-19T155659111Z/`.

## Input hashes — what was locked before any trial ran

Every input that could affect the outcome is content-hashed and locked **before** collection begins (`cde/lib/methodologyLock.js`, `cde/analysis/lib/analysisLock.js`):

| Lock | Hash | Covers |
|---|---|---|
| Methodology | `5acc71b0ee54949c04535e10d4fae00e6b85cb79728dbdc5df4b2e455d969d54` | The experimental design: conditions, pairing, corpus, snapshot contract (`cde/METHODOLOGY.md`). |
| Analysis plan | `43e0479499d286f4dfe06fd8ec4a036941cd3df1ff0b8afeaee423e2e167fdd7` | The pre-registered statistical method: estimand, test, CI method, stopping rule (`cde/analysis/ANALYSIS_PLAN.md`). |

Per-run configuration (`cde/runs/<runId>/manifest.json`) additionally hashes the model configuration, the prompt, the tool manifest, and the claim corpus used for that specific run, so a reader can confirm every one of the 41 pairs ran under one identical configuration rather than a silently-drifting one.

## Output hash — what the committed result claims to be

`cde/analysis/results/<runId>/analysis_result.json` carries its own `analysisResultHash`: **`b86deb65b4dc9a416e0a6c8845107cfb8b8fbf225a43ce50979cc1cb7317abd2`**. It hashes the primary and secondary results together with an `analysisCodeFingerprint` — a hash of the exact analysis source files (`cde/lib/metrics.js` plus every file under `cde/analysis/lib/`) that produced it. If either the data or the analysis code the result was computed from changes even slightly, the hash changes, and any reproduction attempt reveals the mismatch instead of silently reporting a different number under the same label.

## The dataset manifest

`cde/runs/<runId>/dataset_manifest.json` hashes the finalized set of 41 completed pairs (21 weekday, 20 weekend) plus the one preserved failed attempt (`datasetManifestHash: 99d3d5af659c28a91697783f5da850a719a173cce772f3e55990e96459e2daf2`). The demo's Integrity Console re-derives this from the raw trial files on every verification click, rather than trusting the stored value.

## The recorded input order

`demo/server/analysisInputOrder.json` records the exact order (a list of 41 trial-file names) the committed `analysis_result.json` was produced under — the order Windows happened to list this run's `trials/` directory in on the machine the research run was executed on. This file exists only because the next section's issue was discovered; it changes no analysis logic and is itself just a record.

## The known issue: the permutation p-value is order-sensitive

**Root cause.** `cde/phase5/preflight.js`'s `readJsonDir()` calls `fs.readdirSync()` on the `trials/` directory without sorting the result. `cde/analysis/lib/resampling.js`'s `permutationTest()` builds one pooled array from the weekday and weekend groups, in whatever order they were handed to it, and shuffles that pooled array with a fixed-seed PRNG (`seed: 424242`, from `cde/analysis/lib/analysisLock.js`). Different input orders therefore produce different — but equally valid — draws from the same permutation distribution, and hence slightly different p-values from the same fixed seed.

**What actually varies, measured by re-running the unmodified analysis code** (`cde/analysis/lib/runAnalysis.js`, in memory, against the same frozen trial files, under different input orders — the reproduction command below does exactly this):

| Input order | DiD | 95% CI | permutation p |
|---|---|---|---|
| Recorded (Windows, as at analysis time — the committed result) | −0.0025 | [−0.0075, 0.0000] | **0.4909** |
| Filename-sorted (what Linux/macOS produce) | −0.0025 | [−0.0075, 0.0000] | 0.4776 |
| Reverse filename-sorted | −0.0025 | [−0.0075, 0.0000] | 0.4941 |
| 60 further random shuffles (fixed seed 20260921, for reproducible reporting) | −0.0025 (every run) | identical (every run) | range 0.4776–0.4966, mean ≈0.488, sd ≈0.0052 |

**Scale check.** The Monte Carlo standard error of a permutation p-value near 0.49 with 10,000 permutations is `√(p(1−p)/N) ≈ 0.005`. The observed spread across every order tested (≈0.005–0.006) matches that expected sampling noise almost exactly. This is the signature of finite-sample Monte Carlo variance, not of a logic error — a logic error would not track the theoretical standard error this closely.

## What is invariant across every order tested

- The point estimate, **DiD = −0.0025**, in every one of the 63 orders above (3 named + 60 random shuffles).
- The 95% bootstrap CI, **[−0.0075, 0.0000]**, in every one of the same 63 orders. The bootstrap resamples within each condition group independently (`cde/analysis/lib/resampling.js: bootstrapCI`) and never touches the pooled cross-group ordering the permutation test depends on, which is exactly why it does not move.
- Every secondary metric's significance verdict: all five secondary tests (`meanAbsExposureDelta`, `meanConfidenceDelta`, `verificationDivergence`, `directionalFlipRate`, `claimAcceptanceRate`) carry a Holm-adjusted p of 1 in the committed result — none are affected in substance by a ≈0.006 shift in the primary p-value.
- Every hash in [Input hashes](#input-hashes--what-was-locked-before-any-trial-ran) and [Output hash](#output-hash--what-the-committed-result-claims-to-be) — those are content hashes over data and code, unrelated to runtime iteration order.

## What is not invariant

Only the two-sided permutation p-value, and only within the range shown above (≈0.4776–0.4966 across every order tested). Nothing else — not the estimate, not the interval, not any secondary conclusion, not any dataset or code hash — has been found to vary.

## No modification of frozen artifacts

This finding is disclosed, not fixed, in the frozen code:

- `cde/phase5/preflight.js`'s analysis logic — the unsorted `readdirSync` this section documents, and every check it runs — is exactly as it was when the committed result was produced. The one exception, made after publishing and fully disclosed below, is two hardcoded commit-reference values unrelated to this order-sensitivity finding.
- `cde/analysis/lib/resampling.js`, `runAnalysis.js`, and every other frozen analysis file are unmodified.
- The committed `cde/analysis/results/<runId>/analysis_result.json` — including its reported p-value of 0.4909 — is unchanged.
- The only files this disclosure required are `demo/server/analysisInputOrder.json` (the recorded order) and `demo/server/orderSensitivity.js` (a read-only, in-memory re-run of the unmodified analysis under several orders, used by the demo's Integrity Console and documented here).

## Reproduce this yourself

From a checkout with `npm install` already run, from the repository root:

```
node -e "
const fs = require('fs');
const { runAnalysis } = require('./cde/analysis/lib/runAnalysis');
const runDir = 'cde/runs/run-2026-09-19T155659111Z';
const names = fs.readdirSync(runDir + '/trials').filter(f => f.endsWith('.json')).sort();
const trials = names.map(f => JSON.parse(fs.readFileSync(runDir + '/trials/' + f, 'utf8')));
const failures = fs.readdirSync(runDir + '/failures').filter(f => f.endsWith('.json')).map(f => JSON.parse(fs.readFileSync(runDir + '/failures/' + f, 'utf8')));
const r = runAnalysis([...trials, ...failures]);
console.log('DiD', r.primary.pointEstimate.did, 'p', r.primary.significance.twoSided.pValue);
"
```

On Linux/macOS this prints `DiD -0.0025 p 0.47755224477552244` — the filename-sorted row above, since `.sort()` is explicit in this snippet. Compare against the committed value in `cde/analysis/results/run-2026-09-19T155659111Z/analysis_result.json`'s `primary.significance.twoSided.pValue` field (`0.49085091490850913`) to see the order-dependence directly. This command reads only frozen files and writes nothing.

For the interactive version — a live re-run of the real preflight engine plus a comparison against the committed hash, and a one-click re-run under three named orders plus 60 shuffles — start the demo (`npm run demo`) and open the Integrity Console (`http://localhost:5175/#/integrity`). `npm test` also exercises this: `demo/test/m1.test.js`–`m13.browser.test.js` include the live integrity check, and `cde/test/phase5.test.js` independently tests the locked analysis code in isolation from any input-order concern.

## A separate finding: Bitget Demo execution was tested directly, and CDE's instruments are not paper-tradable

This is not part of the analysis above — no frozen file, hash, or statistical result is affected by it. Testing whether CDE could be extended into real Bitget paper trading found that Bitget's Demo service explicitly rejects orders on the entire rToken/RWA instrument class (`code 25200`, reproduced across four symbols and two order types), including the two symbols CDE's own research uses. See [README.md § Bitget Demo execution](README.md#bitget-demo-execution--validated-separately-and-why-it-isnt-part-of-cdes-result) for the full evidence. A separately-validated `BTCUSDT` Demo trade confirms the execution infrastructure itself works; it is not connected to any number in this document.

## A disclosed edit made after publishing: two commit references were updated, once

`cde/phase5/preflight.js` includes a check (`no_phase4_or_5_redefinition_of_locked_metrics`) that runs `git log` over the locked analysis files and compares the result against two commit SHAs hardcoded at the time the research concluded, as a defense against a later commit silently redefining a locked metric. Publishing this repository to GitHub rewrote every commit's hash (a hosting-side operation on the repository's git history, done by its author, not an edit to the research itself). Those two specific hardcoded SHAs no longer existed anywhere in history, so the check began failing unconditionally — not because anything had touched the locked analysis files, but because its reference point for "which two commits are the known-safe originals" had gone stale.

**What was changed, and what was not.** `KNOWN_PRE_PHASE4_COMMITS` in `cde/phase5/preflight.js` was updated from the pre-rewrite hashes (`6a9c854…`, `4aaa264…`) to the post-rewrite hashes of the *same two commits* — identical messages ("add real model adapter", "add preregistered analysis plan"), identical authorship, identical dates, identical content — verified directly with `git log -1 --format='%H %ad %s'` against each hash before and after. This is the one edit made to any file under `cde/` after the research concluded. Nothing else in `cde/phase5/preflight.js`, or anywhere else under `cde/` or `research/`, was touched. The check's protection is unchanged in substance: it still fails on *any* commit other than these two specific, named, dated ones touching the locked files — only its reference to what those two commits are called was corrected.

**Why this is different from quietly adjusting evidence.** The check exists to catch exactly this class of action — a commit touching the locked analysis code after the fact — which is precisely why editing it is not done lightly. The distinction that makes this defensible rather than self-defeating: the edit does not broaden what the check accepts (it still recognizes exactly two commits, no more), and it does not touch any file the check actually protects (`cde/lib/metrics.js`, `cde/analysis/lib/`) or any content hash. It corrects a reference to two commits whose *content* provably did not change, only their *name* did, due to an action taken outside the research process entirely.

**What this does and does not mean:**
- It does **not** mean any commit touched the locked analysis files (`cde/lib/metrics.js`, `cde/analysis/lib/`) after the research concluded — every content hash in this document (methodology lock, analysis lock, dataset manifest, analysis result) still verifies exactly as recorded, unaffected by any of this.
- It does **not** mean the demo shows any failure now — the Integrity Console's VERIFY EXPERIMENT reports `ALL CHECKS PASSED` again, correctly, with this fix in place.
- It **does** mean the commit history itself is no longer the original one this research was produced under, and `cde/phase5/preflight.js` is no longer byte-identical to the copy the research concluded under — both real, disclosed facts, not hidden by this document.

## A related, separately-discovered fragility: a frozen test's own scratch output could dirty its own check

While verifying the fix above, `cde/test/phase4.test.js` — frozen, untouched — failed on a genuinely clean checkout: two calls to `buildRunManifest()` a few lines apart, with identical arguments, produced two *different* manifest hashes. The cause: `buildRunManifest()` includes `workingTreeCleanAtStart` (`git status --porcelain` at call time) as a hashed field, and the test's own idempotency check calls it a second time *after* its first call has already written scratch output to `cde/runs/test-orchestrator-full-run/` — output that was never covered by `.gitignore`, so it counted as untracked and made the tree read as "dirty" only on the second call.

**This is not new behavior and nothing was changed to make it pass differently** — it is a timing sensitivity that was always present in the frozen test's design, just never triggered before, because the ambient working tree was apparently never fully clean at exactly that moment in earlier sessions. A genuinely fresh, clean clone — exactly what a judge would have — reliably hits it.

**The fix:** `cde/runs/test-*/` was added to the root `.gitignore`, alongside the `node_modules/`/`.env`/`*.log` entries already there for the identical reason — test-scratch output was always meant to be invisible to git, the same way build artifacts are. No file under `cde/` was touched for this one; the fix is entirely a `.gitignore` addition. `cde/test/phase4.test.js` now passes deterministically on a clean checkout, as its own logic already intended.
