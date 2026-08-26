import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

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

    // Where this Posting came from. Not part of the Source Key — a Source's
    // identifiers are unique across the whole Source, not per Board — but a
    // Posting whose Board is unknown could not be traced back to what
    // published it.
    boardSlug: text("board_slug").notNull(),

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
  ],
);

/** A Posting as stored in the Corpus. */
export type Posting = typeof postings.$inferSelect;
