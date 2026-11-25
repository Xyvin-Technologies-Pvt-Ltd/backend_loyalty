const moment = require("moment-timezone");

/**
 * Single source of truth for the loyalty platform's business day.
 *
 * The production container runs UTC (node:18-alpine, no TZ, no tzdata), but the
 * business day is Oman. Any code that derives a calendar day from server-local
 * time is therefore 4 hours out, which is what made the 02:00-Oman expiry batch
 * appear on different dates in the summary and detailed reports.
 *
 * moment-timezone bundles its own IANA data, so every function here is correct
 * regardless of the server's TZ setting and does not require tzdata in the image.
 */
const OMAN_TIMEZONE = "Asia/Muscat";

/**
 * Parse a report/filter date into an Oman-anchored moment.
 *
 * Accepts a bare "YYYY-MM-DD" (the usual query-param shape) and also tolerates a
 * full ISO datetime, in which case the leading calendar date is used. Returns
 * null rather than an Invalid Date so callers can reject bad input instead of
 * silently building a query that matches nothing.
 *
 * @param {string|Date|import("moment").Moment} value
 * @returns {import("moment-timezone").Moment|null}
 */
const parseOmanDate = (value) => {
  if (value === null || value === undefined || value === "") return null;

  const parsed =
    value instanceof Date || moment.isMoment(value)
      ? moment(value).tz(OMAN_TIMEZONE)
      : moment.tz(String(value), "YYYY-MM-DD", OMAN_TIMEZONE);

  return parsed.isValid() ? parsed : null;
};

/**
 * First instant of the Oman day containing `value`. Returns null on bad input.
 * @returns {Date|null}
 */
const startOfOmanDay = (value) => {
  const parsed = parseOmanDate(value);
  return parsed ? parsed.startOf("day").toDate() : null;
};

/**
 * Last instant (23:59:59.999 Oman) of the Oman day containing `value`.
 *
 * This is the fix for the "last day of the range returns nothing" defect: a bare
 * `new Date("2026-08-16")` is 2026-08-16T00:00:00Z, so an inclusive upper bound
 * built from it excludes the entire day.
 *
 * @returns {Date|null}
 */
const endOfOmanDay = (value) => {
  const parsed = parseOmanDate(value);
  return parsed ? parsed.endOf("day").toDate() : null;
};

/**
 * Resolve a report window into absolute instants using Oman day boundaries, so
 * every report buckets a given calendar day identically.
 *
 * @param {string} [startDate] "YYYY-MM-DD"
 * @param {string} [endDate]   "YYYY-MM-DD"
 * @param {Object} [options]
 * @param {"month"|"none"} [options.fallback="month"] What to use when a bound is
 *   missing. "month" gives the current Oman month (the reports' long-standing
 *   behaviour); "none" leaves the bound null so the caller can omit the filter.
 * @returns {{ startDate: Date|null, endDate: Date|null }}
 */
const resolveOmanDateRange = (startDate, endDate, { fallback = "month" } = {}) => {
  const nowOman = moment().tz(OMAN_TIMEZONE);
  const fallbackStart =
    fallback === "month" ? nowOman.clone().startOf("month").toDate() : null;
  const fallbackEnd =
    fallback === "month" ? nowOman.clone().endOf("month").toDate() : null;

  return {
    startDate: startOfOmanDay(startDate) ?? fallbackStart,
    endDate: endOfOmanDay(endDate) ?? fallbackEnd,
  };
};

/**
 * Format an instant as an Oman-local date string for display, filenames and
 * exports. Defaults to the DD-MM-YYYY shape used across the admin exports.
 *
 * @returns {string} `fallback` when the value cannot be parsed.
 */
const formatOmanDate = (date, format = "DD-MM-YYYY", fallback = "-") => {
  if (date === null || date === undefined || date === "") return fallback;
  const parsed = moment(date).tz(OMAN_TIMEZONE);
  return parsed.isValid() ? parsed.format(format) : fallback;
};

/**
 * The Oman calendar day of `date`, re-anchored at UTC midnight.
 *
 * Used for storing a day as a key (Focus9 SQL TransactionDate, daily summary
 * documents) where the value represents a whole day, not an instant.
 *
 * @returns {Date|null}
 */
const toOmanCalendarDate = (date) => {
  const parsed = date === null || date === undefined ? null : moment(date).tz(OMAN_TIMEZONE);
  if (!parsed || !parsed.isValid()) return null;
  return new Date(`${parsed.format("YYYY-MM-DD")}T00:00:00.000Z`);
};

/**
 * Start and end instants of the Oman month containing `date`.
 *
 * Replaces the `new Date(now); d.setDate(1)` idiom, which both resolves the
 * month in server-local time and — because it never snaps to midnight — makes
 * "this month" mean "since the 1st, at whatever time it is right now."
 *
 * @returns {{ start: Date, end: Date }}
 */
const omanMonthRange = (date = new Date()) => {
  const parsed = moment(date).tz(OMAN_TIMEZONE);
  return {
    start: parsed.clone().startOf("month").toDate(),
    end: parsed.clone().endOf("month").toDate(),
  };
};

/**
 * Start instant of the current usage period for a frequency-based limit.
 *
 * DAILY/WEEKLY/MONTHLY snap to the start of the Oman day/week/month. BIWEEKLY is
 * a rolling 14-day window (there is no calendar anchor for it), so it keeps the
 * current time of day, matching the existing behaviour.
 *
 * @param {"DAILY"|"WEEKLY"|"BIWEEKLY"|"MONTHLY"} frequency
 * @returns {Date|null} null for an unrecognised frequency (e.g. "TOTAL")
 */
const omanPeriodStart = (frequency, now = new Date()) => {
  const parsed = moment(now).tz(OMAN_TIMEZONE);

  switch (frequency) {
    case "DAILY":
      return parsed.startOf("day").toDate();
    case "WEEKLY":
      return parsed.startOf("week").toDate();
    case "BIWEEKLY":
      return parsed.subtract(14, "days").toDate();
    case "MONTHLY":
      return parsed.startOf("month").toDate();
    default:
      return null;
  }
};

module.exports = {
  OMAN_TIMEZONE,
  parseOmanDate,
  startOfOmanDay,
  endOfOmanDay,
  resolveOmanDateRange,
  formatOmanDate,
  toOmanCalendarDate,
  omanMonthRange,
  omanPeriodStart,
};
