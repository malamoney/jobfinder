ALTER TABLE "postings" ADD COLUMN "dedup_key" text;--> statement-breakpoint
-- Backfill a transitional Dedup Key for Postings already in the Corpus so the
-- column can be made NOT NULL. A close approximation of `dedupKey` in
-- `@/postings/dedup-key`: company and title lowercased and stripped of
-- punctuation, a trailing company legal form removed, joined by U+001F, with
-- the geocode-normalized location. It does not decompose accents. Every live
-- Posting's key is rewritten exactly on the next Fetch of its Board, which
-- refreshes the derived columns.
UPDATE "postings" SET "dedup_key" =
  regexp_replace(
    trim(both ' ' from regexp_replace(lower("company"), '[^a-z0-9]+', ' ', 'g')),
    ' (inc|incorporated|llc|ltd|limited|corp|corporation|co|company|gmbh|plc|llp)$', '')
  || chr(31) ||
  trim(both ' ' from regexp_replace(lower("title"), '[^a-z0-9]+', ' ', 'g'))
  || chr(31) ||
  coalesce("normalized_location", '');--> statement-breakpoint
ALTER TABLE "postings" ALTER COLUMN "dedup_key" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "postings_dedup_key" ON "postings" USING btree ("dedup_key");