'use strict';
/**
 * Deterministic US market calendar + US DST helpers.
 * No network access, no external data — pure date arithmetic so the
 * weekend-boundary and Monday-reference logic can be unit-tested and
 * audited without trusting a hardcoded holiday list.
 *
 * All functions operate on UTC-based Date objects unless noted.
 */

// --- generic "nth weekday of month" helpers -------------------------------

/** 0=Sun..6=Sat. Returns UTC Date for the nth (1-indexed) given weekday in a month. */
function nthWeekdayOfMonth(year, monthIndex0, weekday, n) {
  const first = new Date(Date.UTC(year, monthIndex0, 1));
  const firstWeekday = first.getUTCDay();
  let day = 1 + ((7 + weekday - firstWeekday) % 7) + (n - 1) * 7;
  return new Date(Date.UTC(year, monthIndex0, day));
}

/** Last given weekday in a month (e.g. last Monday of May). */
function lastWeekdayOfMonth(year, monthIndex0, weekday) {
  const lastDay = new Date(Date.UTC(year, monthIndex0 + 1, 0)); // day 0 of next month = last day of this month
  const diff = (lastDay.getUTCDay() - weekday + 7) % 7;
  lastDay.setUTCDate(lastDay.getUTCDate() - diff);
  return lastDay;
}

/** Meeus/Jones/Butcher algorithm — deterministic Easter Sunday (Gregorian), UTC. */
function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function addDaysUTC(date, days) {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

/**
 * Federal observed-holiday shift: Saturday -> observed Friday,
 * Sunday -> observed Monday. NYSE follows this for its fixed-date holidays.
 */
function observedIfWeekend(date) {
  const dow = date.getUTCDay();
  if (dow === 6) return addDaysUTC(date, -1); // Sat -> Fri
  if (dow === 0) return addDaysUTC(date, 1); // Sun -> Mon
  return date;
}

/**
 * NYSE full-day holidays for a given year, as a Set of ISO date strings (UTC).
 * Rules, not a hardcoded list, so the same code is valid for any year.
 * Does NOT include early-close days (e.g. day after Thanksgiving, Christmas
 * Eve) — those are half sessions, not closures, and are out of scope for
 * this analysis (documented limitation in README).
 */
function nyseHolidays(year) {
  const set = new Set();
  const add = (d) => set.add(isoDate(observedIfWeekend(d)));

  add(new Date(Date.UTC(year, 0, 1))); // New Year's Day
  add(nthWeekdayOfMonth(year, 0, 1, 3)); // MLK Day - 3rd Monday of Jan
  add(nthWeekdayOfMonth(year, 1, 1, 3)); // Presidents Day - 3rd Monday of Feb
  add(addDaysUTC(easterSunday(year), -2)); // Good Friday
  add(lastWeekdayOfMonth(year, 4, 1)); // Memorial Day - last Monday of May
  add(new Date(Date.UTC(year, 5, 19))); // Juneteenth (from 2022)
  add(new Date(Date.UTC(year, 6, 4))); // Independence Day
  add(nthWeekdayOfMonth(year, 8, 1, 1)); // Labor Day - 1st Monday of Sept
  add(nthWeekdayOfMonth(year, 10, 4, 4)); // Thanksgiving - 4th Thursday of Nov
  add(new Date(Date.UTC(year, 11, 25))); // Christmas Day

  return set;
}

function isNyseHoliday(dateUTC) {
  const year = dateUTC.getUTCFullYear();
  return nyseHolidays(year).has(isoDate(dateUTC));
}

function isWeekend(dateUTC) {
  const dow = dateUTC.getUTCDay();
  return dow === 0 || dow === 6;
}

/** True if NYSE/Nasdaq is a regular trading day (not weekend, not holiday). */
function isNyseTradingDay(dateUTC) {
  return !isWeekend(dateUTC) && !isNyseHoliday(dateUTC);
}

/** Next NYSE trading day strictly after the given UTC calendar date. */
function nextNyseTradingDay(dateUTC) {
  let d = addDaysUTC(dateUTC, 1);
  while (!isNyseTradingDay(d)) d = addDaysUTC(d, 1);
  return d;
}

// --- US DST (affects the UTC offset used to express NYSE local times, and
// is also the convention Bitget itself uses to describe its weekend window
// in UTC+8: "08:00 during DST / 09:00 Standard Time") --------------------

/** US DST: 2nd Sunday of March 02:00 local -> 1st Sunday of November 02:00 local. */
function usDstBoundsUTC(year) {
  const start = nthWeekdayOfMonth(year, 2, 0, 2); // 2nd Sunday of March
  const end = nthWeekdayOfMonth(year, 10, 0, 1); // 1st Sunday of November
  // Approximate the 2am local transition as 07:00 UTC (ET is UTC-5 standard / UTC-4 DST;
  // this analysis only needs the *date* of transition, not the exact hour, since all
  // weekend-boundary math below is done at day granularity).
  return { start, end };
}

function isUsDst(dateUTC) {
  const { start, end } = usDstBoundsUTC(dateUTC.getUTCFullYear());
  return dateUTC >= start && dateUTC < end;
}

module.exports = {
  nthWeekdayOfMonth,
  lastWeekdayOfMonth,
  easterSunday,
  addDaysUTC,
  isoDate,
  nyseHolidays,
  isNyseHoliday,
  isWeekend,
  isNyseTradingDay,
  nextNyseTradingDay,
  isUsDst,
};
