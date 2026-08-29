import { drainAndRematch } from "@/operations";

/**
 * Moving a Fetch sweep forward from a Next entry point (#17).
 *
 * Shared by the nightly cron route and the Dashboard's "Fetch new postings"
 * button so "how a sweep makes progress" is defined in one place: drain a
 * budget's worth of the queue, re-match everyone if that finished it, and
 * otherwise hand the rest to a fresh invocation of the cron route rather than
 * risk this one being killed mid-sweep.
 *
 * Server-side only — it reaches `@/operations`, which reaches Postgres. Imported
 * only by the cron route and a Server Action, both of which run on the server.
 */

/** The path the cron route serves, with the flag that skips opening a new run. */
const CONTINUE_PATH = "/api/cron/fetch?continue=1";

/**
 * Drains as much of the queue as one invocation's budget allows, then either
 * re-matches every User (queue empty) or triggers a continuation.
 *
 * `origin` is the deployment's own base URL, used to call back into the cron
 * route. Without a `CRON_SECRET` there is no way to authenticate that call, so
 * the hand-off is skipped and the next nightly tick resumes the queue.
 */
export async function advanceSweep(origin: string): Promise<void> {
  const { remaining } = await drainAndRematch();
  if (remaining === 0) return;

  const secret = process.env.CRON_SECRET;
  if (!secret) return;

  await fetch(new URL(CONTINUE_PATH, origin), {
    headers: { authorization: `Bearer ${secret}` },
  }).catch(() => {
    // A hand-off that does not land is not fatal — the next nightly tick
    // drains whatever is still queued.
  });
}
