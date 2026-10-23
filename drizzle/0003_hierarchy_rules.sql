-- Hand-written: rules for lists and tasks that Drizzle can't express.

-- 1. Fractional-index positions compare byte-wise (fractional-indexing), so sort them with "C".
ALTER TABLE folders ALTER COLUMN position TYPE text COLLATE "C";
--> statement-breakpoint
ALTER TABLE task_lists ALTER COLUMN position TYPE text COLLATE "C";
--> statement-breakpoint
ALTER TABLE list_statuses ALTER COLUMN position TYPE text COLLATE "C";
--> statement-breakpoint
ALTER TABLE tasks ALTER COLUMN position TYPE text COLLATE "C";
--> statement-breakpoint

-- 2. Deleting a folder moves its lists to the project root: null only folder_id, not project_id.
ALTER TABLE task_lists DROP CONSTRAINT task_lists_folder_fk;
--> statement-breakpoint
ALTER TABLE task_lists ADD CONSTRAINT task_lists_folder_fk
  FOREIGN KEY (folder_id, project_id) REFERENCES folders (id, project_id) ON DELETE SET NULL (folder_id);
--> statement-breakpoint

-- 3. updated_at maintenance for the new tables.
CREATE TRIGGER folders_set_updated_at BEFORE UPDATE ON folders
  FOR EACH ROW EXECUTE FUNCTION eightcore_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER task_lists_set_updated_at BEFORE UPDATE ON task_lists
  FOR EACH ROW EXECUTE FUNCTION eightcore_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER list_statuses_set_updated_at BEFORE UPDATE ON list_statuses
  FOR EACH ROW EXECUTE FUNCTION eightcore_set_updated_at();
--> statement-breakpoint
CREATE TRIGGER tasks_set_updated_at BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION eightcore_set_updated_at();
--> statement-breakpoint

-- 4. Subtask hierarchy: no cycles, at most 5 levels below a top-level task.
-- The service serialises re-parenting per list (advisory lock); this trigger is the backstop.
CREATE OR REPLACE FUNCTION eightcore_check_task_hierarchy() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  max_depth CONSTANT int := 5;
  ancestor_depth int;
  subtree_height int;
BEGIN
  IF NEW.parent_task_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.parent_task_id IS NOT DISTINCT FROM OLD.parent_task_id THEN
    RETURN NEW;
  END IF;

  -- Walk up from the new parent; finding this task means a cycle.
  WITH RECURSIVE ancestors(id, parent_task_id, depth) AS (
    SELECT t.id, t.parent_task_id, 1 FROM tasks t WHERE t.id = NEW.parent_task_id
    UNION ALL
    SELECT t.id, t.parent_task_id, a.depth + 1
      FROM tasks t JOIN ancestors a ON t.id = a.parent_task_id
     WHERE a.depth <= max_depth + 1
  )
  SELECT max(depth) INTO ancestor_depth FROM ancestors;
  IF EXISTS (
    WITH RECURSIVE ancestors(id, parent_task_id, depth) AS (
      SELECT t.id, t.parent_task_id, 1 FROM tasks t WHERE t.id = NEW.parent_task_id
      UNION ALL
      SELECT t.id, t.parent_task_id, a.depth + 1
        FROM tasks t JOIN ancestors a ON t.id = a.parent_task_id
       WHERE a.depth <= max_depth + 1
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'a task cannot be its own ancestor'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'tasks_no_cycles';
  END IF;

  -- Height of the subtree being moved (0 for a leaf).
  WITH RECURSIVE descendants(id, depth) AS (
    SELECT t.id, 1 FROM tasks t WHERE t.parent_task_id = NEW.id
    UNION ALL
    SELECT t.id, d.depth + 1 FROM tasks t JOIN descendants d ON t.parent_task_id = d.id
     WHERE d.depth <= max_depth
  )
  SELECT coalesce(max(depth), 0) INTO subtree_height FROM descendants;

  IF ancestor_depth + subtree_height > max_depth THEN
    RAISE EXCEPTION 'subtasks can be nested at most % levels deep', max_depth
      USING ERRCODE = 'check_violation', CONSTRAINT = 'tasks_max_depth';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER tasks_check_hierarchy BEFORE INSERT OR UPDATE OF parent_task_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION eightcore_check_task_hierarchy();
