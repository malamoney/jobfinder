ALTER TABLE "criteria" ADD COLUMN "us_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "postings" ADD COLUMN "country" text;