import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { Arrangement } from "@/criteria/schema";
import type { ReviewStatus } from "@/review/schema";
import { user } from "./auth-schema";

/**
 * better-auth's tables (#4) are part of the same schema, so drizzle-kit
 * migrates them and the query builder can join against them. They live in
 * their own file because their shape is the library's, not ours.
 */
export * from "./auth-schema";

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
    // How many successful Fetches of this Posting's Board in a row did not
    // return it — expiry, counted rather than decided, so what "Expired" means
    // lives in one place (`isExpired`) instead of in the schema.
    //
    // Only a *successful* Fetch may touch this (ADR 0004). A Board that could
    // not be read, or answered with a shape the adapter does not understand,
    // is not evidence about any Posting and must leave this column alone.
    absentFetches: integer("absent_fetches").notNull().default(0),
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
 * Curation rather than harvesting is a cost decision: ADR 0003 records that
 * no Source publishes a directory of Boards, and `docs/research/job-sources.md`
 * measures what harvesting the long tail would cost to sweep. Seeding this
 * table and the discovery script that feeds it are #18's. A Board
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

/**
 * A User's stated Criteria: the one definition of the work they want.
 *
 * The User's id is the whole primary key, so the table holds exactly one row
 * per User. #2 records why: multiple named searches later become a `name`
 * column and a synthetic key — a UI feature over this table rather than a
 * migration of it.
 *
 * Titles and keywords are Postgres arrays rather than child tables. A User
 * edits each as a set and Matching (#9) reads each as a set; per-item rows
 * would buy a join that every Match pays for and nothing else queries.
 *
 * `home_location` and `radius_miles` are null unless the User accepts an
 * onsite or hybrid Arrangement. `@/criteria/schema` is what enforces that
 * pairing, on the client and the server both — the columns only store what it
 * passed. `min_salary` null means no floor, which is not a floor of zero.
 *
 * Deleted with its User: Criteria with no one to own them are nothing.
 */
export const criteria = pgTable("criteria", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),

  titles: text("titles").array().notNull().default([]),
  keywords: text("keywords").array().notNull().default([]),
  arrangements: text("arrangements")
    .array()
    .$type<Arrangement[]>()
    .notNull()
    .default([]),

  homeLocation: text("home_location"),
  radiusMiles: integer("radius_miles"),
  minSalary: integer("min_salary"),

  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/** A User's Criteria as stored. */
export type CriteriaRow = typeof criteria.$inferSelect;

/**
 * A User's Matches: the Postings their Criteria currently select.
 *
 * Derived data, not a record of anything a User did (ADR 0001). Every row here
 * is recomputed from the Corpus and the User's Criteria — Matching discards a
 * User's Matches and rebuilds them on every Criteria save — so nothing a User
 * wrote is ever stored on this table. Their opinion of a Posting lives in
 * Review State (#10), which is keyed the same way and outlives any Match.
 *
 * `matched_keywords` is the subset of the User's keywords that occur in the
 * Posting's title or description, kept so the Dashboard can show why a Posting
 * was surfaced (#35). Empty when a Posting matched on title alone.
 *
 * Keyed by User and Posting together: one verdict per Posting per User. Deleted
 * with either side — a Match with no User to see it, or no Posting to point at,
 * is nothing. There is no timestamp: a Match is rebuilt wholesale on every
 * Criteria save, so "when was this matched" is only ever "at the last save".
 */
export const matches = pgTable(
  "matches",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    postingId: uuid("posting_id")
      .notNull()
      .references(() => postings.id, { onDelete: "cascade" }),

    matchedKeywords: text("matched_keywords")
      .array()
      .notNull()
      .default([]),
  },
  (table) => [
    // The Dashboard reads every Match for one User, and #10 joins Review State
    // onto these same rows; the primary key's leading column serves that read.
    primaryKey({ columns: [table.userId, table.postingId] }),
  ],
);

/** A User's Match as stored. */
export type MatchRow = typeof matches.$inferSelect;

/**
 * A User's Review State: their own standing relationship to a Posting.
 *
 * Owned by the User and never recomputed or overwritten by a Source — this is
 * the one table a Fetch does not touch. A re-Fetch rewrites the Corpus columns
 * on `postings`; an expiry bumps `absent_fetches`; neither reaches here, so a
 * role a User marked `applied` keeps that Status after the listing comes down
 * (CONTEXT.md, "Review State"; #2, required coverage).
 *
 * A row exists only once a User has acted on a Posting. No row means Status
 * `new` and no Notes — the state every Posting starts in — so nothing has to be
 * back-filled when Matching surfaces a Posting for the first time.
 *
 * `status` is a single column, not a set of booleans: a Posting sits in exactly
 * one place in the pipeline at a time, and overlapping flags could say
 * otherwise. `applied_at` is the last time `status` became `applied`, kept so a
 * User can see how long they have been waiting to hear back (#2, user story 42);
 * it is not cleared when they move the Status away again.
 */
export const reviewState = pgTable(
  "review_state",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    postingId: uuid("posting_id")
      .notNull()
      .references(() => postings.id, { onDelete: "cascade" }),

    status: text("status")
      .$type<ReviewStatus>()
      .notNull()
      .default("new"),
    notes: text("notes").notNull().default(""),

    // When `status` was last moved off `new`, and when it last became
    // `applied`. Both null until the thing they date has happened — a row that
    // exists only because a note was written has a `new` Status that was never
    // "changed".
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    appliedAt: timestamp("applied_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.postingId] }),
  ],
);

/** A User's Review State for one Posting, as stored. */
export type ReviewStateRow = typeof reviewState.$inferSelect;
