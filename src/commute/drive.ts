/**
 * The two drive windows, and the arithmetic and wording around them (#102).
 *
 * A pure module with nothing behind it — no database, no `fetch` — so the
 * commute operation, the routing adapter, and the browser can all use it. The
 * routing provider itself lives behind its own seam (`@/routing/tomtom`); what
 * is here is only what a window *is* and how one reads.
 *
 * Both windows are constants. The User does not set them, and making them
 * Criteria fields was considered and deferred: the question the tab answers is
 * "what is this journey like", and two fixed anchors answer it for almost
 * everybody without asking anyone anything.
 */

/** A local wall-clock time, 24-hour, as `HH:MM`. */
export type Clock = string;

/**
 * Be at the desk for nine. The morning is solved for *arrival*, so the number
 * beside it is the one a User actually has to hit, and the departure falls out
 * of the answer rather than being guessed at.
 */
export const MORNING_ARRIVAL: Clock = "09:00";

/** Leave the desk at half five. The evening is solved for departure. */
export const EVENING_DEPARTURE: Clock = "17:30";

/** Weekday numbers as `Date` reports them, so a weekend can be recognised. */
const SUNDAY = 0;
const SATURDAY = 6;

const DAY_MS = 86_400_000;

/**
 * The next weekday to ask the provider about, as `YYYY-MM-DD`.
 *
 * Always at least tomorrow, never today. Two reasons, and the first is the one
 * that matters: the provider is asked for a moment, and a moment that has
 * already passed is not a question it will answer. The journey's own zone is
 * unknown here by design — the provider resolves it (see `journeyAt`) — so the
 * only date safe against every zone the Corpus reaches is one a whole day out.
 *
 * The second is that Saturday and Sunday are not what "typical weekday" means,
 * so they are stepped over.
 *
 * Read in UTC rather than the server's zone, so two servers in different
 * regions ask about the same day.
 */
export function nextWeekday(from: Date): string {
  const day = new Date(from.getTime());
  day.setUTCHours(0, 0, 0, 0);

  do {
    day.setTime(day.getTime() + DAY_MS);
  } while (day.getUTCDay() === SATURDAY || day.getUTCDay() === SUNDAY);

  return day.toISOString().slice(0, 10);
}

/**
 * A date and a clock time written as one local moment, deliberately carrying no
 * zone.
 *
 * That absence is the whole point. A moment with no offset on it is read by the
 * routing provider as local to the end of the journey it anchors — the
 * destination for an arrival, the origin for a departure — which is exactly
 * what "there for 9am" and "away at 5:30" mean, and it is an answer no clock on
 * our side could give: the server's zone is UTC and knows nothing about where
 * either end of this journey is.
 */
export function journeyAt(date: string, clock: Clock): string {
  return `${date}T${clock}:00`;
}

/** An ISO moment, however it is zoned: `2026-09-03T07:52:13-04:00`. */
const MOMENT = /^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/;

/**
 * The local clock a provider's departure time states, or null when the string
 * is not a moment at all.
 *
 * Read out of the text rather than through `Date`. The string carries the
 * origin's own offset, so its `07:52` *is* the time the User sets an alarm for;
 * putting it through `Date` would render that instant in the server's zone
 * instead, which on Vercel is UTC and four hours out in Boston.
 */
export function departureClockOf(moment: string): Clock | null {
  const parsed = MOMENT.exec(moment);
  return parsed && `${parsed[1]}:${parsed[2]}`;
}

/** Minutes past local midnight, as a clock. The inverse of `minutesOfClock`. */
export function clockAt(minutes: number): Clock {
  const hours = Math.floor(minutes / 60);
  return `${pad(hours)}:${pad(minutes % 60)}`;
}

/** Minutes past local midnight, which is how a clock is stored. */
export function minutesOfClock(clock: Clock): number {
  const [hours, minutes] = clock.split(":");
  return Number(hours) * 60 + Number(minutes);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

const MINUTES_PER_DAY = 1440;

/**
 * The clock a drive of `seconds` has to start on to arrive at `arrival`.
 *
 * The fallback for when the provider's own departure moment cannot be read —
 * its duration and the arrival we asked for are both facts it gave us, so this
 * is arithmetic on its answer rather than an estimate of anything. Wraps across
 * midnight for a drive long enough to have started the day before.
 */
export function leaveClockFor(arrival: Clock, seconds: number): Clock {
  const minutes = minutesOfClock(arrival) - Math.round(seconds / 60);
  return clockAt(((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY);
}

const MINUTES_PER_HOUR = 60;

/**
 * A drive time as a person says it: "38 min", "1 hr 12 min".
 *
 * Rounded to the nearest minute — the seconds in a typical-weekday figure are
 * noise, and quoting them would claim a precision this number does not have —
 * but never rounded down to nothing, because a journey that exists takes some
 * time.
 */
export function formatDriveTime(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < MINUTES_PER_HOUR) return `${minutes} min`;

  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

/** A clock as a person writes it: `07:52` reads "7:52 am". */
export function formatClock(clock: Clock): string {
  const minutes = minutesOfClock(clock);
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const half = hours < 12 ? "am" : "pm";
  // Midnight and noon are both written twelve, not zero.
  const shown = hours % 12 === 0 ? 12 : hours % 12;

  return `${shown}:${pad(minutes % MINUTES_PER_HOUR)} ${half}`;
}
