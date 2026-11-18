-- Subtasks may be nested up to 7 levels below a top-level task (as in ClickUp), was 5.
-- Same check as 0003, only the limit changes; the trigger keeps using this function.
CREATE OR REPLACE FUNCTION eightcore_check_task_hierarchy() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  max_depth CONSTANT int := 7;
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
