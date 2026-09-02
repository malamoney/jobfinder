// Type-only, and erased: this module still has nothing behind it, and still
// runs unchanged in the browser.
import type { HomeCoordinate } from "@/criteria/schema";
import type { Coordinate } from "@/geocoding/nominatim";

/**
 * What the COMMUTE DETAILS tab knows about one journey (#101).
 *
 * The shape the tab renders, so it lives in the half with no database behind
 * it — the same arrangement `@/review/schema` and `@/criteria/schema` have, and
 * what lets the client component import it without dragging Postgres into the
 * browser bundle.
 *
 * This is the walking skeleton: where the User lives, where the role is, how far
 * apart they are in a straight line, and whether that falls inside the radius
 * they stated. No routing provider is involved yet (#102), and nothing here is
 * ever multiplied up into a pretend drive time.
 */

/**
 * Where the User lives, as the tab is able to state it.
 *
 * Three answers rather than a nullable coordinate, because the User is owed a
 * different sentence for each: they have not said where they live; they said,
 * and the geocoder could not place it; or it is placed and everything else on
 * the tab can be measured. The middle one is not a failure to hide — a distance
 * measured from nowhere would be worse than none.
 */
export type CommuteHome =
  | { state: "none" }
  | { state: "unplaced"; stated: string }
  | {
      state: "placed";
      stated: string;
      at: HomeCoordinate;
      /** Straight-line miles to the Posting. */
      distanceMiles: number;
    };

/** Where the role is: the Source's own words, and the point they resolved to. */
export type CommuteDestination = {
  /** The location text as the employer wrote it, or null where they wrote none. */
  stated: string | null;
  at: Coordinate;
};

/**
 * One Posting's commute, as far as this slice can describe it.
 *
 * A Posting that is not a commute at all — remote, or a location no geocoder
 * could place — has no value of this type: `readCommute` answers null, and the
 * Posting page shows the review panel exactly as it did before, with no tab
 * strip (user stories 20 and 21).
 */
export type CommuteDetails = {
  destination: CommuteDestination;
  /**
   * Where the User lives — and, when that is known, how far it is. The distance
   * hangs off the placed home rather than sitting beside it, so "there is a
   * distance" and "there is somewhere to measure from" are one fact rather than
   * two that could contradict each other.
   */
  home: CommuteHome;
  /** The radius the User stated, or null when they stated none. */
  radiusMiles: number | null;
};

/** Whether the Posting falls inside the radius the User stated. */
export type RadiusVerdict = "within" | "outside";

/**
 * The radius verdict, or null when there is none to give — the User stated no
 * radius, or their home has no point to measure from.
 *
 * Null is not "outside". A Posting whose distance is unknown must not be
 * reported as too far, and a User who stated no radius is not owed a verdict
 * against a bound they never set.
 */
export function radiusVerdict({
  home,
  radiusMiles,
}: CommuteDetails): RadiusVerdict | null {
  if (home.state !== "placed" || radiusMiles == null) return null;
  return home.distanceMiles <= radiusMiles ? "within" : "outside";
}
