import { DISTANCE_ARRANGEMENTS, type Arrangement } from "@/criteria/schema";

/**
 * Which Postings the commute radius acts on, given the User's stance on remote
 * (ADR 0013) — written once, here, and read by everything that needs the answer.
 *
 * Three things have to agree about it: the radius stage itself, which excludes
 * a Posting it measures and finds too far (`@/operations/matching`); the
 * **Location unresolved** flag, which announces a Posting the radius meant to
 * measure and could not (`@/operations/postings`); and the COMMUTE DETAILS tab,
 * the screen that says how far away a measured Posting is
 * (`@/operations/commute`). Written out separately they drifted twice, and both
 * times over the same Posting — one tagged both remote and hybrid, shown to a
 * User who does not accept remote. The radius measured it, the flag went silent
 * on it (#111), and the tab hid itself on it (#112), so a role was dropped for
 * being too far with nothing anywhere saying how far.
 *
 * The stage runs in SQL and the other two run in TypeScript, so the rule is
 * written over whatever a caller's "boolean" happens to be: a `boolean` for the
 * flag and the tab, a drizzle `SQL` fragment for the stage. One function body,
 * two algebras, three readers, no copy to fall out of step.
 *
 * What they share is this question and only this question: which Postings the
 * radius acts on, given a stance. *Whether* a reader asks it at all stays its
 * own business — the flag says nothing unless a radius actually ran
 * (`radiusInEffect`), and the tab appears even for a User who stated no home to
 * measure from (user story 22). Agreeing about scope is not the same as running
 * in the same circumstances, and only the first is stated here.
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
