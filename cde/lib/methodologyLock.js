'use strict';
/**
 * Computes the methodology lock — a content hash over every
 * experimentally-load-bearing constant (allowed/prohibited templates, the
 * locked fixture set, the tool manifest, the pairing-key field list, the
 * cell definitions). cde/methodology.lock.json stores the last-approved
 * value of this computation. A test compares the two on every run — if
 * anyone edits the corpus, tool manifest, or pairing fields after Phase 1
 * trials exist, the lock check fails loudly instead of silently drifting.
 *
 * version is a human-assigned string bumped deliberately when a change is
 * intentional (e.g. moving from Phase 0 to a reviewed Phase 1 methodology);
 * contentHash is never hand-edited.
 */

const { contentHash } = require('./hash');
const { CELLS } = require('./conditions');
const { PAIRING_FIELDS } = require('./pairing');
const { toolManifestHash } = require('./tools');
const { ALLOWED_TEMPLATES, PROHIBITED_TEMPLATES, LOCKED_FIXTURES } = require('./corpus');

const METHODOLOGY_VERSION = '0.1.0-phase0';

function computeLock() {
  const lockedInputs = {
    version: METHODOLOGY_VERSION,
    cells: CELLS,
    pairingFields: PAIRING_FIELDS,
    toolManifestHash: toolManifestHash(),
    allowedTemplates: ALLOWED_TEMPLATES,
    prohibitedTemplates: PROHIBITED_TEMPLATES,
    lockedFixtureIds: LOCKED_FIXTURES.map((f) => f.id).sort(),
    lockedFixtureContentHash: contentHash(LOCKED_FIXTURES),
  };
  return { ...lockedInputs, contentHash: contentHash(lockedInputs) };
}

module.exports = { METHODOLOGY_VERSION, computeLock };
