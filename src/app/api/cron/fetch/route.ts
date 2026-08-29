import { after } from "next/server";
import { startFetchRun } from "@/operations";
import { advanceSweep } from "./sweep";

/**
 * The nightly Fetch.
 *
 * `vercel.json` points one cron at this route at 03:00 (ADR 0002 — one
 * system-wide schedule, not per User). The route is a public URL, so it is
 * guarded by `CRON_SECRET`: Vercel sends it as a Bearer token on the cron
 * request and a request without it is refused.
 *
 * The sweep runs in `after`, so the response returns immediately and the
 * platform keeps the invocation alive until the work settles. A sweep too big
 * to finish inside one invocation's budget hands the rest of the queue to a
 * fresh one (`?continue=1`, via `advanceSweep`); if even that is interrupted,
 * the unfinished Fetch Tasks stay queued and the next nightly tick drains them.
 */

// The `after` work runs within this ceiling; `DEFAULT_DRAIN_BUDGET_MS` (50s)
// leaves headroom for the batch in flight and the hand-off request to return.
export const maxDuration = 60;

/** Whether this request carries the cron secret Vercel signs the cron with. */
function fromCron(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request): Promise<Response> {
  if (!fromCron(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const continuing =
    new URL(request.url).searchParams.get("continue") === "1";

  // The first invocation opens the run; a continuation just keeps draining the
  // queue that invocation left behind.
  if (!continuing) {
    await startFetchRun();
  }

  after(() => advanceSweep(new URL(request.url).origin));

  return Response.json({ ok: true, continuing });
}
