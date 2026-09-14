'use strict';
/**
 * Fixture snapshot loading and validation.
 *
 * Two independent checks, both required:
 *   1. Structural — the object must already satisfy cde/lib/snapshot.js's
 *      contract (it must actually BE a buildSnapshot() output: frozen,
 *      content-hash-verified, all required fields present).
 *   2. Provenance marker — provenance.bitgetEndpoint must start with
 *      "FIXTURE:". This is what stops the research-study's real output
 *      (research/weekend-informativeness/output/raw_dataset.json, whose
 *      records use real endpoints like "/api/v2/spot/market/history-candles"
 *      and a completely different field shape) from ever being usable here,
 *      by accident or otherwise.
 */

const { verifySnapshotIntegrity, REQUIRED_MARKET_FIELDS, REQUIRED_PROVENANCE_FIELDS } = require('../lib/snapshot');

const FIXTURE_MARKER_PREFIX = 'FIXTURE:';

function assertIsFixtureSnapshot(candidate) {
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('Fixture loader received a non-object — not a valid snapshot.');
  }
  for (const f of REQUIRED_MARKET_FIELDS) {
    if (!(f in candidate)) throw new Error(`Fixture snapshot missing required market field: ${f} — this is not a valid CDE snapshot (possibly a foreign/research-study record).`);
  }
  if (!candidate.provenance || typeof candidate.provenance !== 'object') {
    throw new Error('Fixture snapshot has no provenance object — refusing to treat as fixture data.');
  }
  for (const f of REQUIRED_PROVENANCE_FIELDS) {
    if (!(f in candidate.provenance)) throw new Error(`Fixture snapshot provenance missing required field: ${f}`);
  }
  if (typeof candidate.provenance.bitgetEndpoint !== 'string' || !candidate.provenance.bitgetEndpoint.startsWith(FIXTURE_MARKER_PREFIX)) {
    throw new Error(
      `Fixture snapshot's provenance.bitgetEndpoint ("${candidate.provenance && candidate.provenance.bitgetEndpoint}") does not carry the required "${FIXTURE_MARKER_PREFIX}" marker. ` +
        'Real/empirical snapshots (or anything from research/weekend-informativeness/) must never be loaded through this fixture path.'
    );
  }
  if (candidate.provenance.isLive !== false) {
    throw new Error('Fixture snapshots must have provenance.isLive === false — a fixture can never claim to be a live capture.');
  }
  if (!Object.isFrozen(candidate)) {
    throw new Error('Fixture snapshot is not frozen — it was not constructed via buildSnapshot() and cannot be trusted as immutable.');
  }
  if (!verifySnapshotIntegrity(candidate)) {
    throw new Error('Fixture snapshot failed content-hash integrity verification — snapshotId does not match its own market content.');
  }
  return true;
}

/** Load + validate a fixture snapshot. Throws on anything that isn't a genuine, marked, frozen, integrity-verified fixture. */
function loadFixtureSnapshot(snapshot) {
  assertIsFixtureSnapshot(snapshot);
  return snapshot;
}

module.exports = { FIXTURE_MARKER_PREFIX, assertIsFixtureSnapshot, loadFixtureSnapshot };
