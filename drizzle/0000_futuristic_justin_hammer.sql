CREATE TABLE "postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"board_slug" text NOT NULL,
	"company" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"location" text,
	"apply_url" text NOT NULL,
	"posted_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "postings_source_key" ON "postings" USING btree ("source","source_id");