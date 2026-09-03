import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { criteria, geocodes, postings, type CriteriaRow } from "@/db/schema";
import { greatCircleMiles } from "@/commute/distance";
import type {
  CommuteDestination,
  CommuteDetails,
  CommuteHome,
} from "@/commute/schema";
import type { Arrangement } from "@/criteria/schema";
import { normalizeLocation } from "@/postings/location";
import { readGeocode } from "./geocoding";
import { homeCoordinateOf } from "./home-location";
import { isPostingId } from "./postings";

/**
 * The read behind the COMMUTE DETAILS tab (#101).
 *
 * Part of the primary seam (see `./index.ts`), sitting beside `readPosting` and
 * `readCriteria` rather than inside either: the Posting page asks for both at
 * once, and a Posting that is no journey answers null here without changing
 * anything about the Posting itself.
 *
 * Reads only. Nothing on this path calls a geocoder: a Posting's location is
 * placed by the match run that surfaced it (ADR 0005), and the User's home when
 * they saved their Criteria (ADR 0014), so opening a Posting costs a couple of
 * queries and no external call — which is what keeps the page as fast as it was
 * before the tab existed (user story 25).
 */

/** The Arrangement that means there is no journey to describe. */
const REMOTE: Arrangement = "remote";

/**
 * The commute from the User's home to one Posting, or null when the Posting is
 * not a journey the User would make.
 *
 * Two things make it null, and both mean "show the review panel exactly as it
 * was, with no tab strip":
 *
 * - **The Posting's text offers remote.** There is no journey to describe, and
 *   inventing one would be inventing a commute the User will never make (user
 *   story 20).
 * - **Its location resolved to no point.** Either the text named no place, or
 *   the geocoder knew none. A distance cannot be measured to nowhere, and a gap
 *   in the data must not become a broken screen (user story 21).
 *
 * Everything else with an address is a commute: onsite and hybrid as asked, and
 * also a Posting whose text names no Arrangement at all — it has an address and
 * that address geocoded, which is the reading ADR 0013 settled for the radius.
 *
 * **Where this departs from ADR 0013, deliberately.** That ADR scopes the radius
 * by the User's stance on remote: for a User who does not accept remote, even a
 * Posting whose text offers remote is measured, because they could only ever
 * take it onsite. This gate does not read the User's stance — a Posting whose
 * text says "remote or onsite" gets no tab either way. #101 states the rule
 * flatly ("whose Arrangement is not remote") and user story 20 asks for no tab
 * on a remote Posting at all, so the flat reading is what is built; scoping it
 * by stance is a change to make deliberately, not one to slip in here. The cost
 * is that a no-remote User loses a distance on a dual-tagged role. The cost of
 * the other reading would be a remote-accepting User shown a commute they will
 * never make, which is the one story 20 forbids.
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
  if (postingRow.arrangements.includes(REMOTE)) return null;
  if (postingRow.latitude == null || postingRow.longitude == null) return null;

  const destination: CommuteDestination = {
    stated: postingRow.location,
    at: { latitude: postingRow.latitude, longitude: postingRow.longitude },
  };

  return {
    destination,
    home: await homeOf(criteriaRow, destination),
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
  };
}

/** The pre-#100 path: a home string the shared Geocode Cache still happens to hold. */
async function cachedHome(stated: string) {
  const key = normalizeLocation(stated);
  if (!key) return null;

  const at = await readGeocode(getDb(), key);
  return at && { ...at, precision: "city" as const };
}
