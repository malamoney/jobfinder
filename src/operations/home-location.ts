import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { criteria, type CriteriaRow } from "@/db/schema";
import type { HomeCoordinate, HomeOutcome } from "@/criteria/schema";
import { geocode, pauseBetweenLookups } from "@/geocoding/nominatim";
import type { LocationPrecision } from "@/geocoding/precision";

/**
 * The Home Coordinate: resolving a User's stated home location to a point on
 * their own Criteria row (#100, ADR 0014).
 *
 * A Posting's location goes through `normalizeLocation` and into the shared
 * Geocode Cache. A home location does neither, for two reasons:
 *
 * - That normalizer is built for a Posting's free text. It strips
 *   parentheticals and a trailing "remote", which is right for
 *   `Austin, TX (Remote)` and quietly destroys `12 Beacon St (Apt 4), Boston`.
 *   The address a User types is geocoded exactly as they typed it.
 * - The cache is one table keyed by string and shared by every User. An exact
 *   street address does not belong in it.
 *
 * So the coordinate is resolved once, when the User saves, and stored on the
 * Criteria row beside the text it came from.
 */

/** The three columns that hold the resolved point, written and cleared together. */
type HomeColumns = {
  homeLatitude: number | null;
  homeLongitude: number | null;
  homePrecision: LocationPrecision | null;
};

/** No point: nothing stated, nothing found, or nobody to ask. */
const UNPLACED: HomeColumns = {
  homeLatitude: null,
  homeLongitude: null,
  homePrecision: null,
};

/** What a save decided about the home location: what to store, and what to say. */
export type HomeResolution = {
  columns: HomeColumns;
  outcome: HomeOutcome;
};

/**
 * The Home Coordinate a stored Criteria row carries, or null when it carries
 * none — no home location stated, a home the geocoder could not place, or a row
 * saved before this column existed.
 *
 * The three columns are only ever all set or all null, so one of them decides.
 */
export function homeCoordinateOf(row: CriteriaRow): HomeCoordinate | null {
  if (row.homeLatitude == null || row.homeLongitude == null) return null;

  return {
    latitude: row.homeLatitude,
    longitude: row.homeLongitude,
    // A row this module wrote always carries a precision alongside the point;
    // `city` is the reading that understates rather than overstates if one ever
    // arrived without.
    precision: row.homePrecision ?? "city",
  };
}

/** The columns that store a resolved point. */
function columnsFor(home: HomeCoordinate): HomeColumns {
  return {
    homeLatitude: home.latitude,
    homeLongitude: home.longitude,
    homePrecision: home.precision,
  };
}

/**
 * Asks the geocoder where `stated` is, whatever is stored for it already.
 *
 * Never throws. A geocoder that cannot be reached leaves the point unstored and
 * says `unchecked`, so a save still succeeds and the next attempt tries again.
 */
async function resolveAfresh(stated: string | null): Promise<HomeResolution> {
  if (!stated) return { columns: UNPLACED, outcome: { state: "none" } };

  let placed: HomeCoordinate | null;
  try {
    placed = await geocode(stated);
  } catch {
    // The geocoder is unreachable. Store no point rather than a wrong one, and
    // let the User save regardless — the radius simply does not apply until a
    // later attempt places it.
    return { columns: UNPLACED, outcome: { state: "unchecked" } };
  }

  if (!placed) return { columns: UNPLACED, outcome: { state: "not-found" } };
  return {
    columns: columnsFor(placed),
    outcome: { state: "placed", home: placed },
  };
}

/**
 * Resolves the home location a User is saving, against what they had stored
 * before.
 *
 * The geocoder is skipped when the stated address is the one already stored and
 * already placed: re-saving Criteria to change a keyword should not spend a
 * lookup, and the answer would be the same one. Anything else is asked afresh —
 * including a re-save of an address that failed last time, which is exactly what
 * a User pressing Save again is asking for.
 */
export async function resolveHome(
  userId: string,
  stated: string | null,
): Promise<HomeResolution> {
  if (!stated) return { columns: UNPLACED, outcome: { state: "none" } };

  const [existing] = await getDb()
    .select()
    .from(criteria)
    .where(eq(criteria.userId, userId));

  if (existing?.homeLocation === stated) {
    const kept = existing && homeCoordinateOf(existing);
    if (kept) {
      return {
        columns: columnsFor(kept),
        outcome: { state: "placed", home: kept },
      };
    }
  }

  return resolveAfresh(stated);
}

/**
 * Places one Criteria row's home location and stores the result on that row.
 *
 * An unreachable geocoder writes nothing: the row is left as it was, to be tried
 * again, rather than remembered as unplaceable. A geocoder that answered and
 * knew no place *is* stored — as no point, which is what it is.
 */
async function placeAndStore(row: CriteriaRow): Promise<HomeOutcome> {
  const { columns, outcome } = await resolveAfresh(row.homeLocation);
  if (outcome.state === "unchecked") return outcome;

  await getDb()
    .update(criteria)
    .set(columns)
    .where(eq(criteria.userId, row.userId));

  return outcome;
}

/**
 * Places a home location that has no point yet, and does nothing at all for one
 * that has.
 *
 * A Criteria row reaches a match run without a point in two ways: it was stated
 * before #100, or the geocoder could not be reached when it was saved. Either
 * way this is where it heals — a match run already makes its external calls
 * outside its transaction, and one more places the home for good, so no row is
 * left depending on the shared cache still happening to hold its home string.
 */
export async function placeUnplacedHome(row: CriteriaRow): Promise<void> {
  if (!row.homeLocation || homeCoordinateOf(row)) return;
  await placeAndStore(row);
}

/**
 * The Home Coordinate a User's stored Criteria currently carry, or null when
 * they carry none.
 *
 * What the Criteria page reads to tell a User their address only reached their
 * city, and what the commute details on a Posting (#101) measure from.
 */
export async function readHomeCoordinate(
  userId: string,
): Promise<HomeCoordinate | null> {
  const [row] = await getDb()
    .select()
    .from(criteria)
    .where(eq(criteria.userId, userId));

  return row ? homeCoordinateOf(row) : null;
}

/** What one pass of `resolveHomeLocations` did. */
export type HomeBackfill = {
  /** Rows whose home location was sent to the geocoder. */
  checked: number;
  /** Of those, the ones now holding a point. */
  placed: number;
  /** Of those, the ones the geocoder knew no place for. */
  notFound: number;
  /** Of those, the ones it could not be reached about. Retried next pass. */
  failed: number;
};

/**
 * Places the home location of every stored Criteria row that has one and no
 * point yet — the rows saved before #100 — without their Users re-saving.
 *
 * Those rows still work meanwhile: a match run places them as it goes
 * (`placeUnplacedHome`), and until it has, the commute radius falls back to
 * looking their home up in the shared Geocode Cache, which is how it worked
 * before this (`@/operations/matching`). This is the pass that does the lot in
 * one go rather than a User at a time.
 *
 * Paced at the geocoder's one-a-second policy, so it is a hand-run pass
 * (`pnpm resolve-home-locations`) rather than anything on a request path.
 * `refresh` re-resolves rows that already hold a point, for after a change to
 * how a result is graded.
 */
export async function resolveHomeLocations(
  options: { refresh?: boolean } = {},
): Promise<HomeBackfill> {
  const rows = await getDb()
    .select()
    .from(criteria)
    .where(
      options.refresh
        ? isNotNull(criteria.homeLocation)
        : and(isNotNull(criteria.homeLocation), isNull(criteria.homeLatitude)),
    );

  const done: HomeBackfill = { checked: 0, placed: 0, notFound: 0, failed: 0 };

  for (const row of rows) {
    if (done.checked > 0) await pauseBetweenLookups();
    done.checked++;

    const outcome = await placeAndStore(row);
    if (outcome.state === "placed") done.placed++;
    else if (outcome.state === "not-found") done.notFound++;
    else done.failed++;
  }

  return done;
}
