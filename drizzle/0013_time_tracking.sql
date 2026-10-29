CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_duration" CHECK ("time_entries"."duration_seconds" between 0 and 86400 * 7),
	CONSTRAINT "time_entries_source" CHECK ("time_entries"."source" in ('timer', 'manual')),
	CONSTRAINT "time_entries_note_length" CHECK (char_length("time_entries"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "time_estimate_minutes" integer;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_entries_task_id_index" ON "time_entries" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "time_entries_workspace_id_user_id_started_at_index" ON "time_entries" USING btree ("workspace_id","user_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "time_entries_one_running_uq" ON "time_entries" USING btree ("user_id") WHERE "time_entries"."ended_at" is null;