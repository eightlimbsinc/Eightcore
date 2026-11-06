CREATE TABLE "status_transitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"from_status_id" uuid,
	"to_status_id" uuid NOT NULL,
	"min_role" text DEFAULT 'editor' NOT NULL,
	"require_comment" boolean DEFAULT false NOT NULL,
	"required_field_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "status_transitions_pair_uq" UNIQUE NULLS NOT DISTINCT("list_id","from_status_id","to_status_id"),
	CONSTRAINT "status_transitions_min_role" CHECK ("status_transitions"."min_role" in ('editor', 'manager'))
);
--> statement-breakpoint
ALTER TABLE "task_lists" ADD COLUMN "transitions_strict" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "status_transitions" ADD CONSTRAINT "status_transitions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_transitions" ADD CONSTRAINT "status_transitions_list_fk" FOREIGN KEY ("list_id","workspace_id") REFERENCES "public"."task_lists"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_transitions" ADD CONSTRAINT "status_transitions_from_fk" FOREIGN KEY ("from_status_id","list_id") REFERENCES "public"."list_statuses"("id","list_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_transitions" ADD CONSTRAINT "status_transitions_to_fk" FOREIGN KEY ("to_status_id","list_id") REFERENCES "public"."list_statuses"("id","list_id") ON DELETE cascade ON UPDATE no action;