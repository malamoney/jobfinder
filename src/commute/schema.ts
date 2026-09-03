// Type-only, and erased: this module still has nothing behind it, and still
// runs unchanged in the browser.
import type { HomeCoordinate } from "@/criteria/schema";
import type { Coordinate } from "@/geocoding/nominatim";
import type { Clock } from "./drive";

/**
 * What the COMMUTE DETAILS tab knows about one journey (#101).
 *
 * The shape the tab renders, so it lives in the half with no database behind
 * it — the same arrangement `@/review/schema` and `@/criteria/schema` have, and
 * what lets the client component import it without dragging Postgres into the
 * browser bundle.
 *
 * Where the User lives, where the role is, how far apart they are in a straight
 * line, whether that falls inside the radius they stated (#101), and how long
 * the drive typically takes in each direction (#102).
 *
 * Nothing here is ever derived from the straight line. A drive time is a figure
 * a routing provider gave us or it is absent, and absent is what a User sees
 * when no provider is configured or it could not be reached — never a distance
 * multiplied by a guess.
 */

/**
 * How long the drive takes in each of the two windows, as the tab quotes them.
 *
 * Both windows or neither. A single window would raise a question the tab
 * cannot answer — a User told the morning is forty minutes and shown nothing
 * for the evening would reasonably read that as "the evening is fine", and it
 * is exactly the asymmetry user story 3 exists to expose. The provider is asked
 * about both at once, so the two answer together or the drive is simply unknown.
 */
export type CommuteDrive = {
  /**
   * The drive that arrives in time for a 9am start, and the local clock time
   * the User would have to leave home to make it (user story 4).
   */
  morning: { seconds: number; leaveAt: Clock };
  /** The drive home, leaving at 5:30pm. */
  evening: { seconds: number };
};

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
      /**
       * How long the journey takes by car, or null when nobody could tell us —
       * no routing provider configured, one that could not be reached, or a
       * journey it knows no route for.
       *
       * Hung off the placed home for the reason `distanceMiles` is: a drive
       * time and somewhere to drive from are one fact, and a journey measured
       * from nowhere is not a journey. Null is silence, never an estimate.
       */
      drive: CommuteDrive | null;
    };

/** Where the role is: the Source's own words, and the point they resolved to. */
export type CommuteDestination = {
  /** The location text as the employer wrote it, or null where they wrote none. */
  stated: string | null;
  /**
   * Which of the places that text names this journey ends at, in the employer's
   * words — the closest one to the User, since that is the one the radius judged
   * the Posting on (#113).
   *
   * Null when the text names a single place, because the stated text already is
   * that place and repeating it would only suggest there were others. So a tab
   * naming a place is a tab saying "there is more than one, and this is the one
   * everything below is measured to".
   */
  place: string | null;
  at: Coordinate;
};

/**
 * One Posting's commute, as far as this slice can describe it.
 *
 * A Posting that is not a commute at all — one the commute radius does not act
 * on for this User (ADR 0013, `@/commute/radius-scope`), or one whose location
 * no geocoder could place — has no value of this type: `readCommute` answers
 * null, and the Posting page shows the review panel exactly as it did before,
 * with no tab strip (user stories 20 and 21).
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
