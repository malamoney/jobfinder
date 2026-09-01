ALTER TABLE "fetch_runs" ADD COLUMN "non_us_dropped" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "fetch_runs" ADD COLUMN "non_us_pruned" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "criteria" DROP COLUMN "us_only";