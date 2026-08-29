ALTER TABLE "postings" ADD COLUMN "salary_min" integer;--> statement-breakpoint
ALTER TABLE "postings" ADD COLUMN "salary_max" integer;--> statement-breakpoint
ALTER TABLE "postings" ADD COLUMN "salary_period" text;--> statement-breakpoint
ALTER TABLE "postings" ADD COLUMN "arrangements" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "postings" ADD COLUMN "extracted_at" timestamp with time zone;