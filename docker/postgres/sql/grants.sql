-- Run inside each Eightcore database (dev, test) as a superuser or the database owner.
ALTER SCHEMA public OWNER TO eightcore_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO eightcore_app;

-- Every table and sequence the migrator creates is usable (DML only) by the app role.
-- Append-only tables have UPDATE/DELETE revoked again in their migration.
ALTER DEFAULT PRIVILEGES FOR ROLE eightcore_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eightcore_app;
ALTER DEFAULT PRIVILEGES FOR ROLE eightcore_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO eightcore_app;
ALTER DEFAULT PRIVILEGES FOR ROLE eightcore_migrator IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO eightcore_app;
