import { DISTANCE_ARRANGEMENTS, type Arrangement } from "@/criteria/schema";

/**
 * Which Postings the commute radius acts on, given the User's stance on remote
 * (ADR 0013) — written once, here, and read by everything that needs the answer.
 *
 * Two things have to agree about it: the radius stage itself, which excludes a
 * Posting it measures and finds too far (`@/operations/matching`), and the
 * **Location unresolved** flag, which announces a Posting the radius meant to
 * measure and could not (`@/operations/postings`). Written out twice they
 * drifted, and the flag went silent on exactly the Postings it exists for
 * (#111) — a Posting tagged both remote and hybrid, shown to a User who does
 * not accept remote, was measured by nothing and flagged by nothing.
 *
 * The stage runs in SQL and the flag runs in TypeScript, so the rule is written
 * over whatever a caller's "boolean" happens to be: a `boolean` for the flag, a
 * drizzle `SQL` fragment for the stage. One function body, two readings, no
 * copy to fall out of step.
 *
 * The COMMUTE DETAILS tab (`@/operations/commute`) is a third reader-in-waiting
 * and deliberately not one yet: it gates on the Posting's text alone, for the
 * reasons its own doc sets out, so a Posting tagged "remote or onsite" gets no
 * tab even for a User who does not accept remote. Bringing it under this rule
 * is #112 — until then, do not read it as following what is written here.
 */

/** The Arrangement that means the work can be done from home. */
const REMOTE: Arrangement = "remote";

/** The two things the rule asks about a Posting's Arrangements. */
export type ArrangementFacts<T> = {
  /** Its text places the work onsite or hybrid. */
  namesDistanceArrangement: T;
  /** Its text offers remote. */
  offersRemote: T;
};

/** Just enough boolean algebra to state the rule in. */
export type Logic<T> = {
  and(left: T, right: T): T;
  not(value: T): T;
  always: T;
};

/**
 * Whether the commute radius acts on a Posting with these Arrangements, for a
 * User who accepts these ones.
 *
 * - **The User accepts remote.** Only a Posting whose text places it onsite or
 *   hybrid *and* does not offer remote is measured. A remote-offering Posting
 *   can be done from home wherever it is based, and one silent on its location
 *   mode gets the same benefit of the doubt the Arrangement stage gives a
 *   silent axis.
 * - **The User does not accept remote.** Everything is measured. Every role is
 *   a commute for them, so a Posting's address is the whole question — whether
 *   or not its text also says "remote", and whether or not it says anything
 *   (#73).
 */
export function radiusApplies<T>(
  accepted: readonly Arrangement[],
  facts: ArrangementFacts<T>,
  logic: Logic<T>,
): T {
  if (!accepted.includes(REMOTE)) return logic.always;

  return logic.and(
    facts.namesDistanceArrangement,
    logic.not(facts.offersRemote),
  );
}

/** The rule's boolean algebra, in TypeScript. */
const BOOLEANS: Logic<boolean> = {
  and: (left, right) => left && right,
  not: (value) => !value,
  always: true,
};

/**
 * The rule read over Arrangements already in hand — what everything but the SQL
 * stage wants.
 */
export function radiusAppliesTo(
  accepted: readonly Arrangement[],
  postingArrangements: readonly Arrangement[],
): boolean {
  return radiusApplies(
    accepted,
    {
      namesDistanceArrangement: postingArrangements.some((arrangement) =>
        (DISTANCE_ARRANGEMENTS as readonly Arrangement[]).includes(arrangement),
      ),
      offersRemote: postingArrangements.includes(REMOTE),
    },
    BOOLEANS,
  );
}
