'use strict';
/**
 * Proportion-based statistics: Fisher's exact test (two-sample proportion
 * comparison, used for the rate-type secondary metrics — ANALYSIS_PLAN.md
 * §9) and the Wilson score interval (one-sample proportion CI, used for
 * the calendar-prior descriptive report — §10). Both implemented directly
 * (no external stats dependency), exact and appropriate at the small
 * sample sizes this design expects.
 */

function logFactorial(n) {
  let s = 0;
  for (let i = 2; i <= n; i++) s += Math.log(i);
  return s;
}

function logChoose(n, k) {
  if (k < 0 || k > n) return -Infinity;
  return logFactorial(n) - logFactorial(k) - logFactorial(n - k);
}

function hypergeomProb(a, b, c, d) {
  const row1 = a + b;
  const row2 = c + d;
  const col1 = a + c;
  const n = a + b + c + d;
  return Math.exp(logChoose(row1, a) + logChoose(row2, c) - logChoose(n, col1));
}

/**
 * Two-sided Fisher's exact test on a 2x2 contingency table:
 *          | outcome1 | outcome2
 *  groupA  |    a     |    b
 *  groupB  |    c     |    d
 * Sums the probability of every table at least as extreme as the observed
 * one, at the same margins — the standard exact definition.
 */
function fisherExactTwoSided(a, b, c, d) {
  if ([a, b, c, d].some((x) => !Number.isInteger(x) || x < 0)) {
    throw new Error('fisherExactTwoSided requires four non-negative integer counts.');
  }
  const row1 = a + b;
  const row2 = c + d;
  const col1 = a + c;
  const n = row1 + row2;
  if (n === 0) return { applicable: false, reason: 'empty_table' };

  const pObserved = hypergeomProb(a, b, c, d);
  const aMin = Math.max(0, col1 - row2);
  const aMax = Math.min(row1, col1);
  let pValue = 0;
  for (let x = aMin; x <= aMax; x++) {
    const bx = row1 - x;
    const cx = col1 - x;
    const dx = row2 - cx;
    const p = hypergeomProb(x, bx, cx, dx);
    if (p <= pObserved * (1 + 1e-9)) pValue += p;
  }
  return { applicable: true, pValue: Math.min(1, pValue), table: { a, b, c, d } };
}

/** 95%-only Wilson score interval for a single proportion (z fixed at the plan's pre-registered confidence level). */
function wilsonScoreInterval95(successes, n) {
  if (!Number.isInteger(successes) || !Number.isInteger(n) || successes < 0 || n < 0 || successes > n) {
    throw new Error('wilsonScoreInterval95 requires 0 <= successes <= n, both integers.');
  }
  if (n === 0) return { applicable: false, reason: 'empty_sample' };

  const z = 1.959963985; // standard normal quantile for a 95% two-sided interval
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const halfwidth = (z * Math.sqrt(p * (1 - p) / n + (z * z) / (4 * n * n))) / denom;
  return {
    applicable: true,
    proportion: p,
    lower: Math.max(0, centre - halfwidth),
    upper: Math.min(1, centre + halfwidth),
    n,
    confidenceLevel: 0.95,
  };
}

/**
 * Holm-Bonferroni step-down adjustment across a family of raw p-values.
 * Returns one entry per input p-value (order preserved), each with its
 * Holm-adjusted p-value and significance at `alpha`.
 */
function holmBonferroni(pValues, alpha = 0.05) {
  const m = pValues.length;
  const indexed = pValues.map((p, i) => ({ p, i })).sort((x, y) => x.p - y.p);
  const adjustedByOriginalIndex = new Array(m);
  let runningMax = 0;
  for (let k = 0; k < m; k++) {
    const adjP = Math.min(1, (m - k) * indexed[k].p);
    runningMax = Math.max(runningMax, adjP);
    adjustedByOriginalIndex[indexed[k].i] = runningMax;
  }
  return pValues.map((p, i) => ({ pValue: p, adjustedPValue: adjustedByOriginalIndex[i], significant: adjustedByOriginalIndex[i] < alpha }));
}

module.exports = { fisherExactTwoSided, wilsonScoreInterval95, holmBonferroni };
