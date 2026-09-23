'use strict';
/**
 * How much the Monte Carlo p-value depends on the order the frozen Phase 5
 * loader happens to read the trial files in. The loader lists the trials
 * directory without sorting and the fixed-seed permutation test shuffles a
 * pooled array built in that order, so the p-value moves a little with input
 * order while the point estimate and the bootstrap interval do not.
 *
 * This module re-runs the locked analysis (cde/analysis/lib/runAnalysis.js,
 * unmodified) in memory under different input orders. It reads frozen files
 * and writes nothing; the result is deterministic and cached.
 */

const fs = require('fs');
const path = require('path');

const { runAnalysis } = require('../../cde/analysis/lib/runAnalysis');
const { mulberry32, shuffleInPlace } = require('../../cde/analysis/lib/prng');
const dataLoader = require('./dataLoader');
const RECORDED_TRIAL_ORDER = require('./analysisInputOrder.json').trials;

const SHUFFLE_COUNT = 60;
const SHUFFLE_SEED = 20260921; // fixed, so the shuffled orders (and therefore the summary) are reproducible

function readJsonFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((name) => [name, JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'))]);
}

function primaryFor(rawAttemptOutcomes) {
  const { primary } = runAnalysis(rawAttemptOutcomes);
  return {
    pValue: primary.significance.twoSided.pValue,
    did: primary.pointEstimate.did,
    confidenceInterval: [primary.confidenceInterval.lower, primary.confidenceInterval.upper],
  };
}

function summarizeShuffles(pValues, alpha) {
  const sorted = [...pValues].sort((a, b) => a - b);
  const mean = sorted.reduce((s, p) => s + p, 0) / sorted.length;
  const sd = Math.sqrt(sorted.reduce((s, p) => s + (p - mean) ** 2, 0) / (sorted.length - 1));
  return {
    count: sorted.length,
    seed: SHUFFLE_SEED,
    pMin: sorted[0],
    pMedian: sorted[Math.floor(sorted.length / 2)],
    pMax: sorted[sorted.length - 1],
    pStandardDeviation: sd,
    belowAlphaCount: sorted.filter((p) => p < alpha).length,
  };
}

let cache = null;

function orderSensitivity() {
  if (cache) return cache;

  const data = dataLoader.load();
  const committed = data.analysisResult.primary;
  const { alpha, twoSided } = committed.significance;
  const trialsDir = path.join(dataLoader.RUN_DIR, 'trials');
  const failures = readJsonFiles(path.join(dataLoader.RUN_DIR, 'failures')).map(([, f]) => f);
  const trials = new Map(readJsonFiles(trialsDir));
  const names = [...trials.keys()];

  const recordedSet = new Set(RECORDED_TRIAL_ORDER);
  const named = [
    { key: 'recorded', label: 'Recorded input order (as at analysis time)', order: [...RECORDED_TRIAL_ORDER.filter((n) => trials.has(n)), ...names.filter((n) => !recordedSet.has(n))] },
    { key: 'filename-sorted', label: 'Filename-sorted', order: [...names] },
    { key: 'reverse-sorted', label: 'Reverse filename-sorted', order: [...names].reverse() },
  ];
  const run = (order) => primaryFor([...order.map((n) => trials.get(n)), ...failures]);

  const orders = named.map(({ key, label, order }) => {
    const result = run(order);
    return { key, label, ...result, matchesCommittedPValue: result.pValue === twoSided.pValue };
  });

  const rng = mulberry32(SHUFFLE_SEED);
  const shuffled = Array.from({ length: SHUFFLE_COUNT }, () => run(shuffleInPlace([...names], rng)));

  const identicalTo = (pick, expected) => orders.every((o) => JSON.stringify(pick(o)) === JSON.stringify(expected)) && shuffled.every((o) => JSON.stringify(pick(o)) === JSON.stringify(expected));

  cache = {
    numPermutations: twoSided.numPermutations,
    seed: twoSided.seed,
    alpha,
    committed: {
      pValue: twoSided.pValue,
      did: committed.pointEstimate.did,
      confidenceInterval: [committed.confidenceInterval.lower, committed.confidenceInterval.upper],
    },
    // Finite-sample scale of a Monte Carlo p-value near the committed value: sqrt(p(1-p)/N).
    monteCarloStandardError: Math.sqrt((twoSided.pValue * (1 - twoSided.pValue)) / twoSided.numPermutations),
    orders,
    shuffled: summarizeShuffles(shuffled.map((r) => r.pValue), alpha),
    invariant: {
      did: identicalTo((r) => r.did, committed.pointEstimate.did),
      confidenceInterval: identicalTo((r) => r.confidenceInterval, [committed.confidenceInterval.lower, committed.confidenceInterval.upper]),
    },
  };
  return cache;
}

module.exports = { orderSensitivity };
