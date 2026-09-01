"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { currentUser } from "@/auth";
import { matchCriteria, requestFetch, setSaved } from "@/operations";
import type { ReviewOutcome } from "@/review/schema";
import { advanceSweep } from "../api/cron/fetch/sweep";

/**
 * The two buttons on the Dashboard (#17).
 *
 * "Run matching now" re-runs the signed-in User's Criteria over the Corpus
 * already collected. "Fetch new postings" is the heavier one: a real sweep of
 * the Boards, cooldown-guarded so repeated clicking cannot spend a Source's
 * request budget.
 *
 * Both run their work after the response and return straight away. A re-match
 * warms the geocode cache for any location a Fetch introduced since the last
 * run (`warmGeocodesForMatch`), one geocoder call a second — bounded per run,
 * but still seconds of work that must not hold the request open, or a large
 * first run after a Fetch is killed at the platform's function ceiling
 * (`FUNCTION_INVOCATION_TIMEOUT`).
 *
 * Both are reachable by a direct POST, so each checks for a User itself rather
 * than trusting the page.
 */

/** What both actions answer with — a message shown in place on the Dashboard. */
export type DashboardActionResult = {
  ok: boolean;
  message: string;
};

const ENDED: DashboardActionResult = {
  ok: false,
  message: "Your session has ended. Log in and try again.",
};

/** Re-match the signed-in User against the Corpus as it stands. */
export async function runMatchingAction(): Promise<DashboardActionResult> {
  const signedIn = await currentUser(await headers());
  if (!signedIn) return ENDED;

  // After the response, for the reason in this module's comment: the warm-up a
  // re-match may need is bounded but not instant, and holding the request open
  // for it risks the platform's function timeout.
  after(() => matchCriteria(signedIn.id));
  revalidatePath("/dashboard");

  return {
    ok: true,
    message:
      "Re-matching against the postings already collected. Refresh shortly to see changes.",
  };
}

/** Trigger a real Fetch, unless one started within the cooldown. */
export async function fetchNowAction(): Promise<DashboardActionResult> {
  const requestHeaders = await headers();
  const signedIn = await currentUser(requestHeaders);
  if (!signedIn) return ENDED;

  const outcome = await requestFetch();
  if (!outcome.ok) {
    return { ok: false, message: outcome.message };
  }

  // The sweep runs after the response; the platform keeps the invocation alive
  // for it, and `advanceSweep` hands off anything a single invocation cannot
  // finish. Matches are rebuilt for everyone once the queue is empty.
  const origin =
    process.env.BETTER_AUTH_URL ??
    `https://${requestHeaders.get("host") ?? "localhost:3000"}`;
  after(() => advanceSweep(origin));

  revalidatePath("/dashboard");

  return {
    ok: true,
    message:
      "Fetching new postings now. It runs in the background — refresh shortly to see new matches.",
  };
}

/**
 * The Save toggle on a Dashboard card (#63): mark a matched Posting
 * `interested`, or un-mark it back to `new`.
 *
 * Reachable by a direct POST, so it checks for a User itself. On success it
 * revalidates the Dashboard so a filtered view (Interested, New) reflects the
 * change once the card's `router.refresh()` lands; the change of mind itself is
 * `setSaved`'s.
 */
export async function toggleSavedAction(
  postingId: string,
  saved: boolean,
): Promise<ReviewOutcome> {
  const signedIn = await currentUser(await headers());
  if (!signedIn) {
    return {
      ok: false,
      message: "Your session has ended. Log in and try again.",
    };
  }

  const outcome = await setSaved(signedIn.id, postingId, saved);
  if (outcome.ok) revalidatePath("/dashboard");
  return outcome;
}
