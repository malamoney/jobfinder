import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The Sources Postings can be fetched from.
 *
 * A TypeScript union over a `text` column rather than a Postgres enum: adding
 * a Source (#14, #15, #16) should be a code change, and a Source Key already
 * in the Corpus should not become unreadable if a name is ever retired.
 */
export type SourceName = "greenhouse";

/**
 * The Corpus: every Posting fetched from every Source, shared by all Users.
 *
 * Holds only what a Source published or what Extraction derived from it — a
 * User's opinion of a Posting lives in Review State (#10), so a re-Fetch can
 * overwrite every column here without touching anything a User wrote.
 */
export const postings = pgTable(
  "postings",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // The Source Key: the Source paired with that Source's own identifier.
    // Unique, so re-fetching a known Posting updates it rather than inserting
    // a duplicate.
    source: text("source").$type<SourceName>().notNull(),
    sourceId: text("source_id").notNull(),

    // Which Board published this Posting. Not part of the Source Key — a
    // Source's identifiers are unique across the whole Source, not per Board —
    // but #7 expires Postings a Board stopped returning, and a Posting whose
    // Board is unknown could not be expired, or traced back to what published
    // it. A reference rather than a copy of the Slug, so a Posting cannot come
    // to name a Board that does not exist.
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id),

    company: text("company").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    // Free text as the Source wrote it; geocoding it is #12's problem.
    location: text("location"),
    applyUrl: text("apply_url").notNull(),
    // Null where the Source published no date, which is not the same as the
    // epoch and must not be sorted as though it were.
    postedAt: timestamp("posted_at", { withTimezone: true }),

    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Bumped by every successful Fetch that returned this Posting. Absence
    // across successive Fetches is what #7 reads as expiry.
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("postings_source_key").on(table.source, table.sourceId),
    // Postgres indexes the target of a foreign key, never the column holding
    // it. #7 reads the Corpus a Board at a time, so this is the index that
    // query needs.
    index("postings_board").on(table.boardId),
  ],
);

/** A Posting as stored in the Corpus. */
export type Posting = typeof postings.$inferSelect;

/**
 * The curated set of Boards a Fetch sweeps.
 *
 * Curation rather than harvesting is a cost decision recorded in ADR 0003;
 * seeding this table and the discovery script that feeds it are #18's. A Board
 * is disabled rather than deleted when it dies, so its Slug is not rediscovered
 * and re-added by the next discovery run.
 *
 * A Board's last fetch outcome is deliberately not a column here, though #2's
 * schema sketch lists one: every Fetch Task already records it, and a copy on
 * the Board would be a second thing to keep true. What #17 needs — when a Board
 * last failed and why — is that Board's newest Task, one join away.
 */
export const boards = pgTable(
  "boards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").$type<SourceName>().notNull(),
    slug: text("slug").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("boards_source_slug").on(table.source, table.slug)],
);

/**
 * One Fetch as a record: a sweep of the Boards, kept so it can be reported on.
 *
 * `finished_at` is null until every task the run enqueued has stopped being
 * workable — a run outlives any single function invocation, so "finished" is a
 * fact about the queue rather than about whoever wrote the row.
 */
export const fetchRuns = pgTable("fetch_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  startedAt: timestamp("started_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

/** A Fetch run as stored. */
export type FetchRun = typeof fetchRuns.$inferSelect;

/**
 * Where one Board's fetch sits within a run.
 *
 * `pending` is workable, `claimed` is being worked on by an invocation that has
 * not reported back, and the two terminal states are what ADR 0004 rests on:
 * only `succeeded` is evidence that a Posting the Board did not return is gone.
 */
export const FETCH_TASK_STATUSES = [
  "pending",
  "claimed",
  "succeeded",
  "failed",
] as const;

export type FetchTaskStatus = (typeof FETCH_TASK_STATUSES)[number];

/**
 * The queue: one task per enabled Board per run.
 *
 * The queue exists so a sweep of hundreds of Boards is not bounded by how long
 * one serverless invocation may run. A Worker claims what it can finish and
 * leaves the rest, and a Worker that dies mid-batch leaves its tasks claimed
 * until the claim goes stale and another invocation reclaims them.
 *
 * `claimed_by` is the identity of the invocation holding the Claim. A Worker
 * writes an outcome only for tasks it still holds, so an invocation presumed
 * dead and then resurrected cannot overwrite the outcome of whoever reclaimed
 * its work.
 */
export const fetchTasks = pgTable(
  "fetch_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => fetchRuns.id, { onDelete: "cascade" }),
    boardId: uuid("board_id")
      .notNull()
      .references(() => boards.id, { onDelete: "cascade" }),

    status: text("status")
      .$type<FetchTaskStatus>()
      .notNull()
      .default("pending"),
    // What the queue is ordered by, so the oldest unfinished work is taken
    // first and a run interrupted last night is drained before tonight's.
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Counts claims rather than failures: a task reclaimed after a crash has
    // been attempted twice, whether or not the first attempt reported anything.
    attempts: integer("attempts").notNull().default(0),

    claimedBy: uuid("claimed_by"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),

    // Why the Board's fetch failed, in the adapter's own words. Null on every
    // other status; #17 lists these so a dead Board can be found and disabled.
    error: text("error"),
  },
  (table) => [
    uniqueIndex("fetch_tasks_run_board").on(table.runId, table.boardId),
    // The claim query: workable tasks, oldest first.
    index("fetch_tasks_workable").on(table.status, table.createdAt),
  ],
);

/** A queued Board fetch as stored. */
export type FetchTask = typeof fetchTasks.$inferSelect;
