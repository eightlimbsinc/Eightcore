CREATE TABLE "docs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"list_id" uuid,
	"parent_id" uuid,
	"title" text DEFAULT '' NOT NULL,
	"content" jsonb DEFAULT '{"type":"doc","content":[]}'::jsonb NOT NULL,
	"plain_text" text DEFAULT '' NOT NULL,
	"position" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "docs_title_length" CHECK (char_length("docs"."title") <= 200),
	CONSTRAINT "docs_text_length" CHECK (char_length("docs"."plain_text") <= 200000)
);
--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_list_id_task_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."task_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_parent_id_docs_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."docs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docs" ADD CONSTRAINT "docs_project_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "docs_project_id_parent_id_position_index" ON "docs" USING btree ("project_id","parent_id","position");--> statement-breakpoint
CREATE INDEX "docs_list_id_index" ON "docs" USING btree ("list_id");--> statement-breakpoint
-- A doc's list and parent doc must be in the doc's own project.
CREATE FUNCTION docs_same_project() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.list_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM task_lists WHERE id = NEW.list_id AND project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'doc list must be in the same project' USING ERRCODE = '23514', CONSTRAINT = 'docs_same_project';
  END IF;
  IF NEW.parent_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM docs WHERE id = NEW.parent_id AND project_id = NEW.project_id) THEN
    RAISE EXCEPTION 'parent doc must be in the same project' USING ERRCODE = '23514', CONSTRAINT = 'docs_same_project';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER docs_same_project BEFORE INSERT OR UPDATE OF list_id, parent_id, project_id ON docs
  FOR EACH ROW EXECUTE FUNCTION docs_same_project();
