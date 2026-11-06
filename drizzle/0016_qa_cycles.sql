CREATE TABLE "qa_cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"cycle_number" integer NOT NULL,
	"result" text DEFAULT 'pending' NOT NULL,
	"environment_url" text DEFAULT '' NOT NULL,
	"build_ref" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"started_by" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"concluded_by" uuid,
	"concluded_at" timestamp with time zone,
	CONSTRAINT "qa_cycles_task_number_uq" UNIQUE("task_id","cycle_number"),
	CONSTRAINT "qa_cycles_id_task_uq" UNIQUE("id","task_id"),
	CONSTRAINT "qa_cycles_result" CHECK ("qa_cycles"."result" in ('pending', 'pass', 'fail')),
	CONSTRAINT "qa_cycles_concluded" CHECK (("qa_cycles"."result" = 'pending') = ("qa_cycles"."concluded_at" is null)),
	CONSTRAINT "qa_cycles_lengths" CHECK (char_length("qa_cycles"."summary") <= 10000 and char_length("qa_cycles"."environment_url") <= 2000 and char_length("qa_cycles"."build_ref") <= 200)
);
--> statement-breakpoint
ALTER TABLE "status_transitions" ADD COLUMN "qa_action" text;--> statement-breakpoint
ALTER TABLE "attachments" ADD COLUMN "qa_cycle_id" uuid;--> statement-breakpoint
ALTER TABLE "qa_cycles" ADD CONSTRAINT "qa_cycles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_cycles" ADD CONSTRAINT "qa_cycles_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_cycles" ADD CONSTRAINT "qa_cycles_concluded_by_users_id_fk" FOREIGN KEY ("concluded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_cycles" ADD CONSTRAINT "qa_cycles_task_fk" FOREIGN KEY ("task_id","workspace_id") REFERENCES "public"."tasks"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "qa_cycles_workspace_id_concluded_at_index" ON "qa_cycles" USING btree ("workspace_id","concluded_at");--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_qa_cycle_fk" FOREIGN KEY ("qa_cycle_id","task_id") REFERENCES "public"."qa_cycles"("id","task_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "status_transitions" ADD CONSTRAINT "status_transitions_qa_action" CHECK ("status_transitions"."qa_action" is null or "status_transitions"."qa_action" in ('start', 'pass', 'fail'));--> statement-breakpoint
-- A concluded QA round is history: refuse any change to it (retests are new rounds).
CREATE FUNCTION "qa_cycles_lock_concluded"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.result <> 'pending' THEN
    RAISE EXCEPTION 'QA round % is concluded and cannot change', OLD.cycle_number
      USING ERRCODE = 'check_violation', CONSTRAINT = 'qa_cycles_concluded_locked';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER "qa_cycles_lock_concluded" BEFORE UPDATE ON "qa_cycles"
  FOR EACH ROW EXECUTE FUNCTION "qa_cycles_lock_concluded"();--> statement-breakpoint
-- One open round per task.
CREATE UNIQUE INDEX "qa_cycles_one_pending_uq" ON "qa_cycles" ("task_id") WHERE "result" = 'pending';
