CREATE TABLE "geocodes" (
	"location" text PRIMARY KEY NOT NULL,
	"latitude" double precision,
	"longitude" double precision
);
--> statement-breakpoint
ALTER TABLE "postings" ADD COLUMN "normalized_location" text;--> statement-breakpoint
CREATE INDEX "postings_normalized_location" ON "postings" USING btree ("normalized_location");