-- Hand-written: rules for dependencies and custom fields that Drizzle can't express.

-- 1. Fractional-index positions compare byte-wise.
ALTER TABLE custom_fields ALTER COLUMN position TYPE text COLLATE "C";
--> statement-breakpoint
ALTER TABLE custom_field_options ALTER COLUMN position TYPE text COLLATE "C";
--> statement-breakpoint

-- 2. updated_at maintenance.
CREATE TRIGGER custom_fields_set_updated_at BEFORE UPDATE ON custom_fields
  FOR EACH ROW EXECUTE FUNCTION eightcore_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER task_field_values_set_updated_at BEFORE UPDATE ON task_field_values
  FOR EACH ROW EXECUTE FUNCTION eightcore_set_updated_at();
--> statement-breakpoint

-- 3. Dependencies never form a loop (A blocks B blocks ... blocks A).
-- The service serialises dependency changes per workspace (advisory lock); this is the backstop.
CREATE OR REPLACE FUNCTION eightcore_check_dependency_cycle() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Follow "blocks" links onward from the blocked task; reaching the blocking task means a loop.
  IF EXISTS (
    WITH RECURSIVE downstream(task_id) AS (
      SELECT NEW.blocked_task_id
      UNION
      SELECT d.blocked_task_id
        FROM task_dependencies d JOIN downstream s ON d.blocking_task_id = s.task_id
    )
    SELECT 1 FROM downstream WHERE task_id = NEW.blocking_task_id
  ) THEN
    RAISE EXCEPTION 'task dependencies cannot form a loop'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'task_dependencies_no_cycles';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER task_dependencies_no_cycles BEFORE INSERT OR UPDATE ON task_dependencies
  FOR EACH ROW EXECUTE FUNCTION eightcore_check_dependency_cycle();
