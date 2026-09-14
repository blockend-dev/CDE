'use strict';
/**
 * Research population — reuses the precondition study's own validity
 * concept (`metrics.valid === true`, the exact same 887-observation
 * definition already used and reported in
 * research/weekend-informativeness/README.md) rather than inventing new
 * filtering criteria. No live Bitget call anywhere in this module — it
 * only reads the already-committed, immutable
 * research/weekend-informativeness/output/raw_dataset.json.
 *
 * Produces two DETERMINISTIC, fixed-order candidate queues (weekday,
 * weekend) — sorted by symbol then saturdayIso, never by anything
 * outcome-related — so which candidates get attempted first is fixed
 * before any model call happens (ANALYSIS_PLAN.md / Phase 4 §15: no
 * outcome-based selection).
 */

const fs = require('fs');
const path = require('path');
const { buildReplaySnapshot } = require('./replaySnapshot');
const { classifyCondition } = require('../lib/conditions');

const RAW_DATASET_PATH = path.join(__dirname, '..', '..', 'research', 'weekend-informativeness', 'output', 'raw_dataset.json');

function loadPreconditionRecords() {
  const raw = fs.readFileSync(RAW_DATASET_PATH, 'utf8');
  return JSON.parse(raw);
}

/** Exactly the precondition study's own validity definition — reused, not redefined. */
function validRecords() {
  return loadPreconditionRecords().filter((r) => r.metrics && r.metrics.valid === true);
}

function deterministicSort(records) {
  return [...records].sort((a, b) => (a.symbol === b.symbol ? a.saturdayIso.localeCompare(b.saturdayIso) : a.symbol.localeCompare(b.symbol)));
}

/**
 * Builds the two candidate queues. Each candidate is
 * `{ record, condition, snapshot }` — the snapshot is built eagerly (pure,
 * cheap, no I/O) so a caller can inspect `snapshot.condition` and exclude
 * a candidate deterministically (never based on outcomes) if the derived
 * condition doesn't match the intended one — a consistency check, not a
 * selection mechanism.
 */
function buildCandidateQueues() {
  const sorted = deterministicSort(validRecords());
  const build = (condition) =>
    sorted
      .map((record) => {
        try {
          const snapshot = buildReplaySnapshot(record, condition);
          const consistent = classifyCondition(snapshot.marketTimestampUtc) === condition && snapshot.condition === condition;
          return consistent ? { record, condition, snapshot } : null;
        } catch (_) {
          return null; // missing real data for this record/condition — excluded, not fabricated (see replaySnapshot.js)
        }
      })
      .filter(Boolean);

  return { weekdayCandidates: build('weekday'), weekendCandidates: build('weekend') };
}

module.exports = { RAW_DATASET_PATH, loadPreconditionRecords, validRecords, buildCandidateQueues };
