ALTER TABLE "task_lists" ADD COLUMN "view_settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "task_lists" ADD COLUMN "view_protected" boolean DEFAULT false NOT NULL;