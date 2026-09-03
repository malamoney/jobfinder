import { describe, expect, it } from "vitest";
import {
  EVENING_DEPARTURE,
  MORNING_ARRIVAL,
  clockAt,
  departureClockOf,
  formatClock,
  formatDriveTime,
  journeyAt,
  leaveClockFor,
  nextWeekday,
} from "./drive";

/**
 * The pure half of the drive windows (#102).
 *
 * Arithmetic and wording only — no provider, no database. The two windows are
 * constants a User never sets, so what is worth pinning here is that the day
 * asked for is a weekday in the future, that the provider's own departure time
 * is read as a local clock rather than through the server's zone, and that a
 * duration and a clock time read the way a person writes them.
 */

describe("the two drive windows", () => {
  it("anchors the morning on a 9am arrival and the evening on a 5:30pm departure", () => {
    expect(formatClock(MORNING_ARRIVAL)).toBe("9:00 am");
    expect(formatClock(EVENING_DEPARTURE)).toBe("5:30 pm");
  });
});

describe("the day the windows are asked about", () => {
  // 2026-09-02 is a Wednesday.
  it("asks about tomorrow when tomorrow is a weekday", () => {
    expect(nextWeekday(new Date("2026-09-02T23:30:00Z"))).toBe("2026-09-03");
  });

  it("skips the weekend from a Friday", () => {
    expect(nextWeekday(new Date("2026-09-04T09:00:00Z"))).toBe("2026-09-07");
  });

  it("skips the weekend from a Saturday", () => {
    expect(nextWeekday(new Date("2026-09-05T09:00:00Z"))).toBe("2026-09-07");
  });

  it("skips the weekend from a Sunday", () => {
    expect(nextWeekday(new Date("2026-09-06T09:00:00Z"))).toBe("2026-09-07");
  });

  it("never asks about today, so the moment asked about is always still ahead", () => {
    expect(nextWeekday(new Date("2026-09-03T00:01:00Z"))).toBe("2026-09-04");
  });

  it("writes the journey as a local wall-clock moment, with no zone on it", () => {
    expect(journeyAt("2026-09-03", MORNING_ARRIVAL)).toBe("2026-09-03T09:00:00");
  });
});

describe("the time the User would have to leave", () => {
  /**
   * The provider answers with the origin's own offset on it. The clock a User
   * reads is the one in that string — not what the server's zone would make of
   * the same instant, which on Vercel is UTC and four hours wrong in Boston.
   */
  it("reads the clock in the provider's string, not the server's zone", () => {
    expect(departureClockOf("2026-09-03T07:52:13-04:00")).toBe("07:52");
    expect(departureClockOf("2026-09-03T06:14:00-07:00")).toBe("06:14");
  });

  it("has nothing to read from a string that is not a moment", () => {
    expect(departureClockOf("")).toBeNull();
    expect(departureClockOf("tomorrow morning")).toBeNull();
  });

  it("reads a clock back off a stored minute count", () => {
    expect(clockAt(7 * 60 + 52)).toBe("07:52");
    expect(clockAt(0)).toBe("00:00");
  });

  /**
   * The fallback for a departure moment that cannot be read: the arrival we
   * asked for, less the duration the provider answered with. Both are the
   * provider's own figures, so nothing here is estimated.
   */
  it("works the departure back from the arrival when the string cannot be read", () => {
    expect(leaveClockFor(MORNING_ARRIVAL, 68 * 60)).toBe("07:52");
  });

  it("wraps across midnight for a drive that starts the day before", () => {
    expect(leaveClockFor(MORNING_ARRIVAL, 10 * 60 * 60)).toBe("23:00");
  });
});

describe("a drive time as a person reads it", () => {
  it("counts whole minutes under the hour", () => {
    expect(formatDriveTime(38 * 60)).toBe("38 min");
  });

  it("rounds to the nearest minute", () => {
    expect(formatDriveTime(38 * 60 + 29)).toBe("38 min");
    expect(formatDriveTime(38 * 60 + 31)).toBe("39 min");
  });

  it("never rounds a real drive away to nothing", () => {
    expect(formatDriveTime(20)).toBe("1 min");
  });

  it("splits an hour or more into hours and minutes", () => {
    expect(formatDriveTime(72 * 60)).toBe("1 hr 12 min");
    expect(formatDriveTime(135 * 60)).toBe("2 hr 15 min");
  });

  it("leaves off the minutes on a whole hour", () => {
    expect(formatDriveTime(60 * 60)).toBe("1 hr");
  });
});

describe("a clock time as a person reads it", () => {
  it("drops the leading zero and names the half of the day", () => {
    expect(formatClock("07:52")).toBe("7:52 am");
    expect(formatClock("17:30")).toBe("5:30 pm");
  });

  it("writes both noon and midnight as twelve", () => {
    expect(formatClock("12:05")).toBe("12:05 pm");
    expect(formatClock("00:15")).toBe("12:15 am");
  });
});
