CREATE TABLE "criteria" (
	"user_id" text PRIMARY KEY NOT NULL,
	"titles" text[] DEFAULT '{}' NOT NULL,
	"keywords" text[] DEFAULT '{}' NOT NULL,
	"arrangements" text[] DEFAULT '{}' NOT NULL,
	"home_location" text,
	"radius_miles" integer,
	"min_salary" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "criteria" ADD CONSTRAINT "criteria_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;