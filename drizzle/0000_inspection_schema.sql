CREATE SCHEMA "vast_inspector";
--> statement-breakpoint
CREATE TYPE "vast_inspector"."hop_kind" AS ENUM('wrapper', 'inline', 'empty', 'error');--> statement-breakpoint
CREATE TYPE "vast_inspector"."finding_severity" AS ENUM('info', 'warning', 'error');--> statement-breakpoint
CREATE TYPE "vast_inspector"."source_type" AS ENUM('url', 'xml');--> statement-breakpoint
CREATE TYPE "vast_inspector"."inspection_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "vast_inspector"."findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"hop_id" uuid,
	"idx" integer NOT NULL,
	"rule_id" text NOT NULL,
	"severity" "vast_inspector"."finding_severity" NOT NULL,
	"message" text NOT NULL,
	CONSTRAINT "findings_inspection_id_idx_unique" UNIQUE("inspection_id","idx")
);
--> statement-breakpoint
CREATE TABLE "vast_inspector"."hops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"inspection_id" uuid NOT NULL,
	"idx" integer NOT NULL,
	"http_status" integer,
	"latency_ms" integer NOT NULL,
	"kind" "vast_inspector"."hop_kind" NOT NULL,
	"vast_version" text,
	"error_code" text,
	CONSTRAINT "hops_inspection_id_idx_unique" UNIQUE("inspection_id","idx")
);
--> statement-breakpoint
CREATE TABLE "vast_inspector"."inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"created_by" uuid,
	"source_type" "vast_inspector"."source_type" NOT NULL,
	"source_ref" text NOT NULL,
	"status" "vast_inspector"."inspection_status" DEFAULT 'queued' NOT NULL,
	"error_code" text,
	"hop_count" integer DEFAULT 0 NOT NULL,
	"total_latency_ms" integer DEFAULT 0 NOT NULL,
	"max_severity" text DEFAULT 'none',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vast_inspector"."teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vast_inspector"."findings" ADD CONSTRAINT "findings_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "vast_inspector"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vast_inspector"."findings" ADD CONSTRAINT "findings_hop_id_hops_id_fk" FOREIGN KEY ("hop_id") REFERENCES "vast_inspector"."hops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vast_inspector"."hops" ADD CONSTRAINT "hops_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "vast_inspector"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vast_inspector"."inspections" ADD CONSTRAINT "inspections_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "vast_inspector"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inspections_team_history" ON "vast_inspector"."inspections" USING btree ("team_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);