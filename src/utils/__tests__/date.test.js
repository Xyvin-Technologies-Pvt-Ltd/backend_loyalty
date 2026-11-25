/**
 * Regression guard for the Oman-day utilities in ../date.js.
 *
 * The bug this suite exists to prevent: production runs UTC, and any bare
 * `new Date(...)` / `setHours` / `getFullYear` based day boundary resolves
 * 4 hours off from Oman time, which is what caused the 02:00-Oman expiry
 * batch to appear on different calendar days in different reports.
 *
 * Every test below runs under BOTH `TZ=UTC` and `TZ=Asia/Muscat` to prove the
 * utilities do not depend on the server's local timezone setting (they use
 * moment-timezone's bundled IANA data, not the OS tzdata).
 */
const {
  OMAN_TIMEZONE,
  parseOmanDate,
  startOfOmanDay,
  endOfOmanDay,
  resolveOmanDateRange,
  formatOmanDate,
  toOmanCalendarDate,
  omanMonthRange,
  omanPeriodStart,
} = require("../date");

describe.each(["UTC", "Asia/Muscat"])("Oman date utils (process.env.TZ=%s)", (tz) => {
  const originalTz = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = tz;
  });

  afterAll(() => {
    process.env.TZ = originalTz;
  });

  test("OMAN_TIMEZONE is Asia/Muscat", () => {
    expect(OMAN_TIMEZONE).toBe("Asia/Muscat");
  });

  test("startOfOmanDay resolves 16 Aug to 15 Aug 20:00 UTC (the 02:00-Oman expiry-batch boundary)", () => {
    expect(startOfOmanDay("2026-08-16").toISOString()).toBe("2026-08-15T20:00:00.000Z");
  });

  test("endOfOmanDay resolves 16 Aug to 16 Aug 19:59:59.999 UTC", () => {
    expect(endOfOmanDay("2026-08-16").toISOString()).toBe("2026-08-16T19:59:59.999Z");
  });

  test("the 02:00-Oman expiry run falls inside its own Oman day, not the previous one", () => {
    // The expiry job runs at 02:00 Oman = 22:00 UTC the previous day.
    const expiryRunInstant = new Date("2026-08-15T22:00:00.000Z");
    const dayStart = startOfOmanDay("2026-08-16");
    const dayEnd = endOfOmanDay("2026-08-16");
    expect(expiryRunInstant.getTime()).toBeGreaterThanOrEqual(dayStart.getTime());
    expect(expiryRunInstant.getTime()).toBeLessThanOrEqual(dayEnd.getTime());
  });

  test("resolveOmanDateRange includes the final requested day (the 'last day returns nothing' regression)", () => {
    const { endDate } = resolveOmanDateRange("2026-08-01", "2026-08-16");
    const lastMinuteOf16th = new Date("2026-08-16T19:59:59.999Z");
    expect(endDate.getTime()).toBeGreaterThanOrEqual(lastMinuteOf16th.getTime());
  });

  test("resolveOmanDateRange defaults to the current Oman month when both bounds are omitted", () => {
    const { startDate, endDate } = resolveOmanDateRange(undefined, undefined);
    expect(startDate).not.toBeNull();
    expect(endDate).not.toBeNull();
    expect(startDate.getTime()).toBeLessThan(endDate.getTime());
  });

  test("resolveOmanDateRange({ fallback: 'none' }) leaves missing bounds null instead of defaulting", () => {
    const { startDate, endDate } = resolveOmanDateRange(undefined, undefined, { fallback: "none" });
    expect(startDate).toBeNull();
    expect(endDate).toBeNull();
  });

  test("resolveOmanDateRange tolerates a full ISO datetime, not just a bare YYYY-MM-DD", () => {
    const { startDate } = resolveOmanDateRange("2026-08-16T00:00:00.000Z", undefined, { fallback: "none" });
    expect(startDate.toISOString()).toBe("2026-08-15T20:00:00.000Z");
  });

  test("parseOmanDate returns null (not Invalid Date) for malformed input", () => {
    expect(parseOmanDate("not-a-date")).toBeNull();
    expect(parseOmanDate("")).toBeNull();
    expect(parseOmanDate(undefined)).toBeNull();
  });

  test("startOfOmanDay / endOfOmanDay return null (not throw) for malformed input", () => {
    expect(startOfOmanDay("not-a-date")).toBeNull();
    expect(endOfOmanDay("not-a-date")).toBeNull();
  });

  test("resolveOmanDateRange with a garbage bound falls back rather than propagating Invalid Date", () => {
    const { startDate, endDate } = resolveOmanDateRange("garbage", "garbage");
    expect(startDate).not.toBeNull();
    expect(endDate).not.toBeNull();
    expect(Number.isNaN(startDate.getTime())).toBe(false);
    expect(Number.isNaN(endDate.getTime())).toBe(false);
  });

  test("formatOmanDate renders 22:00 UTC (02:00 Oman next day) as the Oman calendar date", () => {
    expect(formatOmanDate(new Date("2026-08-15T22:00:00.000Z"))).toBe("16-08-2026");
  });

  test("formatOmanDate falls back gracefully for bad input", () => {
    expect(formatOmanDate("not-a-date")).toBe("-");
    expect(formatOmanDate(null)).toBe("-");
  });

  test("toOmanCalendarDate re-anchors the Oman calendar day at UTC midnight", () => {
    // 2026-08-15T22:00:00Z is 02:00 on 16 Aug in Oman.
    expect(toOmanCalendarDate(new Date("2026-08-15T22:00:00.000Z")).toISOString()).toBe(
      "2026-08-16T00:00:00.000Z"
    );
  });

  test("omanMonthRange spans the whole Oman month, including the final day", () => {
    const { start, end } = omanMonthRange(new Date("2026-08-15T22:00:00.000Z"));
    expect(start.toISOString()).toBe("2026-07-31T20:00:00.000Z"); // 1 Aug 00:00 Oman
    expect(end.toISOString()).toBe("2026-08-31T19:59:59.999Z"); // 31 Aug 23:59:59.999 Oman
  });

  test("omanPeriodStart('MONTHLY') snaps to Oman midnight on the 1st, not 'now, minus days'", () => {
    // Regression for point_criteria_model.js's startOfMonth bug: checked at 02:30
    // Oman on the 1st (still 31 Jul in UTC), "this month" must still be August.
    const checkedAt = new Date("2026-07-31T22:30:00.000Z"); // 02:30, 1 Aug, Oman
    const start = omanPeriodStart("MONTHLY", checkedAt);
    expect(start.toISOString()).toBe("2026-07-31T20:00:00.000Z"); // 1 Aug 00:00 Oman
  });

  test("omanPeriodStart('DAILY') snaps to Oman midnight, not UTC midnight", () => {
    const now = new Date("2026-08-16T10:00:00.000Z"); // 14:00 Oman, 16 Aug
    expect(omanPeriodStart("DAILY", now).toISOString()).toBe("2026-08-15T20:00:00.000Z");
  });

  test("omanPeriodStart returns null for an unrecognised frequency (e.g. TOTAL)", () => {
    expect(omanPeriodStart("TOTAL", new Date())).toBeNull();
  });
});
