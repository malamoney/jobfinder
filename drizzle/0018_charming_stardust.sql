CREATE TABLE "commute_drives" (
	"origin" text NOT NULL,
	"destination" text NOT NULL,
	"morning_seconds" integer,
	"morning_leave_minutes" integer,
	"evening_seconds" integer,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commute_drives_origin_destination_pk" PRIMARY KEY("origin","destination")
);
