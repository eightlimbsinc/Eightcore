CREATE TYPE "public"."custom_field_type" AS ENUM('text', 'number', 'date', 'dropdown', 'checkbox', 'person', 'url');--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"workspace_id" uuid NOT NULL,
	"blocking_task_id" uuid NOT NULL,
	"blocked_task_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_dependencies_blocking_task_id_blocked_task_id_pk" PRIMARY KEY("blocking_task_id","blocked_task_id"),
	CONSTRAINT "task_dependencies_not_self" CHECK ("task_dependencies"."blocking_task_id" <> "task_dependencies"."blocked_task_id")
);
--> statement-breakpoint
CREATE TABLE "custom_field_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"label" text NOT NULL,
	"color" text NOT NULL,
	"position" text NOT NULL,
	CONSTRAINT "custom_field_options_id_field_uq" UNIQUE("id","field_id"),
	CONSTRAINT "custom_field_options_label_length" CHECK (char_length("custom_field_options"."label") between 1 and 60),
	CONSTRAINT "custom_field_options_color_format" CHECK ("custom_field_options"."color" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
CREATE TABLE "custom_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"list_id" uuid,
	"name" text NOT NULL,
	"type" "custom_field_type" NOT NULL,
	"position" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "custom_fields_id_project_uq" UNIQUE("id","project_id"),
	CONSTRAINT "custom_fields_name_length" CHECK (char_length("custom_fields"."name") between 1 and 60)
);
--> statement-breakpoint
CREATE TABLE "task_field_values" (
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"field_id" uuid NOT NULL,
	"value_text" text,
	"value_number" numeric,
	"value_date" date,
	"value_bool" boolean,
	"value_option_id" uuid,
	"value_user_id" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_field_values_task_id_field_id_pk" PRIMARY KEY("task_id","field_id"),
	CONSTRAINT "task_field_values_one_value" CHECK (num_nonnulls("task_field_values"."value_text", "task_field_values"."value_number", "task_field_values"."value_date", "task_field_values"."value_bool", "task_field_values"."value_option_id", "task_field_values"."value_user_id") = 1),
	CONSTRAINT "task_field_values_text_length" CHECK (char_length("task_field_values"."value_text") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_blocking_fk" FOREIGN KEY ("blocking_task_id","workspace_id") REFERENCES "public"."tasks"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_blocked_fk" FOREIGN KEY ("blocked_task_id","workspace_id") REFERENCES "public"."tasks"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_options" ADD CONSTRAINT "custom_field_options_field_id_custom_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."custom_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_project_fk" FOREIGN KEY ("project_id","workspace_id") REFERENCES "public"."projects"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_list_fk" FOREIGN KEY ("list_id","project_id") REFERENCES "public"."task_lists"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_field_values" ADD CONSTRAINT "task_field_values_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_field_values" ADD CONSTRAINT "task_field_values_task_fk" FOREIGN KEY ("task_id","project_id") REFERENCES "public"."tasks"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_field_values" ADD CONSTRAINT "task_field_values_field_fk" FOREIGN KEY ("field_id","project_id") REFERENCES "public"."custom_fields"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_field_values" ADD CONSTRAINT "task_field_values_option_fk" FOREIGN KEY ("value_option_id","field_id") REFERENCES "public"."custom_field_options"("id","field_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_field_values" ADD CONSTRAINT "task_field_values_member_fk" FOREIGN KEY ("workspace_id","value_user_id") REFERENCES "public"."workspace_members"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_dependencies_blocked_task_id_index" ON "task_dependencies" USING btree ("blocked_task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "custom_field_options_field_label_uq" ON "custom_field_options" USING btree ("field_id",lower("label"));--> statement-breakpoint
CREATE UNIQUE INDEX "custom_fields_project_name_uq" ON "custom_fields" USING btree ("project_id",lower("name"));--> statement-breakpoint
CREATE INDEX "custom_fields_project_id_position_index" ON "custom_fields" USING btree ("project_id","position");--> statement-breakpoint
CREATE INDEX "task_field_values_field_id_index" ON "task_field_values" USING btree ("field_id");