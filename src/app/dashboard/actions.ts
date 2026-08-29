"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { currentUser } from "@/auth";
import { matchCriteria, requestFetch } from "@/operations";
import { advanceSweep } from "../api/cron/fetch/sweep";

/**
 * The two buttons on the Dashboard (#17).
 *
 * "Run matching now" re-runs the signed-in User's Criteria over the Corpus
 * already collected. "Fetch new postings" is the heavier one: a real sweep of
 * the Boards, cooldown-guarded so repeated clicking cannot spend a Source's
 * request budget, and run in the background so the click returns straight away.
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

  await matchCriteria(signedIn.id);
  revalidatePath("/dashboard");

  return {
    ok: true,
    message: "Re-matched against the postings already collected.",
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
