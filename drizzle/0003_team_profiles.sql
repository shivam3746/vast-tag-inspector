CREATE TYPE "vast_inspector"."team_role" AS ENUM('admin', 'ad_ops', 'viewer');--> statement-breakpoint
CREATE TABLE "vast_inspector"."profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"team_id" uuid NOT NULL,
	"role" "vast_inspector"."team_role" DEFAULT 'viewer' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vast_inspector"."profiles" ADD CONSTRAINT "profiles_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "vast_inspector"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "profiles_team" ON "vast_inspector"."profiles" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "inspections_pending_age" ON "vast_inspector"."inspections" USING btree ("created_at") WHERE "vast_inspector"."inspections"."status" in ('queued', 'running');