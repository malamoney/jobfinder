import { desc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { fetchRuns, type SourceName } from "@/db/schema";
import {
  createFetchRun,
  readFetchRun,
  runFetchBatch,
  type FetchBatchOptions,
  type FetchRunId,
} from "./fetch-run";
import { matchAllUsers } from "./matching";
import { pruneNonUsPostings } from "./prune";

/**
 * Scheduling a Fetch: the nightly sweep, an on-demand sweep, and the status of
 * the last one (#17).
 *
 * The nightly cron calls `createFetchRun` then `drainAndRematch` directly, with
 * no cooldown — it is the schedule, not a click. `requestFetch` is the
 * on-demand path: cooldown-guarded, so repeated clicking cannot spend a
 * Source's request budget. `readLatestFetchRun` is what the Dashboard shows so
 * a User can tell "no new roles" apart from "the sweep broke".
 *
 * Tested through this seam (`fetch-schedule.test.ts`), against a real Postgres,
 * with MSW supplying what each Board returns.
 */

/**
 * How long after a Fetch starts before another may be triggered by hand.
 *
 * An hour: long enough that clicking twice does nothing, short enough that a
 * User who knows a role was just posted is not told to wait until tomorrow. The
 * nightly cron is exempt — it drives the schedule this guards against abuse of.
 */
export const FETCH_COOLDOWN_MS = 60 * 60 * 1000;

/**
 * A fixed key for `pg_advisory_xact_lock`, held across the cooldown check and
 * the run insert so two concurrent `requestFetch` calls cannot both pass the
 * check and both start a run.
 */
const FETCH_REQUEST_LOCK = 1_710_017;

/** What `requestFetch` answers with. */
export type FetchRequestOutcome =
  | { ok: true; runId: FetchRunId }
  | {
      ok: false;
      message: string;
      /** When an on-demand Fetch will be allowed again. */
      retryAfter: Date;
    };

/**
 * Starts an on-demand Fetch, unless one started within the cooldown.
 *
 * Refuses with a message and a time rather than silently doing nothing, so the
 * Dashboard can say why the button did not appear to work (#17). The message
 * speaks only to when the last Fetch *started*, not to whether it succeeded —
 * the cooldown is about not hammering the Sources, and that holds whatever the
 * last sweep did.
 */
export async function requestFetch(): Promise<FetchRequestOutcome> {
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${FETCH_REQUEST_LOCK})`);

    const [latest] = await tx
      .select({ startedAt: fetchRuns.startedAt })
      .from(fetchRuns)
      .orderBy(desc(fetchRuns.startedAt))
      .limit(1);

    if (latest) {
      const elapsedMs = Date.now() - latest.startedAt.getTime();
      if (elapsedMs < FETCH_COOLDOWN_MS) {
        const retryAfter = new Date(
          latest.startedAt.getTime() + FETCH_COOLDOWN_MS,
        );
        const minutes = Math.max(
          1,
          Math.ceil((FETCH_COOLDOWN_MS - elapsedMs) / 60_000),
        );
        return {
          ok: false as const,
          message: `A fetch started less than an hour ago. The next on-demand fetch can start in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
          retryAfter,
        };
      }
    }

    return { ok: true as const, runId: await createFetchRun(tx) };
  });
}

/** How long `drainFetchQueue` may keep taking on Worker batches. */
export type DrainOptions = {
  /**
   * The wall-clock ceiling. Once it passes, `drainFetchQueue` returns whatever
   * is left for the next invocation to pick up — the queue design means no one
   * invocation has to finish the sweep.
   */
  budgetMs?: number;
  /** Passed through to each `runFetchBatch`. */
  batch?: FetchBatchOptions;
};

/** What a drain got through. */
export type DrainResult = {
  batches: number;
  succeeded: number;
  failed: number;
  /** Tasks still queued across every run. Zero means the sweep is done. */
  remaining: number;
};

/**
 * Safe inside a serverless invocation on any plan — well under a 60-second
 * function ceiling, with room for the batch in flight when it runs out and for
 * the hand-off to a fresh invocation to still be made.
 */
export const DEFAULT_DRAIN_BUDGET_MS = 50_000;

/**
 * Works the queue batch after batch until it is empty or the budget is spent.
 *
 * A single call drives a whole small sweep to completion; a large one is moved
 * forward as far as the budget allows and resumed by the next invocation. Runs
 * at least one batch, so a spent budget cannot leave the queue untouched.
 */
export async function drainFetchQueue(
  options: DrainOptions = {},
): Promise<DrainResult> {
  const { budgetMs = DEFAULT_DRAIN_BUDGET_MS, batch } = options;
  const deadline = Date.now() + budgetMs;

  let batches = 0;
  let succeeded = 0;
  let failed = 0;
  let remaining = 0;

  do {
    const result = await runFetchBatch(batch);
    batches += 1;
    succeeded += result.succeeded;
    failed += result.failed;
    remaining = result.remaining;
  } while (remaining > 0 && Date.now() < deadline);

  return { batches, succeeded, failed, remaining };
}

/**
 * Drives the queue forward, and — only once the whole queue is drained — prunes
 * the non-US roles stored before ADR 0010 (`pruneNonUsPostings`), then rebuilds
 * every User's Matches so overnight Postings reach their Dashboard (#2, user
 * story 20; #17).
 *
 * The prune runs *before* the re-match, so `matchAllUsers` never spends
 * Extraction and matching on rows about to be deleted, and there is no window in
 * which a Dashboard read could surface a non-US role the prune is about to
 * remove. The batch is looped within a short budget so a large first backlog
 * clears in a night or two rather than one 500-row batch per night.
 *
 * The "drain, then prune, then re-match when done" sequence lives here, at the
 * seam, rather than in each Next entry point that kicks a sweep. The caller
 * checks `remaining`: above zero, more invocations are needed and none of the
 * three has happened yet.
 */
export async function drainAndRematch(
  options: DrainOptions = {},
): Promise<DrainResult> {
  const result = await drainFetchQueue(options);
  if (result.remaining === 0) {
    const pruned = await prunePendingNonUs();
    if (pruned > 0) await recordNonUsPruned(pruned);
    await matchAllUsers();
  }
  return result;
}

/**
 * How long the closing prune may keep taking batches. Small — the sweep and the
 * re-match are the night's real work, and whatever the prune does not reach is
 * caught by the next run.
 */
const PRUNE_BUDGET_MS = 10_000;

/** Prunes non-US roles batch after batch until none remain or the budget is spent. */
async function prunePendingNonUs(): Promise<number> {
  const deadline = Date.now() + PRUNE_BUDGET_MS;
  let total = 0;
  let removed: number;
  do {
    removed = await pruneNonUsPostings();
    total += removed;
  } while (removed > 0 && Date.now() < deadline);
  return total;
}

/**
 * Tallies a prune's deletions onto the most recent run, so a run summary's
 * `nonUsPruned` reflects the sweep that triggered it. Accumulates, because a
 * large first backlog is pruned a batch per nightly invocation and each one
 * lands against the same run.
 */
async function recordNonUsPruned(count: number): Promise<void> {
  const db = getDb();
  const [latest] = await db
    .select({ id: fetchRuns.id })
    .from(fetchRuns)
    .orderBy(desc(fetchRuns.startedAt))
    .limit(1);
  if (!latest) return;

  await db
    .update(fetchRuns)
    .set({ nonUsPruned: sql`${fetchRuns.nonUsPruned} + ${count}` })
    .where(eq(fetchRuns.id, latest.id));
}

/** One Board that failed in a Fetch, and why. */
export type FetchFailure = {
  source: SourceName;
  slug: string;
  error: string;
};

/** The last Fetch as the Dashboard shows it. */
export type FetchRunSummary = {
  /** When the summarised run finished, or null if no run has finished yet. */
  finishedAt: Date | null;
  /** A sweep is in progress right now (a newer run has not finished). */
  running: boolean;
  /** How many Boards the summarised run swept. */
  boardCount: number;
  succeeded: number;
  failed: number;
  /** The failed Boards with their reasons, so a dead Board can be found (#17). */
  failures: FetchFailure[];
  /**
   * How many roles the run's Fetches saw and did not store because their
   * location does not place them in the US, and — separately — how many
   * already-stored such roles the sweep's closing prune removed (ADR 0010).
   */
  nonUsDropped: number;
  nonUsPruned: number;
};

/**
 * The most recent *finished* Fetch, summarised, plus whether a newer one is
 * running — or null if none has ever run.
 *
 * The run described is the last one to finish, not simply the newest: a sweep
 * in progress must not hide the outcome of the one before it, which is exactly
 * what a User checking "did last night work?" while tonight's runs needs to
 * see.
 */
export async function readLatestFetchRun(): Promise<FetchRunSummary | null> {
  const db = getDb();

  const runColumns = {
    id: fetchRuns.id,
    finishedAt: fetchRuns.finishedAt,
    nonUsDropped: fetchRuns.nonUsDropped,
    nonUsPruned: fetchRuns.nonUsPruned,
  };

  const [newest] = await db
    .select(runColumns)
    .from(fetchRuns)
    .orderBy(desc(fetchRuns.startedAt))
    .limit(1);
  if (!newest) return null;

  const running = newest.finishedAt === null;

  const [describe] = running
    ? await db
        .select(runColumns)
        .from(fetchRuns)
        .where(isNotNull(fetchRuns.finishedAt))
        .orderBy(desc(fetchRuns.startedAt))
        .limit(1)
    : [newest];

  if (!describe) {
    // A run is in progress and none has ever finished — the very first sweep.
    return {
      finishedAt: null,
      running: true,
      boardCount: 0,
      succeeded: 0,
      failed: 0,
      failures: [],
      nonUsDropped: 0,
      nonUsPruned: 0,
    };
  }

  const report = await readFetchRun(describe.id);
  const failures = report.tasks
    .filter((task) => task.status === "failed")
    .map((task) => ({
      source: task.source,
      slug: task.slug,
      error: task.error ?? "Unknown error",
    }));

  return {
    finishedAt: report.finishedAt,
    running,
    boardCount: report.tasks.length,
    succeeded: report.tasks.filter((task) => task.status === "succeeded").length,
    failed: failures.length,
    failures,
    nonUsDropped: describe.nonUsDropped,
    nonUsPruned: describe.nonUsPruned,
  };
}
