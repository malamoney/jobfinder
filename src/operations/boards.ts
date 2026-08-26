import { asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { boards, fetchTasks, type FetchTaskStatus } from "@/db/schema";
import type { Board, BoardAddress } from "./fetch-board";

/** A Board to sweep, and whether the sweep should currently include it. */
export type BoardEntry = BoardAddress & { enabled?: boolean };

/**
 * Puts a Board into the curated set, or updates the one already there, and
 * hands back the Board a Fetch can be pointed at.
 *
 * Keyed on the Board's address rather than on a row id, so re-running a seed
 * (#18) is not a way to end up sweeping the same Board twice — and so a Board
 * added twice keeps the id its Postings already reference. A Board that dies
 * is disabled rather than removed: deleting it would only let the next
 * discovery run rediscover the Slug and add it back, and would orphan every
 * Posting it ever published.
 */
export async function addBoard(board: BoardEntry): Promise<Board> {
  const enabled = board.enabled ?? true;

  const [stored] = await getDb()
    .insert(boards)
    .values({ source: board.source, slug: board.slug, enabled })
    .onConflictDoUpdate({
      target: [boards.source, boards.slug],
      set: { enabled },
    })
    .returning({ id: boards.id, source: boards.source, slug: boards.slug });

  return stored;
}

/**
 * Puts a whole list of Boards into the curated set.
 *
 * The curated set is maintained by hand (see `docs/research/job-sources.md`
 * for what harvesting everything would cost), so the seed is a file someone
 * edits and re-runs as discovery turns up Boards worth promoting. Re-running
 * it is the normal case rather than an accident, and every Board keeps the id
 * its Postings already reference.
 *
 * Seeding decides whether a Board *exists* in the set; it deliberately does
 * not decide whether a Board is currently swept. `enabled` is therefore
 * honoured on the way in and never on the way back over: someone who disabled
 * a Board did so for a reason the seed file knows nothing about, and a re-run
 * that quietly re-enabled it would make disabling a thing that does not stay
 * done. Turning a Board back on is `addBoard`, which says so explicitly.
 */
export async function seedBoards(
  entries: readonly BoardEntry[],
): Promise<Board[]> {
  // One statement cannot update the same row twice, and a hand-edited seed
  // file is exactly where a Slug gets listed twice.
  const distinct = new Map(
    entries.map((entry) => [`${entry.source}/${entry.slug}`, entry]),
  );
  if (distinct.size === 0) return [];

  return getDb()
    .insert(boards)
    .values(
      [...distinct.values()].map((entry) => ({
        source: entry.source,
        slug: entry.slug,
        enabled: entry.enabled ?? true,
      })),
    )
    .onConflictDoUpdate({
      target: [boards.source, boards.slug],
      // A no-op write rather than `DO NOTHING`, so a Board already in the set
      // still comes back with its id — which is the whole point of returning
      // anything. Note what is not in here: `enabled`.
      set: { slug: sql`excluded.slug` },
    })
    .returning({ id: boards.id, source: boards.source, slug: boards.slug });
}

/** A Board in the curated set, with what became of it last time it was swept. */
export type CuratedBoard = Board & {
  enabled: boolean;
  /** What the newest finished Fetch of this Board did, or null if never. */
  lastFetch: {
    status: FetchTaskStatus;
    error: string | null;
    finishedAt: Date;
  } | null;
};

/**
 * Reads the curated set, with each Board's most recent Fetch outcome.
 *
 * Roughly one in six harvested Slugs goes dead within a sampling window, which
 * ADR 0003 records as a consequence of there being no directory of Boards, so
 * the set decays and has to be revalidated. The outcome is read from the
 * Board's newest finished task rather than kept as a column here — every Fetch
 * already records it, and a copy on the Board would be a second thing to keep
 * true.
 */
export async function listBoards(): Promise<CuratedBoard[]> {
  const db = getDb();

  // The newest finished task per Board. `DISTINCT ON` is Postgres picking one
  // row per group by the same ordering it sorts by, which is cheaper here than
  // a window function over a table that grows by one row per Board per night.
  const lastFetches = db
    .selectDistinctOn([fetchTasks.boardId], {
      boardId: fetchTasks.boardId,
      status: fetchTasks.status,
      error: fetchTasks.error,
      finishedAt: fetchTasks.finishedAt,
    })
    .from(fetchTasks)
    .where(isNotNull(fetchTasks.finishedAt))
    .orderBy(asc(fetchTasks.boardId), desc(fetchTasks.finishedAt))
    .as("last_fetches");

  const rows = await db
    .select({
      id: boards.id,
      source: boards.source,
      slug: boards.slug,
      enabled: boards.enabled,
      status: lastFetches.status,
      error: lastFetches.error,
      finishedAt: lastFetches.finishedAt,
    })
    .from(boards)
    .leftJoin(lastFetches, eq(lastFetches.boardId, boards.id))
    .orderBy(asc(boards.source), asc(boards.slug));

  return rows.map(({ status, error, finishedAt, ...board }) => ({
    ...board,
    lastFetch:
      status && finishedAt ? { status, error, finishedAt } : null,
  }));
}
