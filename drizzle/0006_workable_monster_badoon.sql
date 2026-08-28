CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" bigint NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "account_issuer_account_id" ON "account" USING btree ("issuer","account_id");--> statement-breakpoint
CREATE INDEX "account_user" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user" ON "session" USING btree ("user_id");