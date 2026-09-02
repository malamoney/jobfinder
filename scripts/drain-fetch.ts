/**
 * Works the Fetch queue to completion from the command line, then closes the
 * run and re-matches every User — the job the nightly cron does in `after`,
 * run by hand when that stalled.
 *
 *   pnpm drain               # drain whatever is queued, ~60s progress passes
 *   pnpm drain --budget 120  # seconds per pass before it prints and loops
 *
 * A sweep that opened a run but left Fetch Tasks `pending` — the continuation
 * hand-off never landed (`CRON_SECRET` unset, the self-callback failed), or the
 * first `after` invocation was cut before a batch ran — sits there until the
 * next nightly tick. This drains it now: no serverless ceiling, so one process
 * can spend the minutes a few hundred Boards take.
 *
 * Same seam as the cron (`drainAndRematch`): each pass claims a budget's worth
 * of the queue; the pass that empties it also re-derives `country`, prunes the
 * non-US roles no User acted on, and rebuilds every Match set. Safe to Ctrl-C
 * and re-run — an interrupted claim goes stale and is reclaimed.
 *
 * Needs DATABASE_URL. Point it at the environment whose queue is stuck.
 */
import { inArray, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db";
import { fetchTasks } from "@/db/schema";
import { drainAndRematch, readLatestFetchRun } from "@/operations";

/** Seconds a pass may keep taking Boards before it reports and loops. */
const DEFAULT_BUDGET_SECONDS = 60;

function budgetMs(): number {
  const flag = process.argv.indexOf("--budget");
  if (flag === -1) return DEFAULT_BUDGET_SECONDS * 1000;

  const seconds = Number(process.argv[flag + 1]);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("--budget wants a positive number of seconds");
  }
  return seconds * 1000;
}

async function queuedCount(): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(fetchTasks)
    .where(inArray(fetchTasks.status, ["pending", "claimed"]));
  return row?.n ?? 0;
}

async function main(): Promise<void> {
  const queued = await queuedCount();
  if (queued === 0) {
    console.log("Queue is empty — nothing to drain.");
    return;
  }
  console.log(`${queued} Fetch Task(s) queued. Draining…`);

  const budget = budgetMs();
  let pass = 0;
  let remaining = queued;
  while (remaining > 0) {
    pass += 1;
    const result = await drainAndRematch({ budgetMs: budget });
    remaining = result.remaining;
    console.log(
      `  pass ${pass}: ${result.succeeded} ok, ${result.failed} failed this pass · ${remaining} still queued`,
    );
  }

  console.log("\nQueue drained. Country re-classified, non-US roles pruned, Matches rebuilt.");

  const run = await readLatestFetchRun();
  if (run?.finishedAt) {
    console.log(
      `Last run: ${run.succeeded}/${run.boardCount} Boards, ${run.failed} failed, finished ${run.finishedAt.toISOString()}.`,
    );
    for (const failure of run.failures) {
      console.log(`  ${failure.source}/${failure.slug} — ${failure.error}`);
    }
  }
}

try {
  await main();
} finally {
  await closeDb();
}
