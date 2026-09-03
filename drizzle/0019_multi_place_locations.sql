ALTER TABLE "postings" ADD COLUMN "normalized_locations" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
-- Carry every Posting's existing key across as a one-place list, so the Corpus
-- reads exactly as it did the moment this migration lands (#113). It is not the
-- split: a key like `san francisco bay area, ca / seattle, wa` was normalized as
-- one string, and splitting it back apart is a job for the normalizer rather
-- than for SQL. `renormalizeLocations` does that from the location text the
-- Corpus already holds: the nightly sweep runs it, and `pnpm warm-geocodes`
-- runs it before filling the cache, so a hand-run catch-up geocodes the places
-- the Corpus will be measured on. A Posting a Fetch still returns re-derives
-- its places anyway, since a re-Fetch clears the derived fields.
UPDATE "postings" SET "normalized_locations" = ARRAY["normalized_location"] WHERE "normalized_location" IS NOT NULL;
