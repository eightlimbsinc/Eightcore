-- Hand-written: triggers, invariants, and privileges Drizzle can't express.

-- 1. updated_at maintenance -----------------------------------------------------------------
CREATE OR REPLACE FUNCTION eightcore_set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','auth_sessions','auth_accounts','auth_verifications',
                           'workspaces','workspace_members','projects']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION eightcore_set_updated_at()',
                   t || '_set_updated_at', t);
  END LOOP;
END;
$$;
--> statement-breakpoint

-- 2. Every live workspace keeps at least one active owner ----------------------------------
-- Deferred so ownership can be transferred inside one transaction.
CREATE OR REPLACE FUNCTION eightcore_assert_workspace_has_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.role = 'owner' AND OLD.status = 'active'
     AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = OLD.workspace_id)
     AND NOT EXISTS (
       SELECT 1 FROM workspace_members m
       WHERE m.workspace_id = OLD.workspace_id AND m.role = 'owner' AND m.status = 'active'
     )
  THEN
    RAISE EXCEPTION 'workspace % must keep at least one active owner', OLD.workspace_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'workspace_members_owner_required';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER workspace_members_owner_required
  AFTER UPDATE OR DELETE ON workspace_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION eightcore_assert_workspace_has_owner();
--> statement-breakpoint

-- 3. Append-only history tables -------------------------------------------------------------
-- The app role may insert and read, never rewrite history. (FK cascades from a deleted
-- workspace still work: they run with the table owner's rights.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eightcore_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON activity_events, audit_log FROM eightcore_app;
  END IF;
END;
$$;
