CREATE TABLE "import_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source" text NOT NULL,
	"entity_type" text NOT NULL,
	"external_id" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "import_mappings_external_uq" UNIQUE("workspace_id","source","entity_type","external_id")
);
--> statement-breakpoint
ALTER TABLE "import_mappings" ADD CONSTRAINT "import_mappings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_mappings_entity_id_index" ON "import_mappings" USING btree ("entity_id");