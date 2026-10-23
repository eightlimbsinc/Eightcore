CREATE TYPE "public"."status_category" AS ENUM('backlog', 'unstarted', 'active', 'review', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('urgent', 'high', 'normal', 'low', 'none');--> statement-breakpoint
CREATE TABLE "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "folders_id_project_uq" UNIQUE("id","project_id"),
	CONSTRAINT "folders_name_length" CHECK (char_length("folders"."name") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "list_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"name" text NOT NULL,
	"category" "status_category" NOT NULL,
	"color" text NOT NULL,
	"position" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "list_statuses_id_list_uq" UNIQUE("id","list_id"),
	CONSTRAINT "list_statuses_name_length" CHECK (char_length("list_statuses"."name") between 1 and 40),
	CONSTRAINT "list_statuses_color_format" CHECK ("list_statuses"."color" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
CREATE TABLE "task_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"folder_id" uuid,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"position" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "task_lists_id_workspace_uq" UNIQUE("id","workspace_id"),
	CONSTRAINT "task_lists_id_project_uq" UNIQUE("id","project_id"),
	CONSTRAINT "task_lists_name_length" CHECK (char_length("task_lists"."name") between 1 and 120)
);
--> statement-breakpoint
CREATE TABLE "task_assignees" (
	"workspace_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"assigned_by" uuid,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_assignees_task_id_user_id_pk" PRIMARY KEY("task_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"list_id" uuid NOT NULL,
	"status_id" uuid NOT NULL,
	"parent_task_id" uuid,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"priority" "task_priority" DEFAULT 'none' NOT NULL,
	"start_date" date,
	"due_date" date,
	"position" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" uuid NOT NULL,
	"completed_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_id_workspace_uq" UNIQUE("id","workspace_id"),
	CONSTRAINT "tasks_id_list_uq" UNIQUE("id","list_id"),
	CONSTRAINT "tasks_project_number_uq" UNIQUE("project_id","number"),
	CONSTRAINT "tasks_not_own_parent" CHECK ("tasks"."parent_task_id" <> "tasks"."id"),
	CONSTRAINT "tasks_title_length" CHECK (char_length("tasks"."title") between 1 and 500),
	CONSTRAINT "tasks_dates_order" CHECK ("tasks"."start_date" is null or "tasks"."due_date" is null or "tasks"."start_date" <= "tasks"."due_date")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "next_task_number" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "folders" ADD CONSTRAINT "folders_project_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_statuses" ADD CONSTRAINT "list_statuses_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "list_statuses" ADD CONSTRAINT "list_statuses_list_fk" FOREIGN KEY ("list_id","workspace_id") REFERENCES "public"."task_lists"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_lists" ADD CONSTRAINT "task_lists_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_lists" ADD CONSTRAINT "task_lists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_lists" ADD CONSTRAINT "task_lists_project_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_lists" ADD CONSTRAINT "task_lists_folder_fk" FOREIGN KEY ("folder_id","project_id") REFERENCES "public"."folders"("id","project_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_task_fk" FOREIGN KEY ("task_id","workspace_id") REFERENCES "public"."tasks"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_member_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_list_fk" FOREIGN KEY ("list_id","workspace_id") REFERENCES "public"."task_lists"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_list_project_fk" FOREIGN KEY ("list_id","project_id") REFERENCES "public"."task_lists"("id","project_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_fk" FOREIGN KEY ("status_id","list_id") REFERENCES "public"."list_statuses"("id","list_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_fk" FOREIGN KEY ("parent_task_id","list_id") REFERENCES "public"."tasks"("id","list_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "folders_project_id_position_index" ON "folders" USING btree ("project_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "list_statuses_list_name_uq" ON "list_statuses" USING btree ("list_id",lower("name"));--> statement-breakpoint
CREATE INDEX "task_lists_project_id_folder_id_position_index" ON "task_lists" USING btree ("project_id","folder_id","position");--> statement-breakpoint
CREATE INDEX "task_assignees_user_id_workspace_id_index" ON "task_assignees" USING btree ("user_id","workspace_id");--> statement-breakpoint
CREATE INDEX "tasks_list_id_parent_task_id_position_index" ON "tasks" USING btree ("list_id","parent_task_id","position");--> statement-breakpoint
CREATE INDEX "tasks_workspace_id_due_date_index" ON "tasks" USING btree ("workspace_id","due_date");--> statement-breakpoint
CREATE INDEX "tasks_parent_task_id_index" ON "tasks" USING btree ("parent_task_id");