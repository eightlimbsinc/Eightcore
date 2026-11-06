CREATE TABLE "task_status_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"from_status_id" uuid,
	"from_name" text,
	"from_category" "status_category",
	"to_status_id" uuid NOT NULL,
	"to_name" text NOT NULL,
	"to_category" "status_category" NOT NULL,
	"actor_id" uuid,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "task_status_changes" ADD CONSTRAINT "task_status_changes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_status_changes" ADD CONSTRAINT "task_status_changes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_status_changes" ADD CONSTRAINT "task_status_changes_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_status_changes_task_id_changed_at_index" ON "task_status_changes" USING btree ("task_id","changed_at");--> statement-breakpoint
CREATE INDEX "task_status_changes_workspace_id_changed_at_index" ON "task_status_changes" USING btree ("workspace_id","changed_at");--> statement-breakpoint
-- Backfill from the activity log: creations and status changes, matched to the task's list
-- statuses by name (names are unique per list, case-insensitive).
INSERT INTO "task_status_changes" ("workspace_id", "task_id", "from_status_id", "from_name", "from_category", "to_status_id", "to_name", "to_category", "actor_id", "changed_at")
SELECT t."workspace_id", t."id", NULL, NULL, NULL, s."id", s."name", s."category", e."actor_id", e."created_at"
  FROM "activity_events" e
  JOIN "tasks" t ON t."id" = e."entity_id"
  JOIN "list_statuses" s ON s."list_id" = t."list_id" AND lower(s."name") = lower(e."metadata"->>'status')
 WHERE e."entity_type" = 'task' AND e."action" = 'created';--> statement-breakpoint
INSERT INTO "task_status_changes" ("workspace_id", "task_id", "from_status_id", "from_name", "from_category", "to_status_id", "to_name", "to_category", "actor_id", "changed_at")
SELECT t."workspace_id", t."id", f."id", e."changes"->'status'->>0, f."category", s."id", s."name", s."category", e."actor_id", e."created_at"
  FROM "activity_events" e
  JOIN "tasks" t ON t."id" = e."entity_id"
  JOIN "list_statuses" s ON s."list_id" = t."list_id" AND lower(s."name") = lower(e."changes"->'status'->>1)
  LEFT JOIN "list_statuses" f ON f."list_id" = t."list_id" AND lower(f."name") = lower(e."changes"->'status'->>0)
 WHERE e."entity_type" = 'task' AND e."action" = 'updated' AND e."changes" ? 'status';--> statement-breakpoint
-- Tasks with no recorded history (e.g. imported): start them in their current status.
INSERT INTO "task_status_changes" ("workspace_id", "task_id", "to_status_id", "to_name", "to_category", "actor_id", "changed_at")
SELECT t."workspace_id", t."id", s."id", s."name", s."category", t."created_by", t."created_at"
  FROM "tasks" t
  JOIN "list_statuses" s ON s."id" = t."status_id"
 WHERE NOT EXISTS (SELECT 1 FROM "task_status_changes" c WHERE c."task_id" = t."id");
