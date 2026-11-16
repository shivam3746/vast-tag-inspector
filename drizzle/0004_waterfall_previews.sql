ALTER TABLE "vast_inspector"."hops" ADD COLUMN "url_origin" text;--> statement-breakpoint
ALTER TABLE "vast_inspector"."hops" ADD COLUMN "xml_preview" text;--> statement-breakpoint
ALTER TABLE "vast_inspector"."hops" ADD CONSTRAINT "hops_xml_preview_size" CHECK (octet_length("vast_inspector"."hops"."xml_preview") <= 16384);