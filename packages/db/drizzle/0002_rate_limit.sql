CREATE TABLE "rate_limit" (
	"key" text PRIMARY KEY NOT NULL,
	"hits" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "rate_limit_reset_idx" ON "rate_limit" USING btree ("reset_at");