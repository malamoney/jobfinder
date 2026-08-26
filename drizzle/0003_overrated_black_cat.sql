-- Every Board a Posting was fetched from belongs in the curated set: it was
-- already being swept, it just predates there being a table to record it in.
INSERT INTO "boards" ("source", "slug")
SELECT DISTINCT "source", "board_slug" FROM "postings"
ON CONFLICT ("source", "slug") DO NOTHING;
--> statement-breakpoint
UPDATE "postings" SET "board_id" = "boards"."id"
FROM "boards"
WHERE "boards"."source" = "postings"."source"
  AND "boards"."slug" = "postings"."board_slug";
--> statement-breakpoint
ALTER TABLE "postings" ALTER COLUMN "board_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "postings" DROP COLUMN "board_slug";
