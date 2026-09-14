'use strict';
/**
 * The four experimental cells and the Weekday/Weekend classifier.
 *
 * The classifier is a thin wrapper around the ALREADY-TESTED weekend
 * boundary logic in research/weekend-informativeness/weekendSchedule.js
 * (Bitget's documented Sat 08:00/09:00 UTC+8 -> Mon 08:00/09:00 UTC+8
 * session, DST-aware). It is deliberately NOT reimplemented here — Phase 0
 * reuses the precondition study's own verified primitives rather than
 * risking two divergent definitions of "weekend" existing in the same repo.
 *
 * Condition is always DERIVED from a real market timestamp, never asserted
 * or configured — there is no code path that lets a caller declare a
 * snapshot "weekend" independent of its own marketTimestampUtc.
 */

const path = require('path');
const { weekendBoundsForSaturdayUTC8 } = require(
  path.join(__dirname, '..', '..', 'research', 'weekend-informativeness', 'weekendSchedule.js')
);

const CONDITIONS = Object.freeze({ WEEKDAY: 'weekday', WEEKEND: 'weekend' });
const CLAIM_STATUSES = Object.freeze({ CLEAN: 'clean', INJECTED: 'injected' });

/** All four cells, in a fixed canonical order. */
const CELLS = Object.freeze([
  `${CONDITIONS.WEEKDAY}_${CLAIM_STATUSES.CLEAN}`,
  `${CONDITIONS.WEEKDAY}_${CLAIM_STATUSES.INJECTED}`,
  `${CONDITIONS.WEEKEND}_${CLAIM_STATUSES.CLEAN}`,
  `${CONDITIONS.WEEKEND}_${CLAIM_STATUSES.INJECTED}`,
]);

function cellFor(condition, claimStatus) {
  if (!Object.values(CONDITIONS).includes(condition)) throw new Error(`Unknown condition: ${condition}`);
  if (!Object.values(CLAIM_STATUSES).includes(claimStatus)) throw new Error(`Unknown claim status: ${claimStatus}`);
  const cell = `${condition}_${claimStatus}`;
  if (!CELLS.includes(cell)) throw new Error(`Cell not in the fixed 2x2 design: ${cell}`);
  return cell;
}

/**
 * Classify a UTC timestamp as weekday or weekend using Bitget's real,
 * documented weekend-session boundary. Walks backward/forward from the
 * timestamp's own UTC+8 calendar Saturday to compute that week's exact
 * boundary (DST-aware), then tests containment — no approximation.
 */
function classifyCondition(marketTimestampUtc) {
  const ts = marketTimestampUtc instanceof Date ? marketTimestampUtc : new Date(marketTimestampUtc);
  if (Number.isNaN(ts.getTime())) throw new Error(`Invalid marketTimestampUtc: ${marketTimestampUtc}`);

  // Find the UTC+8 calendar Saturday nearest to (at or before) ts, then check
  // both that week's boundary and the following week's (a timestamp just
  // after midnight UTC could belong to a boundary computed from the prior
  // Saturday depending on DST arithmetic, so both are checked defensively).
  let saturday = new Date(Date.UTC(ts.getUTCFullYear(), ts.getUTCMonth(), ts.getUTCDate()));
  while (saturday.getUTCDay() !== 6) saturday.setUTCDate(saturday.getUTCDate() - 1);

  for (const candidateSaturday of [saturday, new Date(saturday.getTime() - 7 * 86400000), new Date(saturday.getTime() + 7 * 86400000)]) {
    const { weekendStartUTC, weekendEndUTC } = weekendBoundsForSaturdayUTC8(candidateSaturday);
    if (ts >= weekendStartUTC && ts < weekendEndUTC) return CONDITIONS.WEEKEND;
  }
  return CONDITIONS.WEEKDAY;
}

module.exports = { CONDITIONS, CLAIM_STATUSES, CELLS, cellFor, classifyCondition };
