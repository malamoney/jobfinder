import {
  and,
  eq,
  getTableColumns,
  notInArray,
  sql,
  type Column,
  type SQL,
} from "drizzle-orm";
import { getDb, type Transaction } from "@/db";
import { postings, type SourceName } from "@/db/schema";
import { dedupKey } from "@/postings/dedup-key";
import { fetchAshbyBoard } from "@/sources/ashby";
import { fetchGreenhouseBoard } from "@/sources/greenhouse";
import { fetchHimalayasBoard } from "@/sources/himalayas";
import { fetchLeverBoard } from "@/sources/lever";
import { fetchRecruiteeBoard } from "@/sources/recruitee";
import { fetchUsajobsBoard } from "@/sources/usajobs";
import { fetchWorkableBoard } from "@/sources/workable";
import { fetchWorkdayBoard } from "@/sources/workday";
import type { SourcePosting } from "@/sources/types";

/**
 * Where a Board lives: the Source, and that Source's own name for it.
 *
 * All it takes to *ask* a Source about a Board, which is why discovery can
 * probe a Slug nobody has promoted yet (#18).
 */
export type BoardAddress = {
  source: SourceName;
  slug: string;
};

/**
 * One company's listings within a Source, as the curated set holds it.
 *
 * Carries the curated set's own id as well as the address, because a Posting
 * records which Board published it by reference. *Writing* to the Corpus
 * therefore only happens against a Board the application knows about — a Slug
 * being probed for the first time is a candidate, and what it publishes does
 * not belong in the shared Corpus until someone promotes it.
 */
export type Board = BoardAddress & {
  id: string;
};

/**
 * How one Source is fetched, and how its Postings stop being live.
 *
 * `expiry` is the fork between the two kinds of Source (#15):
 *
 * - `absence` — the ATS Boards. One request returns the Board's entire current
 *   state, so a Posting missing from a successful Fetch is gone, and
 *   `countAbsences` moves it toward Expired (ADR 0004).
 * - `published-expiry` — the aggregators. Their feed spans thousands of
 *   employers and a Fetch pulls only a bounded slice of it, so absence means
 *   nothing. `countAbsences` is skipped, and `isExpired` reads the close date
 *   the feed published for each Posting (`expiresAt`).
 *
 * `timeoutMs` overrides the caller's default ceiling for Sources that page
 * through a feed and so take longer than a single-request Board.
 */
type SourceAdapter = {
  fetch: (slug: string, signal: AbortSignal) => Promise<SourcePosting[]>;
  expiry: "absence" | "published-expiry";
  timeoutMs?: number;
};

/**
 * The adapter each Source is reached through.
 *
 * A record keyed by `SourceName` rather than a lookup with a default, so a
 * Source added to the union without an adapter is a type error rather than a
 * Fetch that fails at midnight.
 */
const ADAPTERS: Record<SourceName, SourceAdapter> = {
  greenhouse: { fetch: fetchGreenhouseBoard, expiry: "absence" },
  lever: { fetch: fetchLeverBoard, expiry: "absence" },
  ashby: { fetch: fetchAshbyBoard, expiry: "absence" },
  workable: { fetch: fetchWorkableBoard, expiry: "absence" },
  recruitee: { fetch: fetchRecruiteeBoard, expiry: "absence" },
  usajobs: {
    fetch: fetchUsajobsBoard,
    expiry: "published-expiry",
    timeoutMs: 35_000,
  },
  himalayas: {
    fetch: fetchHimalayasBoard,
    expiry: "published-expiry",
    timeoutMs: 35_000,
  },
  // A Board — one company, absence expiry — but a detail request per job over
  // a paged list, so it needs far longer than a single-request Board (#16).
  // The Worker still caps this against what is left of its batch budget.
  workday: { fetch: fetchWorkdayBoard, expiry: "absence", timeoutMs: 120_000 },
};

/**
 * The ceiling one Board's Fetch gets before a Worker's remaining budget is
 * applied.
 *
 * An aggregator pages through a feed and needs longer than a single-request
 * Board, so it raises the floor to its own `timeoutMs`; every other Source
 * takes `fallback` unchanged. The Worker still caps this against how much of
 * its batch is left (`runFetchBatch`), so a longer ceiling never lets a Board
 * outlive the invocation working it.
 */
export function boardTimeoutFor(source: SourceName, fallback: number): number {
  return Math.max(ADAPTERS[source].timeoutMs ?? 0, fallback);
}

/** How patient a Fetch of one Board is willing to be. */
export type BoardFetchOptions = {
  /** The most this Board's Fetch may take before it is given up on. */
  timeoutMs?: number;
};

/**
 * The ceiling for a Fetch nobody set one for.
 *
 * Generous enough for a large Board answering slowly, and far below the
 * minutes an unguarded `fetch` would wait. A Worker overrides it with what is
 * left of its own budget, which is the number that actually matters (#25);
 * this is for callers with no queue behind them, such as #18's discovery
 * probe, where the only requirement is that the wait ends.
 */
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Fetches one Board and reconciles the Corpus with what it returned.
 *
 * Throws if the Board could not be fetched or its response could not be
 * understood, and writes nothing in that case. That is ADR 0004's invariant,
 * and it is structural rather than remembered: `readBoard` throws before there
 * is anything to reconcile against, so a Board that failed cannot reach the
 * code that reads absence as evidence.
 *
 * A Fetch that belongs to a queued run goes through those two halves
 * separately, so the Corpus write can be made one transaction with the task's
 * outcome; this is the whole Fetch for a caller that has no queue, which is
 * how tests and #18's discovery probe reach a Board.
 */
export async function fetchBoard(
  board: Board,
  options: BoardFetchOptions = {},
): Promise<void> {
  const fetched = await readBoard(board, options);
  await getDb().transaction((tx) => reconcileBoard(tx, board, fetched));
}

/**
 * Asks a Source what a Board lists now, and returns it without writing
 * anything.
 *
 * Separate from the writing half because the answer has to be in hand before a
 * Worker commits to it: what the Board said and whether the Worker still holds
 * the Claim on it are decided together (see `runFetchBatch`).
 *
 * Always bounded. A Source that accepts the request and then goes quiet is not
 * a case any adapter can detect for itself, and an unguarded `fetch` waits on
 * it for minutes — so the ceiling lives here, where every Source gets it,
 * rather than in each adapter where a new one could forget it.
 */
export async function readBoard(
  board: BoardAddress,
  { timeoutMs }: BoardFetchOptions = {},
): Promise<SourcePosting[]> {
  // A caller that named a ceiling (a Worker, spending its own budget) is
  // trusted to have already accounted for the Source — `runFetchBatch` folds
  // in `boardTimeoutFor`. A caller that named none (tests, #18's probe) gets
  // the Source's own ceiling over the bare default.
  const ceiling =
    timeoutMs ?? boardTimeoutFor(board.source, DEFAULT_TIMEOUT_MS);
  try {
    return await ADAPTERS[board.source].fetch(
      board.slug,
      AbortSignal.timeout(ceiling),
    );
  } catch (error) {
    // Said in the adapters' own register, so #17 can tell a Board that never
    // spoke from one that refused — they call for different things, and the
    // raw abort says only "the operation was aborted".
    if (isTimeout(error)) {
      throw new Error(
        `${board.source} Board "${board.slug}" did not answer within ${ceiling}ms`,
      );
    }
    throw error;
  }
}

/** `AbortSignal.timeout` aborts with a `DOMException` named `TimeoutError`. */
function isTimeout(error: unknown): boolean {
  return error instanceof DOMException && error.name === "TimeoutError";
}

/**
 * Makes the Corpus agree with what a Board returned: the Postings it listed
 * are stored, and — for a Source whose Fetch sees the Board's whole state —
 * the ones it no longer lists are counted as absent, which is how they
 * eventually expire (#7).
 *
 * Absence is only counted for `absence`-expiry Sources. An aggregator's Fetch
 * pulls a bounded slice of a feed spanning thousands of employers (#15), so a
 * Posting missing from the slice is not gone — it expires by the close date
 * the feed published for it (`isExpired` reads `expiresAt`), and counting it
 * absent here would expire live roles a night or two after they scrolled off
 * the newest page.
 *
 * Takes a transaction rather than opening one, because both writes are one
 * statement about the Board and the caller may have more to say in the same
 * breath. A Fetch half-applied would have moved some Postings towards expiry
 * without recording that the others were seen.
 */
export async function reconcileBoard(
  tx: Transaction,
  board: Board,
  fetched: SourcePosting[],
): Promise<void> {
  await storePostings(tx, board, fetched);
  if (ADAPTERS[board.source].expiry === "absence") {
    await countAbsences(tx, board, fetched);
  }
}

/**
 * The columns a re-Fetch must not touch: the Posting's identity, and the date
 * the Corpus first met it.
 */
const PRESERVED_ON_REFETCH = new Set([
  "id",
  "source",
  "sourceId",
  "firstSeenAt",
]);

/**
 * What a re-Fetch overwrites, derived from the table rather than listed by
 * hand.
 *
 * A hand-written list is one column-addition away from silently going stale —
 * the new field would be written on insert and then never refreshed, so an
 * edited Posting would keep its first value forever with nothing failing.
 */
const REFRESHED_ON_REFETCH: Record<string, SQL> = Object.fromEntries(
  Object.entries(getTableColumns(postings))
    .filter(([property]) => !PRESERVED_ON_REFETCH.has(property))
    .map(([property, column]) => [property, refreshed(property, column)]),
);

/**
 * What a re-Fetch writes into one column.
 *
 * Two columns are facts about the Fetch rather than about the Posting, so they
 * are written from what just happened instead of from the row being inserted:
 * this Fetch saw the Posting, so it was last seen now, and it has not been
 * absent from any Fetch since — which un-expires a role a company re-listed.
 */
function refreshed(property: string, column: Column): SQL {
  if (property === "lastSeenAt") return sql`now()`;
  if (property === "absentFetches") return sql`0`;
  return sql.raw(`excluded.${column.name}`);
}

/**
 * Upserts Postings on their Source Key, so a Posting already in the Corpus is
 * updated rather than duplicated.
 *
 * Every field the Source publishes is overwritten — a company that edited a
 * description means the old one is wrong — and `last_seen_at` records that
 * this Fetch saw it.
 */
async function storePostings(
  tx: Transaction,
  board: Board,
  fetched: SourcePosting[],
): Promise<void> {
  if (fetched.length === 0) return;

  await tx
    .insert(postings)
    .values(
      fetched.map(({ salary, ...posting }) => ({
        // `...posting` carries `expiresAt` straight through for the aggregator
        // Sources (#15) and omits it for the ATS ones, which leaves the column
        // null — and, since it is not in `PRESERVED_ON_REFETCH`, a re-Fetch
        // refreshes it from the Source like every other published field.
        ...posting,
        boardId: board.id,
        // Approximate identity across Sources (#13), derived here so it is
        // written on first sight and — since `dedup_key` is not in
        // `PRESERVED_ON_REFETCH` — refreshed from `excluded` on every re-Fetch.
        dedupKey: dedupKey(posting),
        // A salary the Source published in a field of its own (#14) lands in
        // the same columns Extraction writes, and `extractPostings` leaves a
        // Posting that already has one alone. Null where the Source published
        // none, which is what leaves the salary to Extraction — and, since
        // these columns are refreshed from `excluded` on a re-Fetch, a company
        // that removed the figure has it removed here too.
        salaryMin: salary ? Math.round(salary.min) : null,
        salaryMax: salary ? Math.round(salary.max) : null,
        salaryPeriod: salary?.period ?? null,
      })),
    )
    .onConflictDoUpdate({
      target: [postings.source, postings.sourceId],
      set: REFRESHED_ON_REFETCH,
    });
}

/**
 * Counts this Fetch against every Posting of the Board it did not return.
 *
 * Absence is all any Source offers — none of them publish a "this job is
 * closed" signal — so a Posting the Board has stopped listing is counted
 * rather than judged, and `isExpired` decides how many misses in a row make a
 * Posting Expired. Nothing here deletes: a Posting a User marked `applied`
 * outlives the listing.
 *
 * Only this Board's Postings are in range. A sweep fetches hundreds of Boards
 * and every Posting is absent from all but one of them.
 */
async function countAbsences(
  tx: Transaction,
  board: Board,
  fetched: SourcePosting[],
): Promise<void> {
  const returned = fetched.map((posting) => posting.sourceId);
  const onThisBoard = eq(postings.boardId, board.id);

  await tx
    .update(postings)
    .set({ absentFetches: sql`${postings.absentFetches} + 1` })
    .where(
      // A Board whose last role was filled returns an empty list, and every
      // Posting on it is absent. Spelling that out rather than leaving it to
      // `notInArray` of nothing keeps the Board this ADR is written about —
      // the one that suddenly returns nothing — from turning on a subtlety.
      returned.length === 0
        ? onThisBoard
        : and(onThisBoard, notInArray(postings.sourceId, returned)),
    );
}
