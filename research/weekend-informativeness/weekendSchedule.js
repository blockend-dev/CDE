'use strict';
/**
 * Bitget's documented rToken weekend session boundary:
 *   Saturday 08:00 -> Monday 08:00, UTC+8, during US Daylight Saving Time
 *   Saturday 09:00 -> Monday 09:00, UTC+8, Standard Time
 * (per Bitget Academy: "How Bitget Maintains rToken Liquidity Outside U.S.
 * Hours" / "Does Bitget Allow 24/7 US Stock Trading Weekend Liquidity").
 *
 * The DST/Standard split is Bitget's own stated convention, tied to US DST
 * (it exists because the underlying NYSE/Nasdaq session it brackets is
 * itself DST-dependent), not China DST (China does not observe DST).
 *
 * This module does NOT silently substitute a different schedule. If this
 * assumption is ever found to be wrong or to have changed, this is the one
 * file that needs correcting — nothing else encodes the boundary.
 */

const { isUsDst, addDaysUTC } = require('./nyseCalendar');

const UTC8_MS = 8 * 60 * 60 * 1000;

/**
 * Given a UTC Date, find the Saturday (00:00 UTC) of that UTC+8 calendar week,
 * then return { weekendStartUTC, weekendEndUTC } as real UTC Date objects,
 * using DST-aware 08:00/09:00 UTC+8 boundaries.
 */
function weekendBoundsForSaturdayUTC8(saturdayDateUTC8 /* Date at 00:00 UTC representing the UTC+8 calendar day */) {
  const dstAtBoundary = isUsDst(saturdayDateUTC8);
  const startHourLocal = dstAtBoundary ? 8 : 9;
  const endHourLocal = dstAtBoundary ? 8 : 9;

  const weekendStartUTC = new Date(saturdayDateUTC8.getTime() + startHourLocal * 3600 * 1000 - UTC8_MS);
  const mondayDateUTC8 = addDaysUTC(saturdayDateUTC8, 2);
  const weekendEndUTC = new Date(mondayDateUTC8.getTime() + endHourLocal * 3600 * 1000 - UTC8_MS);

  return { weekendStartUTC, weekendEndUTC };
}

/**
 * Enumerate every Bitget weekend session whose boundaries fall within
 * [fromUTC, toUTC), inclusive of a weekend only if it is fully completed
 * (weekendEndUTC <= toUTC) — never a partially-elapsed weekend.
 */
function enumerateCompletedWeekends(fromUTC, toUTC) {
  const weekends = [];
  // Find the first Saturday (UTC+8 calendar date) at or after fromUTC.
  let d = new Date(Date.UTC(fromUTC.getUTCFullYear(), fromUTC.getUTCMonth(), fromUTC.getUTCDate()));
  while (d.getUTCDay() !== 6) d = addDaysUTC(d, 1);

  while (true) {
    const { weekendStartUTC, weekendEndUTC } = weekendBoundsForSaturdayUTC8(d);
    if (weekendStartUTC >= toUTC) break;
    if (weekendEndUTC <= toUTC && weekendStartUTC >= fromUTC) {
      weekends.push({ saturdayUTC8: new Date(d.getTime()), weekendStartUTC, weekendEndUTC });
    }
    d = addDaysUTC(d, 7);
  }
  return weekends;
}

module.exports = { weekendBoundsForSaturdayUTC8, enumerateCompletedWeekends, UTC8_MS };
