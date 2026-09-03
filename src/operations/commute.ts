import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { criteria, postings, type CriteriaRow } from "@/db/schema";
import { greatCircleMiles } from "@/commute/distance";
import { radiusAppliesTo } from "@/commute/radius-scope";
import type { CommuteDetails, CommuteHome } from "@/commute/schema";
import type { HomeCoordinate } from "@/criteria/schema";
import type { Coordinate } from "@/geocoding/nominatim";
import { normalizeLocation, placesNamed } from "@/postings/location";
import { readDriveTimes } from "./drive-times";
import { readGeocode, readGeocodes } from "./geocoding";
import { homeCoordinateOf } from "./home-location";
import { isPostingId } from "./postings";

/**
 * The read behind the COMMUTE DETAILS tab (#101, #102).
 *
 * Part of the primary seam (see `./index.ts`), sitting beside `readPosting` and
 * `readCriteria` rather than inside either: the Posting page asks for both at
 * once, and a Posting that is no journey answers null here without changing
 * anything about the Posting itself.
 *
 * No geocoder is ever called here: a Posting's location is placed by the match
 * run that surfaced it (ADR 0005), and the User's home when they saved their
 * Criteria (ADR 0014). The routing provider is the one external call this path
 * can make, and only on the first look at a given journey — after that the
 * drive-time cache answers it (`./drive-times`), which is what keeps the page
 * as fast as it was before the tab existed (user story 25).
 */

/**
 * The commute from the User's home to one Posting, or null when the Posting is
 * not a journey that User would make.
 *
 * Two things make it null, and both mean "show the review panel exactly as it
 * was, with no tab strip":
 *
 * - **The commute radius would not have measured the Posting for this User.**
 *   That is the rule `radiusApplies` states once for everything that needs it
 *   (`@/commute/radius-scope`), read here as a plain boolean. For a User who
 *   accepts remote it excludes any Posting whose text offers remote, and any
 *   Posting silent on where the work happens; for a User who does not, it
 *   excludes nothing, because every role they can take is a commute.
 * - **None of the places it names resolved to a point.** Either the text named
 *   no place, or the geocoder knew none of the ones it named. A distance cannot
 *   be measured to nowhere, and a gap in the data must not become a broken
 *   screen (user story 21). A Posting naming several places where only one
 *   resolved has a Commute — to that one, which is what the radius measured it
 *   on (#113).
 *
 * **Why the stance, and what user story 20 was really asking (#112).** That
 * story — "as a User looking at a remote Posting, I want no commute tab at all,
 * so that the page does not invent a journey I will never make" — was first
 * built flatly, off the Posting's text alone, and this doc argued for that. It
 * was wrong, and the way it was wrong is worth keeping: the story describes a
 * User who *accepts* remote. They will do the job from home, so a commute for
 * it is fiction. A User who does not accept remote can only ever take that same
 * role onsite; the journey is real, and the radius has always treated it that
 * way, measuring the Posting and dropping it from the Dashboard when it is too
 * far. Reading the Posting's text alone meant the one screen that would have
 * explained the distance was the one screen that refused to appear. The stance
 * is what tells the two Users apart — the argument ADR 0013 makes — so the tab
 * now asks the radius's own question rather than a second version of it.
 *
 * **What that costs, deliberately.** A Posting silent about where the work
 * happens used to get a tab for every User. It now gets none for a User who
 * accepts remote, because the radius has never measured it for them — the same
 * benefit of the doubt the Arrangement stage gives a silent axis. So user story
 * 19, "know whether a Posting falls inside the radius I stated, so that I can
 * see when something reached me for another reason", is read on a narrower set:
 * an "outside" verdict now lands on a Posting the radius did measure, in the
 * window before the next match run drops it — which is exactly the moment #112
 * was reported from. Two rules that disagree about which Postings were measured
 * is what produced #111 and #112; one rule with a smaller reach is the price of
 * not keeping a third.
 *
 * Note what is *not* a reason to answer null: a User who stated no home
 * location, or one whose address could not be placed. They still get the tab,
 * because being told what to do about it beats an absent tab that explains
 * nothing (user story 22).
 */
export async function readCommute(
  userId: string,
  postingId: string,
): Promise<CommuteDetails | null> {
  if (!isPostingId(postingId)) return null;

  const db = getDb();

  const [[postingRow], [criteriaRow]] = await Promise.all([
    db
      .select({
        location: postings.location,
        // The places the Posting names, as the keys `geocodes` holds and the
        // drive-time cache keys a journey by — so every Posting in one place
        // shares one stored journey, whether or not it names others too.
        normalizedLocations: postings.normalizedLocations,
        arrangements: postings.arrangements,
      })
      .from(postings)
      .where(eq(postings.id, postingId)),
    db.select().from(criteria).where(eq(criteria.userId, userId)),
  ]);

  if (!postingRow) return null;

  // A User who has stated no Criteria has stated no stance on remote either,
  // and the rule below asks a stance only one thing — whether it includes
  // remote — which an unstated one does not. So they get the tab: nobody has
  // said this User would take a remote role, and the radius has no reading of
  // its own to disagree with, since with no Criteria there is no radius to run.
  // What they are shown is user story 22's "state a home location" prompt, not
  // an invented distance — there is no home to measure one from.
  const accepted = criteriaRow?.arrangements ?? [];
  if (!radiusAppliesTo(accepted, postingRow.arrangements)) return null;

  // Where the User lives is resolved before the destination is picked, because
  // which place the tab describes is "the closest one" and there is nothing to
  // measure closeness from without it (#113).
  const at = await homeCoordinate(criteriaRow);

  const chosen = await nearestPlace(postingRow, at);
  if (!chosen) return null;

  return {
    destination: {
      stated: postingRow.location,
      place: chosen.place,
      at: chosen.at,
    },
    home: await homeOf(criteriaRow, at, chosen),
    radiusMiles: criteriaRow?.radiusMiles ?? null,
  };
}

/** The place a journey ends at: its cache key, its name, and its point. */
type NearestPlace = {
  /** The normalized key, which is what the drive-time cache keys a journey by. */
  key: string;
  /**
   * The employer's words for it, or null when there are none worth showing —
   * the Posting names one place, or its stored places no longer line up with
   * its text.
   */
  place: string | null;
  at: Coordinate;
};

/**
 * The Posting's place closest to the User, or null when none of the places it
 * names resolved to a point.
 *
 * The closest is the one the radius judged the Posting on (#113) — a role
 * offered in Boston and Seattle is a Boston role to somebody in Franklin, MA —
 * so it is the one every figure on the tab has to describe, or the tab would
 * quote a distance the Dashboard did not act on.
 *
 * Null is the "no tab strip at all" answer the single-place version gave for a
 * location that resolved to nothing: the text named no place, or no geocoder
 * knew any of the places it named. A Posting where only some places resolved is
 * measured on those, exactly as the radius measures it.
 *
 * With no home to measure from — a User who stated none, or one whose address
 * could not be placed — the first place the Posting names wins. There is no
 * "closest" to be had, and the tab is showing user story 22's prompt rather
 * than a distance, so the choice only decides which place is named.
 */
async function nearestPlace(
  posting: { location: string | null; normalizedLocations: string[] },
  home: HomeCoordinate | null,
): Promise<NearestPlace | null> {
  const cached = await readGeocodes(getDb(), posting.normalizedLocations);

  const placed = posting.normalizedLocations.flatMap((key) => {
    const at = cached.get(key);
    return at ? [{ key, at }] : [];
  });
  if (placed.length === 0) return null;

  const nearest = home
    ? placed.reduce((closest, candidate) =>
        greatCircleMiles(home, candidate.at) < greatCircleMiles(home, closest.at)
          ? candidate
          : closest,
      )
    : placed[0];

  return { ...nearest, place: nameOf(nearest.key, posting) };
}

/**
 * The employer's words for the place a journey ends at, or null when the tab
 * should not name one.
 *
 * Null when the Posting names a single place, because its stated text already
 * is that place and naming it again would suggest there were others. Null too
 * when the key is not one the location text reads as today — a row whose stored
 * places predate a change to how a location is read, until
 * `renormalizeLocations` catches it. The distance is still the right one; there
 * is simply nothing honest to call it, and a raw cache key (`seaport, boston,
 * ma`) is not something to show somebody.
 */
function nameOf(
  key: string,
  posting: { location: string | null; normalizedLocations: string[] },
): string | null {
  if (posting.normalizedLocations.length <= 1) return null;
  return (
    placesNamed(posting.location).find((named) => named.key === key)?.stated ??
    null
  );
}

/**
 * The point the User's home resolved to, or null when there is none to be had —
 * no home stated, or one no geocoder could place.
 *
 * The fallback to the shared Geocode Cache is the one the commute radius already
 * makes (`resolveHomeCoordinate` in `@/operations/matching`): a Criteria row
 * stated before #100 and never yet placed still has its home string in that
 * cache from when homes went through it. Without the fallback the funnel would
 * bound such a User correctly while this tab told them their address could not
 * be placed — which would be false. Read-only, and only when the row carries no
 * point of its own: nothing writes a home into that cache any more (ADR 0014).
 *
 * A point recovered that way is graded `city`, because that is what the cache
 * holds — its keys are Posting locations, normalized, and it never saw the
 * street address a User may since have typed. Understating the Precision is the
 * direction that does not mislead.
 */
async function homeCoordinate(
  row: CriteriaRow | undefined,
): Promise<HomeCoordinate | null> {
  if (!row?.homeLocation) return null;
  return homeCoordinateOf(row) ?? (await cachedHome(row.homeLocation));
}

/**
 * What the tab can say about where the User lives, and how far that is from the
 * role.
 *
 * The stated text and the stored point are separate facts: an address the
 * geocoder could not reach or could not find is kept and shown, so a User can
 * see the address they gave and recognise the typo in it, rather than being told
 * only that something is missing.
 */
async function homeOf(
  row: CriteriaRow | undefined,
  at: HomeCoordinate | null,
  destination: NearestPlace,
): Promise<CommuteHome> {
  const stated = row?.homeLocation;
  if (!row || !stated) return { state: "none" };
  if (!at) return { state: "unplaced", stated };

  return {
    state: "placed",
    stated,
    at,
    distanceMiles: greatCircleMiles(at, destination.at),
    // Null on everything from "no provider is configured" to "the provider
    // knows no route", because the tab says the same thing — nothing — for all
    // of them. A straight line is never scaled up to stand in for a drive.
    drive: await readDriveTimes(at, destination.at, destination.key),
  };
}

/** The pre-#100 path: a home string the shared Geocode Cache still happens to hold. */
async function cachedHome(stated: string) {
  const key = normalizeLocation(stated);
  if (!key) return null;

  const at = await readGeocode(getDb(), key);
  return at && { ...at, precision: "city" as const };
}
