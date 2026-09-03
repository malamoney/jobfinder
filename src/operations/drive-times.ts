import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { commuteDrives, type CommuteDriveRow } from "@/db/schema";
import {
  clockAt,
  departureClockOf,
  journeyAt,
  leaveClockFor,
  minutesOfClock,
  nextWeekday,
  EVENING_DEPARTURE,
  MORNING_ARRIVAL,
} from "@/commute/drive";
import type { CommuteDrive } from "@/commute/schema";
import type { Coordinate } from "@/geocoding/nominatim";
import { route, routingKey, type Route } from "@/routing/tomtom";

/**
 * The drive-time cache: asking the routing provider about a journey once, and
 * reusing the answer for every Posting that shares it (#102, ADR 0015).
 *
 * Journeys are keyed by where they start and end, not by the Posting or the
 * User looking at one — the same observation the geocode cache rests on
 * (ADR 0005). A metro's Corpus is thousands of Postings over a hundred-odd
 * distinct locations, so this is the difference between a hundred lookups and a
 * pair of requests every time anybody opens a page.
 *
 * Everything here fails quietly. No provider configured, a provider that cannot
 * be reached, a quota refused, a journey it knows no route for: the answer is
 * null and the tab shows no times. There is no interpolated figure anywhere,
 * and nothing on this path can take the Posting page down.
 */

/**
 * How long a stored answer stands before it is asked again.
 *
 * These are historic speed profiles, not live traffic — they move when
 * roadworks and new roads do, which is months rather than minutes. A month
 * keeps a journey honest without turning the cache back into a request per page
 * view.
 */
export const DRIVE_MAX_AGE_DAYS = 30;

const DRIVE_MAX_AGE_MS = DRIVE_MAX_AGE_DAYS * 86_400_000;

/**
 * How precisely the origin is written into the cache key: five decimal places,
 * a little over a metre.
 *
 * Fine enough that no two homes collide and coarse enough that the same home
 * always writes the same key, which is what a cache hit depends on. Nothing at
 * this scale changes a drive time, so it costs nothing to round.
 */
const KEY_PRECISION = 5;

/** A coordinate as a cache key, so the same home always keys the same row. */
function originKey(at: Coordinate): string {
  return `${at.latitude.toFixed(KEY_PRECISION)},${at.longitude.toFixed(KEY_PRECISION)}`;
}

/**
 * How long the journey from `home` to a Posting takes in each window, or null
 * when there is no figure to give.
 *
 * Null covers every way this can come up empty, because the tab treats them
 * alike: no routing provider configured, one that could not be reached or
 * refused, and a journey it knows no route for. A User is never shown a
 * fabricated time, so there is nothing to tell them apart for.
 *
 * `destination` is the coordinate to route to; `destinationKey` is the
 * Posting's normalized location, which is what the row is keyed by — the same
 * key `geocodes` holds, so every Posting in one place shares one row.
 *
 * This cannot throw. The drive times are the one thing on the Posting page that
 * is an extra rather than the point of the visit, so nothing about them — not
 * the provider, not the cache they are kept in — is allowed to cost a User the
 * page they actually asked for.
 */
export async function readDriveTimes(
  home: Coordinate,
  destination: Coordinate,
  destinationKey: string,
): Promise<CommuteDrive | null> {
  if (!routingKey()) return null;

  try {
    return await lookUp(home, destination, destinationKey);
  } catch {
    return null;
  }
}

async function lookUp(
  home: Coordinate,
  destination: Coordinate,
  destinationKey: string,
): Promise<CommuteDrive | null> {
  const origin = originKey(home);
  const stored = await readStored(origin, destinationKey);
  if (stored && !isStale(stored)) return driveOf(stored);

  let asked: CommuteDrive | null;
  try {
    asked = await askProvider(home, destination);
  } catch {
    // The provider is unreachable, refused, or out of quota. Nothing is
    // written, so the journey is asked about again next time rather than
    // remembered as unroutable. A stored answer that is merely old still beats
    // silence — it is a figure the provider gave us, not an estimate — so it
    // stands until a later attempt replaces it.
    return stored ? driveOf(stored) : null;
  }

  // Storing is a kindness to the next look at this journey, not part of
  // answering this one: a write that fails must not withhold what the provider
  // has just told us.
  await store(origin, destinationKey, asked).catch(() => {});
  return asked;
}

/** The cached journey, or undefined when this one has never been asked about. */
async function readStored(
  origin: string,
  destinationKey: string,
): Promise<CommuteDriveRow | undefined> {
  const [row] = await getDb()
    .select()
    .from(commuteDrives)
    .where(
      and(
        eq(commuteDrives.origin, origin),
        eq(commuteDrives.destination, destinationKey),
      ),
    );

  return row;
}

function isStale(row: CommuteDriveRow): boolean {
  return Date.now() - row.checkedAt.getTime() > DRIVE_MAX_AGE_MS;
}

/**
 * The drive a cached row holds, or null when the row is a negative result — the
 * provider was asked and knew no route. The three columns are only ever all set
 * or all null, so one of them decides.
 */
function driveOf(row: CommuteDriveRow): CommuteDrive | null {
  if (
    row.morningSeconds == null ||
    row.morningLeaveMinutes == null ||
    row.eveningSeconds == null
  ) {
    return null;
  }

  return {
    morning: {
      seconds: row.morningSeconds,
      leaveAt: clockAt(row.morningLeaveMinutes),
    },
    evening: { seconds: row.eveningSeconds },
  };
}

/**
 * Both windows, in one round trip's worth of wall time.
 *
 * In parallel because a User is waiting on a page render: two requests one
 * after the other would double what the tab costs to open for no benefit. Both
 * are asked about the same weekday, so the pair describes one day rather than
 * two.
 *
 * The evening runs the other way — from the role back to the home — which is
 * the journey a User actually makes at half five, and the one that can be a
 * different length from the morning's.
 */
async function askProvider(
  home: Coordinate,
  destination: Coordinate,
): Promise<CommuteDrive | null> {
  const day = nextWeekday(new Date());

  const [morning, evening] = await Promise.all([
    route(home, destination, {
      arriveAt: journeyAt(day, MORNING_ARRIVAL),
    }),
    route(destination, home, {
      departAt: journeyAt(day, EVENING_DEPARTURE),
    }),
  ]);

  if (!morning || !evening) return null;

  return {
    morning: { seconds: morning.seconds, leaveAt: leaveClockOf(morning) },
    evening: { seconds: evening.seconds },
  };
}

/**
 * When the User has to leave home.
 *
 * The provider's own departure moment where it can be read — it carries the
 * origin's offset, so its clock is the one the User sets an alarm by. Where it
 * cannot, the arrival we asked for less the duration it answered with, which is
 * arithmetic on the same answer rather than a guess about anything.
 */
function leaveClockOf(morning: Route): string {
  return (
    departureClockOf(morning.departureTime) ??
    leaveClockFor(MORNING_ARRIVAL, morning.seconds)
  );
}

/**
 * Records what the provider answered, including that it knew no route — a
 * negative result, so an unroutable journey is not asked about again on every
 * page open.
 *
 * An upsert rather than an insert: this is both the first write for a journey
 * and the refresh of a stale one, and two page opens can race to be the first.
 */
async function store(
  origin: string,
  destinationKey: string,
  drive: CommuteDrive | null,
): Promise<void> {
  const answer = {
    morningSeconds: drive?.morning.seconds ?? null,
    morningLeaveMinutes: drive ? minutesOfClock(drive.morning.leaveAt) : null,
    eveningSeconds: drive?.evening.seconds ?? null,
    checkedAt: new Date(),
  };

  await getDb()
    .insert(commuteDrives)
    .values({ origin, destination: destinationKey, ...answer })
    .onConflictDoUpdate({
      target: [commuteDrives.origin, commuteDrives.destination],
      set: answer,
    });
}
