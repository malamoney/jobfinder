import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { criteria, geocodes, postings, type CriteriaRow } from "@/db/schema";
import { greatCircleMiles } from "@/commute/distance";
import { radiusAppliesTo } from "@/commute/radius-scope";
import type {
  CommuteDestination,
  CommuteDetails,
  CommuteHome,
} from "@/commute/schema";
import { normalizeLocation } from "@/postings/location";
import { readDriveTimes } from "./drive-times";
import { readGeocode } from "./geocoding";
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
 * - **Its location resolved to no point.** Either the text named no place, or
 *   the geocoder knew none. A distance cannot be measured to nowhere, and a gap
 *   in the data must not become a broken screen (user story 21).
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
        // The drive-time cache is keyed by this, the same string `geocodes` is
        // keyed by, so every Posting in one place shares one stored journey.
        normalizedLocation: postings.normalizedLocation,
        arrangements: postings.arrangements,
        latitude: geocodes.latitude,
        longitude: geocodes.longitude,
      })
      .from(postings)
      .leftJoin(geocodes, eq(geocodes.location, postings.normalizedLocation))
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

  // One fact stated three ways: a Posting with no location has no normalized
  // key, so it joins no geocode row and has no point to travel to. Narrowed in
  // one guard because a coordinate without the key it was cached under would
  // leave the drive-time cache nothing to key a journey by.
  const { normalizedLocation, latitude, longitude } = postingRow;
  if (latitude == null || longitude == null || normalizedLocation == null) {
    return null;
  }

  const destination: CommuteDestination = {
    stated: postingRow.location,
    at: { latitude, longitude },
  };

  return {
    destination,
    home: await homeOf(criteriaRow, destination, normalizedLocation),
    radiusMiles: criteriaRow?.radiusMiles ?? null,
  };
}

/**
 * What the tab can say about where the User lives, and how far that is from the
 * role.
 *
 * The stated text and the stored point are separate facts: an address the
 * geocoder could not reach or could not find is kept and shown, so a User can
 * see the address they gave and recognise the typo in it, rather than being told
 * only that something is missing.
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
async function homeOf(
  row: CriteriaRow | undefined,
  destination: CommuteDestination,
  destinationKey: string,
): Promise<CommuteHome> {
  const stated = row?.homeLocation;
  if (!row || !stated) return { state: "none" };

  const at = homeCoordinateOf(row) ?? (await cachedHome(stated));
  if (!at) return { state: "unplaced", stated };

  return {
    state: "placed",
    stated,
    at,
    distanceMiles: greatCircleMiles(at, destination.at),
    // Null on everything from "no provider is configured" to "the provider
    // knows no route", because the tab says the same thing — nothing — for all
    // of them. A straight line is never scaled up to stand in for a drive.
    drive: await readDriveTimes(at, destination.at, destinationKey),
  };
}

/** The pre-#100 path: a home string the shared Geocode Cache still happens to hold. */
async function cachedHome(stated: string) {
  const key = normalizeLocation(stated);
  if (!key) return null;

  const at = await readGeocode(getDb(), key);
  return at && { ...at, precision: "city" as const };
}
