"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { currentUser } from "@/auth";
import { requestFetch, setSaved } from "@/operations";
import type { ReviewOutcome } from "@/review/schema";
import { advanceSweep } from "../api/cron/fetch/sweep";

/**
 * "Run scan now" on the Dashboard (#17): a real sweep of the Boards,
 * cooldown-guarded so repeated clicking cannot spend a Source's request budget.
 *
 * The sweep runs after the response and the action returns straight away — the
 * platform keeps the invocation alive for it, and `advanceSweep` hands off
 * anything one invocation cannot finish. Matches are rebuilt for everyone once
 * the queue drains, so there is no separate "re-match" control: Matching also
 * re-runs on every Criteria save and after the nightly Fetch.
 *
 * Reachable by a direct POST, so it checks for a User itself rather than
 * trusting the page.
 */

/** What the action answers with — a message shown in place on the Dashboard. */
export type DashboardActionResult = {
  ok: boolean;
  message: string;
};

const ENDED: DashboardActionResult = {
  ok: false,
  message: "Your session has ended. Log in and try again.",
};

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
