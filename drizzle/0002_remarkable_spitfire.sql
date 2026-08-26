ALTER TABLE "postings" ALTER COLUMN "board_slug" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "postings" ADD COLUMN "board_id" uuid;--> statement-breakpoint
ALTER TABLE "postings" ADD CONSTRAINT "postings_board_id_boards_id_fk" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "postings_board" ON "postings" USING btree ("board_id");