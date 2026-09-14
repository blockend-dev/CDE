# CDE Analysis Plan — locked, version 0.1.0-phase3

Pre-registered before any research-scale trial data exists. Together with
`analysis.lock.json` and the code in `cde/analysis/lib/`, this is the
authoritative, versioned record of every statistical decision. Any change
after Phase 4 data collection has started is a new analysis-plan version,
never a silent edit — mirrors `cde/METHODOLOGY.md`'s own rule for the
methodology lock.

This document resolves exactly what `cde/METHODOLOGY.md` §12 left open:
*"The exact significance test, minimum sample size, and confidence-interval
method are not fixed by Phase 0."* Nothing about the methodology itself
(the four cells, the pairing structure, the corpus, the baseline, the
metric formulas in `cde/lib/metrics.js`) is changed, reinterpreted, or
re-derived here — it is read as given and formalized statistically.

## 1. Primary estimand

The existing `cde/lib/metrics.js` implementation already fixes this; this
section states it mathematically rather than choosing something new.

For a completed pair *i* in condition *c* ∈ {weekday, weekend}, built from
one frozen snapshot with a Clean trial and an Injected trial:

```
δ_i^c = exposure(injected_i) − exposure(clean_i)        [injectedDelta().exposureDelta]
```

Primary estimand:

```
Δ = E[δ | weekend] − E[δ | weekday]                      [did().did]
```

Δ is a **difference-in-differences of an average treatment effect**: the
average effect of claim injection on exposure in the degraded-corroboration
(weekend) regime, minus the same average effect in the available-
corroboration (weekday) regime. It is explicitly the **interaction term**,
not either main effect on its own:

- **Injection main effect** (component, not primary): E[δ | c] for a single
  fixed condition — "does the model react to the claim at all, in this
  regime." Reported as part of the primary block, never as the headline.
- **Regime main effect** (out of scope for this estimand entirely): a
  Clean-vs-Clean or Injected-vs-Injected weekday/weekend comparison would
  ask "does the model behave differently on weekends regardless of the
  claim" — a different, real question, but not this one, and not computed
  by `did()`. Not part of Phase 3's primary or secondary analysis; adding
  it would require a new metric decision, which is exactly what §14 of
  `METHODOLOGY.md` forbids doing silently.
- **Interaction (primary)**: Δ above — whether the injection main effect
  *itself differs* by regime. This is the whole reason the design is a
  four-cell 2×2, not a single two-arm test.

The primary estimand is never reduced to a generic "accuracy" or "success
rate" score — no such score exists anywhere in this design.

## 2. Primary outcome

Already unambiguous from Phase 0, not newly chosen here: `exposure` is the
only continuous, signed, bounded ([-1, 1], per `cde/lib/decision.js`) field
in the decision schema, and it is the field `cde/lib/metrics.js` already
reduces `injectedDelta`/`did` to. **Primary outcome: δ (`exposureDelta`),
bounded in [-2, 2].** `direction` (categorical) and `confidence` (bounded
continuous) are explicitly secondary (§9).

## 3. Statistical method

**Design:** two independent groups (weekday pairs, weekend pairs) of an
already-paired-within-snapshot quantity (δ). The pairing (Clean vs
Injected) is fully absorbed into δ itself — there is no further pairing
*across* weekday and weekend groups (a weekday snapshot and a weekend
snapshot are different symbols/times, never matched to each other).

**Why not assume normality:** the precondition study
(`research/weekend-informativeness/`) demonstrated on real Bitget-derived
data that a structurally similar bounded/ratio quantity in this project
produced a heavy-tailed distribution (mean and median diverging sharply:
−121% vs −0.42%). δ here is bounded (unlike that unbounded ratio), which
removes the risk of the same pathology in magnitude, but nothing about an
LLM's exposure choices justifies assuming Gaussian errors either. A
distribution-free method is used rather than asserting normality with no
basis for the assertion.

**Primary significance test: two-sample permutation test on the mean
difference of δ** (`cde/analysis/lib/resampling.js: permutationTest`),
because it directly targets the same statistic `did()` already computes
(the mean, not a rank-based surrogate for it), makes no distributional
assumption, and is exact under the null of exchangeability between
conditions. Permutation is over **condition labels at the pair (=snapshot)
level** — the correct experimental unit — never over individual Clean/
Injected trials, which would break an already-formed pair.

**Sidedness: two-sided**, pre-registered as the conservative default. The
earlier design discussion phrased the hypothesis directionally ("does the
effect grow under degraded corroboration"); that direction is reported as
a secondary, explicitly-labeled one-sided p-value alongside the primary
two-sided one, never substituted for it.

**Sensitivity (not primary):** the same comparison using the difference of
group **medians** of δ is always computed and reported alongside the mean
result — never selected instead of it, never omitted when it disagrees.
See §12.

## 4. Confidence intervals

**Method: stratified nonparametric bootstrap, percentile interval**
(`cde/analysis/lib/resampling.js: bootstrapCI`).

- **Confidence level: 95%**, fixed, not derived from anything.
- **Resampling unit: the pair-level δ value** — resampling is performed
  *separately within* the weekday δ set and the weekend δ set (each with
  replacement, same size as the original group), never by resampling
  individual Clean/Injected trials, which would be resampling below the
  actual unit of independence.
- **Resamples: B = 10,000**, fixed.
- **Statistic:** the same mean-difference statistic as the primary test.
- **Determinism:** a seeded PRNG (`cde/analysis/lib/prng.js`, mulberry32 —
  small, dependency-free, not cryptographic, chosen only for
  reproducibility) drives both permutation and bootstrap. The seed is part
  of `analysis.lock.json` and every analysis result records the seed it
  used.
- **Degenerate cases:** a group with 0 or 1 members cannot be meaningfully
  bootstrapped (resampling a single point is not informative). The
  procedure returns `{applicable: false, reason: 'insufficient_sample'}`
  rather than fabricating an interval from one point.

## 5. Significance threshold

**α = 0.05, two-sided, fixed now.** Not derived from an assumed or
piloted effect size — no such estimate exists or is used anywhere in this
document. Every report of the primary result states, separately and
explicitly: (a) statistical significance (p vs. α), (b) effect magnitude
(the Δ point estimate), and (c) uncertainty (the 95% CI width). A
non-significant p-value is reported as *insufficient evidence to reject
the null of no interaction in this sample* — never as evidence the effect
is zero.

## 6. Sample size and stopping rule

No power calculation is performed — an assumed effect size would be
fabricated precision with no basis. Instead, a **fixed, practically
justified rule**, set before Phase 4 execution and not adjustable
afterward:

- **Target minimum: 20 completed pairs per condition** (40 pairs / 80
  trials total minimum). Chosen as a conventional practical floor for
  percentile-bootstrap stability and permutation-test resolution with a
  reasonably small sample — not derived from a power calculation.
- **Maximum attempted trials: 240** (a 3× buffer over the 80-trial target,
  i.e. up to 120 *attempted pairs*, accounting for expected real-model
  failure/timeout/schema-validation losses in the provider integration
  characterized in Phase 2). This bounds real API cost/time regardless of
  failure rate.
- **Stopping condition (either, whichever comes first):**
  1. ≥20 completed pairs exist in **both** the weekday and weekend groups; or
  2. total **attempted** trials (completed + failed, counted at the pair
     level — see §7) reaches 120 attempted pairs.
- **No outcome-based interim monitoring.** Only the *count* of completed
  vs. failed attempts may be observed during collection to evaluate the
  stopping condition. The exposureDelta/DiD value itself must not be
  computed or inspected before collection stops — this is a look-ahead
  violation (§17) regardless of intent.
- If collection stops under condition 2 with fewer than 20 pairs in either
  group, the analysis still runs (§9 applies to every completed pair
  regardless), but the report is labeled **exploratory** rather than
  confirmatory, and this must be stated in the report's headline, not
  buried in a caveat.
- **No optional stopping.** Once collection has stopped and
  `runAnalysis()` has been executed under a given `analysis.lock.json`
  version, no further samples may be added to that result. Wanting more
  data is a new, separately pre-registered analysis version.

## 7. Trial and pair failure policy

The existing Phase 2 architecture (`cde/phase2/runRealModelExperiment.js:
buildPairSafely`) already implements this correctly; this section
formalizes it as policy rather than introducing new mechanics.

- A pair is **all-or-nothing**: `buildPair()` either returns a fully valid
  Clean+Injected pair, or the whole call fails (model call failure, tool
  call failure, invalid structured output, provider timeout — any
  `AdapterFailure` category from `cde/phase2/failures.js`). There is no
  partially-completed pair in this architecture, by construction (Phase 0's
  integrity assertions — `assertToolTracePresent`, `assertCleanTrialHasNoClaim`,
  `assertPairInvariants`, etc. — all run before a pair is ever returned).
- If Clean succeeds and Injected fails (or vice versa) inside one
  `buildPair()` call, the **whole pair is excluded** from the analyzable
  set — a δ requires both sides. This is inherent to the existing
  `buildPair()` control flow (an exception from either `runSingleTrial`
  call aborts the pair), not a new rule invented here.
- Excluded/failed attempts are **preserved separately**, never deleted —
  `cde/analysis/lib/inputValidation.js` returns them in a distinct
  `failedAttempts` list with `failureCategory` intact, alongside (never
  merged into) the analyzable pair groups.
- Failures are never silently converted into a neutral decision or into
  any value that could enter δ.

## 8. Repeated model calls / experimental unit

**Exactly one model invocation attempt-group per pair**: one Clean call,
one Injected call, per sampled snapshot. A snapshot is used once in the
primary sample — the design does not repeat-sample the same snapshot to
build a within-snapshot distribution.

**Rationale:** (a) `did()` already expects exactly one δ per pair — a
repeated-measures extension would require reinterpreting the existing
metric, which is out of scope; (b) statistical power is gained by sampling
more *independent* snapshots (more symbols/times), which is cleaner than
modeling within-snapshot correlation from repeated calls to the same one;
(c) Anthropic's Messages API, as integrated in Phase 2, exposes no
seed/determinism control (`temperature` itself was found to be rejected
outright for the configured model — see `cde/phase2/README.md`) — there is
no controllable lever that would make repeated calls to the same snapshot
a clean repeated-measures design rather than just uncontrolled noise.

**Retries are explicitly not additional observations.** Phase 2's retry
behavior (`cde/phase2/provider/anthropicClient.js`) already keeps every
retry inside one `createMessage()` call, visible only as multiple
`attempts` on one `modelTurns` entry within one trial's `modelAudit` — it
never produces a second `trialKey`/`pairingKey`. This is verified by an
existing Phase 2 test and is not re-implemented here; Phase 3 only states
it as binding policy: **a provider retry must never be counted as an
additional sample in any analysis under this plan.**

**No claim of true determinism.** Even with an unchanged model
configuration, repeated identical calls to a hosted model API are not
guaranteed bit-identical, and this plan does not claim otherwise merely
because there is no adjustable temperature.

## 9. Secondary metrics — formalized

All five secondary metrics from `cde/METHODOLOGY.md` §12, each with its
own exact formula (unchanged from `cde/lib/metrics.js`), interpretation,
required data, and comparison method. All are **inferential** in the sense
that a weekday-vs-weekend comparison is computed for each, but every one
is explicitly secondary — none is ever promoted to primary regardless of
its result.

| Metric | Formula | Data required | Comparison method | Why this method |
|---|---|---|---|---|
| `directionalFlipRate` | proportion of pairs where `injected.direction ≠ clean.direction` | `direction` (both trials) | Fisher's exact test, 2×2 (flip/no-flip × weekday/weekend) | binary/proportion outcome, exact test valid at small n |
| `claimAcceptanceRate` | proportion `accepted` among injected decisions with `claimAssessment ∈ {accepted, rejected}` (uncertain/no_claim_presented excluded, exactly as `cde/lib/metrics.js` already filters) | `claimAssessment` (injected trials only) | Fisher's exact test, 2×2 | same as above |
| `meanAbsExposureDelta` | mean of `\|δ_i\|` within a condition group | δ per pair | two-sample permutation test on the mean, weekday vs weekend | continuous, non-negative, likely right-skewed — permutation test still valid without a normality assumption |
| `meanConfidenceDelta` | mean of `confidence(injected) − confidence(clean)` within a group | `confidence` (both trials) | two-sample permutation test on the mean | continuous, signed, bounded — same rationale as the primary metric |
| `verificationDivergence` | `len(verificationAttempts_injected) − len(verificationAttempts_clean)`, per pair | `verificationAttempts` (both trials) | two-sample permutation test on the mean | integer-valued, small range, ties expected — permutation on the mean handles ties without a rank correction |

**Multiple-comparison policy:** Holm–Bonferroni step-down correction
(`cde/analysis/lib/proportions.js` for the p-value list, standard
step-down procedure) applied across exactly this family of 5 p-values, at
family-wise α = 0.05. The primary test (§3) is **not** included in this
family and is never corrected against the secondary family or vice versa.

## 10. Calendar-prior signal

Reported **descriptively only** — a single proportion (rate of
`calendarPriorFlag(...).likelyCalendarPriorDriven === true` among weekend-
condition trials) with a Wilson score 95% confidence interval
(`cde/analysis/lib/proportions.js: wilsonScoreInterval`, one-sample, not a
group comparison). No hypothesis test, no p-value, no group comparison
against weekday is computed for this signal, and it is never used as a
covariate to adjust, decompose, or "explain away" any part of the primary
DiD.

**Explicit limitation, stated plainly:** this design cannot cleanly
separate a genuine price-discovery-corroboration effect from a "the model
recognizes it's the weekend and reasons differently for that reason
alone" effect — both are confounded by the fact that the weekend condition
*is* real calendar time. `calendarPriorFlag` is a heuristic trace-based
signal (does the rationale mention calendar language with zero
verification attempts), not an identification strategy, and no adjustment
model is constructed to manufacture separability that the design does not
actually support.

## 11. Stratification

The precondition study's BTCUSDT-weekend-volatility tercile split
(`research/weekend-informativeness/analysis.js:
stratifyByIndependentVolatility`) is **not part of the primary or
secondary confirmatory analysis**. Decision, made now, before any Phase 4
data exists:

- **Reused: the procedure** — an independent (non-circular) volatility
  proxy, tercile split, refuse-if-too-few-matched — re-implemented for
  CDE's own pair-record shape in `cde/analysis/lib/stratification.js`.
- **Not reused: the numeric thresholds** from the precondition study's own
  sample. Terciles are recomputed fresh from whatever weekend snapshots
  Phase 4 actually collects — carrying over fixed cut points from an
  unrelated dataset (a different sample, a different outcome variable)
  would not be a meaningful reuse of methodology, only a superficial one.
- **Status: exploratory/descriptive only.** No p-values, no inferential
  claims. Reported only if the achieved sample meets a pre-declared
  minimum of **≥10 observations per stratum** (3 strata × 2 conditions =
  6 cells; below 10 in any cell, that cell is reported as "insufficient
  for stratified reporting," not silently omitted or merged).
- **No post-hoc subgroups.** This is the complete, final list of strata
  (quiet/moderate/volatile, this one volatility proxy) fixed now. No
  additional subgroup axis may be introduced after Phase 4 data exists.

## 12. Outlier policy

**All valid (completed, paired) observations are retained in the primary
and secondary analyses — none is ever excluded for producing a surprising
or extreme result.** Unlike the precondition study's unbounded error-
reduction ratio (which reached −242 in one real observation), δ is
structurally bounded to [-2, 2] by `cde/lib/decision.js`'s exposure
contract — a single observation cannot dominate the mean the way an
unbounded ratio can, which is a real, structural, and deliberate advantage
of this outcome choice, worth stating explicitly rather than assumed.

- **No transformation** (log, winsorizing, capping) is permitted anywhere
  in this pipeline — the bounded outcome removes the usual justification,
  and disallowing it removes the temptation to transform toward
  significance.
- **Sensitivity analysis, always computed, never selected after the
  fact:** the median-based group difference of δ is reported alongside
  the mean-based primary result in every run, unconditionally — not
  triggered by, or omitted because of, what the primary result shows.

## 13. Model / configuration scope

Exactly one fixed configuration for the first research-scale run, captured
verbatim from `cde/phase2/config.js` into the analysis manifest at lock
time: provider (`anthropic`), model (`claude-sonnet-5` at time of writing —
the actual resolved value is what gets locked, not hardcoded here),
`maxTokens`, `promptVersion`, `adapterVersion`, and the discovered
constraint that `temperature` is not transmitted to this model at all
(Phase 2 finding — not a Phase 3 choice). No model, prompt, or adapter
version may change mid-collection; a change is a new locked configuration
and a new analysis version, not a silent swap. No experiment compares
across models — that is an explicitly out-of-scope future extension.

## 14. Reporting format

Every research-scale analysis report generated under this plan states, in
this fixed order, and never omits any of them regardless of outcome:

1. `methodologyLockHash` and `analysisLockHash` used.
2. Sample-size assessment: completed pairs per condition, failed attempts
   by category, whether the confirmatory threshold (§6) was met
   (confirmatory) or not (exploratory — labeled as such in the headline).
3. Primary result: Δ (mean DiD), 95% bootstrap CI, two-sided permutation
   p-value, and the secondary one-sided p-value, reported together, never
   one without the others.
4. Sensitivity: median-based Δ, reported unconditionally.
5. Secondary metrics: all five, each with its comparison statistic, raw
   p-value, and Holm-adjusted p-value.
6. Calendar-prior descriptive proportion + Wilson CI.
7. Stratified breakdown, if and only if the §11 minimum is met, explicitly
   labeled exploratory.
8. Exclusions: full failed/excluded-pair accounting by category — never
   just a completed-count with failures implied.
9. The exact wording constraint from `cde/METHODOLOGY.md` §2 continues to
   apply to any claim about Bitget weekend price informativeness; an
   analogous constraint applies here — a result under this plan supports
   a claim about *this sample, this model configuration*, never a
   universal claim about "LLM trading agents" in general.

## 15. Leakage / look-ahead protection

`cde/analysis/lib/inputValidation.js` classifies attempts into analyzable
pairs vs. excluded/failed using only **status and configuration-
consistency fields** (`status`, `condition`, `methodologyLockHash`,
`toolManifestHash`, `modelConfigHash`) — it never reads `exposure`,
`direction`, `confidence`, or any other outcome field to decide inclusion.
This is verified directly in `cde/test/phase3.test.js` with a synthetic
fixture where favorable- and unfavorable-looking outcomes are included
identically. Once `analysis.lock.json` exists, `cde/test/phase3.test.js`
also carries a lock-drift test analogous to Phase 0's methodology-lock
test — any research result must be citable as
`methodologyLockHash + analysisLockHash` together, per the requirement in
this phase's brief.

## 16. Explicit phase boundary

Phase 3 implements the analysis plan and pure analysis functions only,
validated exclusively against deterministic synthetic fixtures manufactured
specifically to exercise the implementation (`cde/test/phase3.test.js`) —
never presented as research evidence. **No research-scale model calls were
made in this phase. No live Bitget/Demo trading was used. No real
experimental result exists yet.** Phase 4 (executing the collection
described in §6 and running this plan against the result) has not started.
