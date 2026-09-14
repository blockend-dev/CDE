'use strict';
/**
 * Deterministic hashing helpers shared across the CDE contracts. Used to
 * content-address frozen snapshots, lock the methodology, and derive
 * pairing/tool-manifest identity — anywhere two independently-constructed
 * objects with the same logical content must produce the same identifier.
 */

const crypto = require('crypto');

/**
 * Stable JSON stringify: object keys sorted recursively, so hash(a) ===
 * hash(b) whenever a and b are deep-equal, regardless of key insertion
 * order. Matches native JSON.stringify's `undefined` handling exactly
 * (object keys with an undefined value are omitted; array elements that
 * are undefined become `null`) — found necessary when real model API
 * responses (Phase 2) included content-block shapes (e.g. a `thinking`
 * block with no `name`) that a naive implementation silently turned into
 * the unquoted, invalid-JSON token `undefined`.
 */
function stableStringify(value) {
  if (value === undefined) return undefined; // caller (object-key or top-level) handles this per JSON.stringify semantics
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : stableStringify(v))).join(',')}]`;
  const keys = Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Content hash of an arbitrary JSON-serializable value. */
function contentHash(value) {
  return sha256Hex(stableStringify(value));
}

module.exports = { stableStringify, sha256Hex, contentHash };
