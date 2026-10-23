// One-time setup of a Supabase (or any hosted) Postgres for Eightcore.
//
//   SUPABASE_ADMIN_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
//   DATABASE_SSL_CA_FILE=./prod-ca-2021.crt \
//   npm run db:supabase:setup
//
// 1. Creates two login roles with fresh random passwords (re-running rotates them):
//      <prefix>_migrator  owns the schema, runs migrations (DDL)
//      <prefix>_app       data access only; what the deployed app uses
// 2. Applies all migrations as the migrator.
// 3. Verifies Supabase's API roles (anon, authenticated) can't touch any Eightcore table,
//    row-level security won't hide rows from the app, and the app role can't change the schema.
// 4. Writes the connection settings to a git-ignored env file. Passwords are never printed.
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";
import { poolConfig } from "../../src/server/db/connection";
import { scriptConnectionOptions } from "./connection-env";
import { isMainModule, loadEnvFiles } from "../load-env";
import { runMigrations } from "./migrate";

const SUPABASE_API_ROLES = ["anon", "authenticated"];
const DML = "SELECT,INSERT,UPDATE,DELETE";

export interface SetupResult {
  appUrl: string;
  migratorUrl: string;
  tables: number;
  warnings: string[];
}

function password(): string {
  return randomBytes(32).toString("base64url"); // [A-Za-z0-9_-] only: safe in SQL literals and URLs
}

function ident(name: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) throw new Error(`Unsafe identifier: ${name}`);
  return `"${name}"`;
}

async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client(poolConfig(url, scriptConnectionOptions()));
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

export async function setupDatabase(adminUrl: string, prefix = "eightcore"): Promise<SetupResult> {
  const admin = new URL(adminUrl);
  const isSupabasePooler = admin.hostname.endsWith(".pooler.supabase.com");
  // Supabase's pooler identifies the project through the username: "<role>.<project-ref>".
  const projectRef = isSupabasePooler ? admin.username.split(".")[1] : undefined;
  if (isSupabasePooler && !projectRef) {
    throw new Error(
      'Expected a pooler username like "postgres.<project-ref>". Copy the Session pooler string.',
    );
  }
  const database = decodeURIComponent(admin.pathname.slice(1)) || "postgres";
  const migratorRole = `${prefix}_migrator`;
  const appRole = `${prefix}_app`;
  const passwords = { [migratorRole]: password(), [appRole]: password() };

  const urlFor = (role: string, port?: string) => {
    const u = new URL(adminUrl);
    u.username = projectRef ? `${role}.${projectRef}` : role;
    u.password = passwords[role]!;
    if (port) u.port = port;
    return u.toString();
  };
  // Supabase: the app uses the transaction pooler (6543), which suits short-lived serverless
  // functions; migrations use the session pooler (5432).
  const migratorUrl = urlFor(migratorRole);
  const appUrl = urlFor(appRole, isSupabasePooler ? "6543" : undefined);

  console.log(`Connecting as admin to ${admin.hostname}...`);
  const apiRoles = await withClient(adminUrl, async (c) => {
    for (const role of [migratorRole, appRole]) {
      const exists = (await c.query("select 1 from pg_roles where rolname = $1", [role])).rowCount;
      // ALTER may only touch the password: restating attributes such as NOSUPERUSER
      // requires superuser rights, which Supabase's admin role doesn't have.
      await c.query(
        exists
          ? `ALTER ROLE ${ident(role)} WITH LOGIN PASSWORD '${passwords[role]}'`
          : `CREATE ROLE ${ident(role)} WITH LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB PASSWORD '${passwords[role]}'`,
      );
      console.log(`${exists ? "Rotated password for" : "Created"} role ${role}`);
    }
    await c.query(`GRANT CONNECT, CREATE ON DATABASE ${ident(database)} TO ${ident(migratorRole)}`);
    await c.query(`GRANT CONNECT ON DATABASE ${ident(database)} TO ${ident(appRole)}`);
    await c.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${ident(migratorRole)}`);
    await c.query(`GRANT USAGE ON SCHEMA public TO ${ident(appRole)}`);
    const { rows } = await c.query<{ rolname: string }>(
      "select rolname from pg_roles where rolname = any($1)",
      [SUPABASE_API_ROLES],
    );
    return rows.map((r) => r.rolname);
  });

  console.log("Setting default privileges and applying migrations...");
  await withClient(migratorUrl, async (c) => {
    const m = ident(migratorRole);
    const a = ident(appRole);
    await c.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${m} IN SCHEMA public GRANT ${DML} ON TABLES TO ${a}`);
    await c.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${m} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${a}`,
    );
    await c.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${m} IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`,
    );
    await c.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${m} IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO ${a}`,
    );
  });
  await runMigrations(migratorUrl);
  await withClient(migratorUrl, async (c) => {
    // History is append-only for the app (mirrors migration 0001, which names the default role).
    await c.query(`REVOKE UPDATE, DELETE, TRUNCATE ON activity_events, audit_log FROM ${ident(appRole)}`);
  });

  console.log("Verifying access controls...");
  const warnings: string[] = [];
  const tables = await withClient(adminUrl, async (c) => {
    const { rows } = await c.query<{ name: string; rls: boolean }>(
      `select c.relname as name, c.relrowsecurity as rls
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and pg_get_userbyid(c.relowner) = $1`,
      [migratorRole],
    );
    if (rows.length === 0) throw new Error("No Eightcore tables found after migrating");
    for (const { name } of rows) {
      for (const role of apiRoles) {
        const { rows: priv } = await c.query<{ ok: boolean }>(
          "select has_table_privilege($1, $2, $3) as ok",
          [role, `public.${name}`, DML],
        );
        if (priv[0]?.ok) throw new Error(`SECURITY: role ${role} has access to public.${name}. Aborting.`);
      }
    }
    const withRls = rows.filter((r) => r.rls).map((r) => r.name);
    if (withRls.length) {
      warnings.push(
        `Row-level security is enabled on ${withRls.join(", ")}, which hides all rows from the app. ` +
          "Turn off 'automatic RLS' in Supabase and re-run this command.",
      );
    }
    return rows.length;
  });

  await withClient(appUrl, async (c) => {
    await c.query("select count(*) from users");
    for (const statement of ["delete from audit_log", "update activity_events set action = action"]) {
      try {
        await c.query(statement);
        throw new Error(`SECURITY: ${appRole} could run "${statement}". Aborting.`);
      } catch (error) {
        if ((error as { code?: string }).code !== "42501") throw error;
      }
    }
    await c.query("begin");
    try {
      await c.query("create table eightcore_privilege_probe (id int)");
      throw new Error(`SECURITY: ${appRole} could create a table. Aborting.`);
    } catch (error) {
      if ((error as { code?: string }).code !== "42501") throw error;
    } finally {
      await c.query("rollback");
    }
  });

  return { appUrl, migratorUrl, tables, warnings };
}

/** Prompts on the terminal; with hidden=true the typed characters aren't echoed. */
function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) {
    const output = rl as unknown as { _writeToOutput: (s: string) => void };
    output._writeToOutput = (s: string) => {
      if (s.startsWith(question)) process.stdout.write(question);
    };
  }
  return new Promise((resolve) =>
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    }),
  );
}

if (isMainModule(import.meta.url)) {
  loadEnvFiles();
  let adminUrl =
    process.env.SUPABASE_ADMIN_URL || (await ask("Paste the Supabase Session pooler connection string: "));
  if (adminUrl.includes("[YOUR-PASSWORD]")) {
    const pw = await ask("Supabase database password (hidden): ", true);
    adminUrl = adminUrl.replace("[YOUR-PASSWORD]", encodeURIComponent(pw));
  }
  if (!/^postgres(ql)?:\/\//.test(adminUrl))
    throw new Error("That doesn't look like a postgresql:// connection string.");
  const caFile = process.env.DATABASE_SSL_CA_FILE;
  if (new URL(adminUrl).hostname.endsWith(".supabase.com") && !caFile) {
    throw new Error(
      "Set DATABASE_SSL_CA_FILE to the downloaded Supabase certificate (.crt) so the connection is verified.",
    );
  }

  const result = await setupDatabase(adminUrl, process.env.EIGHTCORE_ROLE_PREFIX ?? "eightcore");
  const ca = caFile ? (await readFile(caFile, "utf8")).trim().replace(/\n/g, "\\n") : undefined;

  const netlifyFile = process.env.SETUP_OUTPUT_FILE ?? ".env.netlify";
  const privateFile = process.env.SETUP_PRIVATE_FILE ?? ".env.supabase-admin";
  await writeFile(
    netlifyFile,
    [
      "# Generated by npm run db:supabase:setup. SECRETS: never commit or share in chat.",
      "# Add each line as an environment variable in Netlify (Site configuration > Environment variables).",
      `DATABASE_URL=${result.appUrl}`,
      "DATABASE_POOL_MAX=3",
      ...(ca ? [`DATABASE_SSL_CA=${ca}`] : []),
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  await writeFile(
    privateFile,
    [
      "# Generated by npm run db:supabase:setup. SECRETS: keep on this machine only.",
      "# Schema-changing (migrator) access, for running future migrations. Do NOT add to Netlify.",
      `DATABASE_MIGRATOR_URL=${result.migratorUrl}`,
      ...(ca ? [`DATABASE_SSL_CA=${ca}`] : []),
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  console.log(
    `\n✓ ${result.tables} tables ready; API roles have no access; app role cannot change the schema.`,
  );
  for (const w of result.warnings) console.warn(`⚠ ${w}`);
  console.log(`✓ Netlify settings written to ${netlifyFile}`);
  console.log(`✓ Migrator settings written to ${privateFile} (keep private; not for Netlify)`);
  console.log("  Passwords are not shown here. Open the files to copy them.");
}
