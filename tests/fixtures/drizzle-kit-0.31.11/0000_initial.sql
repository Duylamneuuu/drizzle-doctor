CREATE TYPE "public"."account_state" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"state" "account_state" DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"account_id" integer NOT NULL,
	"body" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entries" ADD CONSTRAINT "entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entries_account_idx" ON "entries" USING btree ("account_id");