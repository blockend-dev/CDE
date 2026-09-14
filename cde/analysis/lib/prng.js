'use strict';
/**
 * Deterministic seeded PRNG (mulberry32 — small, public-domain, not
 * cryptographic). Used ONLY to make permutation/bootstrap resampling
 * reproducible given a fixed seed, per ANALYSIS_PLAN.md §4/§17: "the
 * procedure must be deterministic given a fixed seed." Never used for
 * anything security-sensitive.
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle, in place, driven by the given rng() -> [0,1) function. Deterministic given a deterministic rng. */
function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/** Resample `arr` with replacement, same length as `arr`, driven by rng(). */
function resampleWithReplacement(arr, rng) {
  const out = new Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    out[i] = arr[Math.floor(rng() * arr.length)];
  }
  return out;
}

module.exports = { mulberry32, shuffleInPlace, resampleWithReplacement };
