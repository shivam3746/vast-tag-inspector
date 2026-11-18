CREATE TABLE "vast_inspector"."explanations" (
	"inspection_id" uuid PRIMARY KEY NOT NULL,
	"cache_key" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"output" jsonb NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" double precision,
	"latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vast_inspector"."explanations" ADD CONSTRAINT "explanations_inspection_id_inspections_id_fk" FOREIGN KEY ("inspection_id") REFERENCES "vast_inspector"."inspections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "explanations_cache_key" ON "vast_inspector"."explanations" USING btree ("cache_key");