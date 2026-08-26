import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  count,
  eq,
  inArray,
  isNull,
  notExists,
  sql,
  type Column,
  type SQL,
} from "drizzle-orm";
import { getDb, type Writer } from "@/db";
import {
  boards,
  fetchRuns,
  fetchTasks,
  type FetchTaskStatus,
  type SourceName,
} from "@/db/schema";
import type { SourcePosting } from "@/sources/types";
import { readBoard, reconcileBoard, type Board } from "./fetch-board";

/** A Fetch run's identity, as `startFetchRun` hands it out. */
export type FetchRunId = string;

/** What one Board's fetch did within a run. */
export type FetchTaskReport = {
  source: SourceName;
  slug: string;
  status: FetchTaskStatus;
  /** Why the Board's fetch failed, and null on any other status. */
  error: string | null;
};

/** A run as an operator sees it: when it happened, and what each Board did. */
export type FetchRunReport = {
  id: FetchRunId;
  startedAt: Date;
  finishedAt: Date | null;
  tasks: FetchTaskReport[];
};

/**
 * Opens a Fetch run and queues one task per enabled Board.
 *
 * Queuing rather than fetching is the whole point: the caller returns in
 * milliseconds no matter how many Boards are enabled, and the sweep's duration
 * stops being bounded by how long one function invocation may run. Workers
 * drain the queue afterwards, one bounded batch at a time.
 */
export async function startFetchRun(): Promise<FetchRunId> {
  const db = getDb();

  return db.transaction(async (tx) => {
    const [run] = await tx.insert(fetchRuns).values({}).returning();

    const enabled = await tx
      .select({ id: boards.id })
      .from(boards)
      .where(eq(boards.enabled, true));

    if (enabled.length > 0) {
      await tx
        .insert(fetchTasks)
        .values(enabled.map((board) => ({ runId: run.id, boardId: board.id })));
    } else {
      // A Run with nothing to fetch is over the moment it starts. Leaving it
      // open would strand it: no Worker would ever touch it, so nothing would
      // ever close it.
      await tx
        .update(fetchRuns)
        .set({ finishedAt: sql`now()` })
        .where(eq(fetchRuns.id, run.id));
    }

    return run.id;
  });
}

/** How much of the queue one Worker may take on. */
export type FetchBatchOptions = {
  /** The most Boards this invocation will fetch before returning. */
  batchSize?: number;
  /**
   * How long this invocation may keep starting Boards. It always fetches at
   * least one, so a budget already spent cannot stall the queue forever.
   */
  timeBudgetMs?: number;
  /**
   * How long a claim is honoured before the invocation holding it is presumed
   * dead and its task is offered to another.
   */
  claimTimeoutMs?: number;
};

/** What one Worker got through. */
export type FetchBatchResult = {
  succeeded: number;
  failed: number;
  /** Tasks still to be worked on, across every run. Zero means done. */
  remaining: number;
};

/**
 * Deliberately smaller than the number of Boards a sweep covers: draining the
 * queue is the caller's job, done by invoking the Worker until nothing
 * remains, and a batch that could swallow the whole queue would put us back to
 * a sweep bounded by one invocation's lifetime.
 */
const DEFAULT_BATCH_SIZE = 25;

/** Comfortably inside a serverless invocation's ceiling. */
const DEFAULT_TIME_BUDGET_MS = 45_000;

/**
 * Longer than any invocation is allowed to live, so a claim only ever goes
 * stale because the invocation holding it is genuinely gone. Reclaiming work
 * from a Worker that is merely slow would have two Workers fetching one Board.
 */
const DEFAULT_CLAIM_TIMEOUT_MS = 120_000;

/**
 * Works whatever the queue offers, within a bounded number of Boards and a
 * bounded amount of time, and returns.
 *
 * This is the half of the design that makes a several-hundred-Board sweep
 * possible on a platform that kills long invocations: the run persists in the
 * queue, and each invocation moves it forward by as much as it can. Nothing
 * here assumes it is the only Worker, or that it will live long enough to
 * finish what it starts.
 *
 * One Board's failure is recorded against its own task and costs the run
 * nothing else — every other Board still gets fetched, this invocation
 * included.
 */
export async function runFetchBatch(
  options: FetchBatchOptions = {},
): Promise<FetchBatchResult> {
  const {
    batchSize = DEFAULT_BATCH_SIZE,
    timeBudgetMs = DEFAULT_TIME_BUDGET_MS,
    claimTimeoutMs = DEFAULT_CLAIM_TIMEOUT_MS,
  } = options;

  // This invocation's identity, so an outcome is only ever written for a task
  // this invocation still holds.
  const workerId = randomUUID();
  const deadline = Date.now() + timeBudgetMs;
  const runsWorked = new Set<FetchRunId>();

  let succeeded = 0;
  let failed = 0;

  for (let worked = 0; worked < batchSize; worked++) {
    if (worked > 0 && Date.now() >= deadline) break;

    const task = await claimNextTask(workerId, claimTimeoutMs);
    if (!task) break;
    runsWorked.add(task.runId);

    try {
      const fetched = await readBoard(task.board);
      if (await commitFetch(task, workerId, fetched)) {
        succeeded++;
      }
    } catch (error) {
      // Every failure mode of a Board's fetch lands here — a network error, a
      // non-2xx, or a response the adapter could not understand — and all of
      // them are recorded as failure rather than as "this Board returned
      // nothing". Expiry (#7) reads that distinction, and getting it wrong
      // would quietly empty the Corpus.
      if (
        await recordOutcome(getDb(), task.id, workerId, "failed", reasonFor(error))
      ) {
        failed++;
      }
    }
  }

  for (const runId of runsWorked) {
    await closeRunIfDrained(runId);
  }

  return { succeeded, failed, remaining: await countUnfinishedTasks() };
}

/**
 * The statuses a task can still be worked on from — the queue's definition of
 * unfinished, shared by everything that asks whether there is work left.
 *
 * `claimed` counts as unfinished because the Worker holding it may be dead: the
 * task is either about to be reported on or about to be reclaimed, and neither
 * is done.
 */
const WORKABLE_STATUSES: FetchTaskStatus[] = ["pending", "claimed"];

function workable(status: Column): SQL {
  return inArray(status, WORKABLE_STATUSES);
}

/** One Board's queued fetch, as the Worker holding it sees it. */
type ClaimedTask = {
  id: string;
  runId: FetchRunId;
  board: Board;
};

/**
 * Takes the next workable task, or nothing if the queue is empty.
 *
 * Workable means never claimed, or claimed so long ago that whoever claimed it
 * is presumed dead — which is how a batch killed mid-flight is recovered
 * without anyone noticing it died.
 *
 * `FOR UPDATE SKIP LOCKED` is what lets two Workers run at once: a row another
 * Worker is claiming is passed over rather than waited for, so concurrent
 * invocations divide the queue instead of serialising on it.
 */
async function claimNextTask(
  workerId: string,
  claimTimeoutMs: number,
): Promise<ClaimedTask | undefined> {
  const staleBefore = sql`now() - (${claimTimeoutMs / 1000}::double precision * interval '1 second')`;

  const claimed = await getDb().execute<{
    id: string;
    run_id: string;
    board_id: string;
    source: SourceName;
    slug: string;
  }>(sql`
    WITH workable AS (
      SELECT ${fetchTasks.id} FROM ${fetchTasks}
      WHERE ${fetchTasks.status} = 'pending'
         OR (${fetchTasks.status} = 'claimed' AND ${fetchTasks.claimedAt} < ${staleBefore})
      ORDER BY ${fetchTasks.createdAt}, ${fetchTasks.id}
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    ), claimed AS (
      UPDATE ${fetchTasks}
      SET ${sql.identifier(fetchTasks.status.name)} = 'claimed',
          ${sql.identifier(fetchTasks.claimedBy.name)} = ${workerId}::uuid,
          ${sql.identifier(fetchTasks.claimedAt.name)} = now(),
          ${sql.identifier(fetchTasks.attempts.name)} = ${fetchTasks.attempts} + 1
      WHERE ${fetchTasks.id} IN (SELECT id FROM workable)
      RETURNING ${fetchTasks.id}, ${fetchTasks.runId}, ${fetchTasks.boardId}
    )
    SELECT claimed.id, claimed.run_id, claimed.board_id, ${boards.source}, ${boards.slug}
    FROM claimed JOIN ${boards} ON ${boards.id} = claimed.board_id
  `);

  const [row] = claimed.rows;
  if (!row) return undefined;

  return {
    id: row.id,
    runId: row.run_id,
    board: { id: row.board_id, source: row.source, slug: row.slug },
  };
}

/**
 * Writes what a Board returned into the Corpus, and reports whether the Fetch
 * was this Worker's to record.
 *
 * The outcome is claimed *before* the Corpus is touched, and in the same
 * transaction, so the two either both happen or neither does. That is what
 * makes a reclaimed task safe now that a Fetch counts absences (#7): a Worker
 * whose Claim went stale while it was still alive would otherwise commit a
 * second Fetch of the same Board on the same night, and a Posting absent from
 * one of them would be counted twice and expire a night early.
 */
async function commitFetch(
  task: ClaimedTask,
  workerId: string,
  fetched: SourcePosting[],
): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    if (!(await recordOutcome(tx, task.id, workerId, "succeeded", null))) {
      return false;
    }

    await reconcileBoard(tx, task.board, fetched);
    return true;
  });
}

/**
 * Records what a Board's fetch did, and reports whether the record was ours to
 * write.
 *
 * The claim check is the guard against doing the work twice: an invocation
 * that was presumed dead, had its task reclaimed, and then came back to life
 * would otherwise overwrite the outcome of whoever actually finished it.
 */
async function recordOutcome(
  writer: Writer,
  taskId: string,
  workerId: string,
  status: Extract<FetchTaskStatus, "succeeded" | "failed">,
  error: string | null,
): Promise<boolean> {
  const written = await writer
    .update(fetchTasks)
    .set({ status, error, finishedAt: sql`now()` })
    .where(
      and(
        eq(fetchTasks.id, taskId),
        eq(fetchTasks.claimedBy, workerId),
        eq(fetchTasks.status, "claimed"),
      ),
    )
    .returning({ id: fetchTasks.id });

  return written.length > 0;
}

/**
 * Closes a run once nothing in it is workable any more.
 *
 * Written as one conditional statement rather than a read followed by a write,
 * so two Workers finishing their last tasks at the same moment cannot both
 * decide the run is still open.
 */
async function closeRunIfDrained(runId: FetchRunId): Promise<void> {
  const db = getDb();

  await db
    .update(fetchRuns)
    .set({ finishedAt: sql`now()` })
    .where(
      and(
        eq(fetchRuns.id, runId),
        isNull(fetchRuns.finishedAt),
        notExists(
          db
            .select({ id: fetchTasks.id })
            .from(fetchTasks)
            .where(
              and(eq(fetchTasks.runId, runId), workable(fetchTasks.status)),
            ),
        ),
      ),
    );
}

/** How much work the queue still holds, so a caller knows to come back. */
async function countUnfinishedTasks(): Promise<number> {
  const [counted] = await getDb()
    .select({ remaining: count() })
    .from(fetchTasks)
    .where(workable(fetchTasks.status));

  return counted?.remaining ?? 0;
}

/** The failure as it will be shown to whoever has to fix the Board (#17). */
function reasonFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Reads back a run and what each of its Boards did. */
export async function readFetchRun(id: FetchRunId): Promise<FetchRunReport> {
  const db = getDb();

  const [run] = await db.select().from(fetchRuns).where(eq(fetchRuns.id, id));
  if (!run) {
    throw new Error(`No Fetch run with id "${id}"`);
  }

  const tasks = await db
    .select({
      source: boards.source,
      slug: boards.slug,
      status: fetchTasks.status,
      error: fetchTasks.error,
    })
    .from(fetchTasks)
    .innerJoin(boards, eq(fetchTasks.boardId, boards.id))
    .where(eq(fetchTasks.runId, id))
    .orderBy(asc(boards.createdAt), asc(boards.slug));

  return {
    id: run.id,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    tasks,
  };
}
