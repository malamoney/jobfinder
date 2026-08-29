CREATE TABLE "matches" (
	"user_id" text NOT NULL,
	"posting_id" uuid NOT NULL,
	"matched_keywords" text[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "matches_user_id_posting_id_pk" PRIMARY KEY("user_id","posting_id")
);
--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_posting_id_postings_id_fk" FOREIGN KEY ("posting_id") REFERENCES "public"."postings"("id") ON DELETE cascade ON UPDATE no action;