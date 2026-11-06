// Migrates ClickUp into Eightcore over ClickUp's API. Read-only toward ClickUp. Dry run unless --apply.
//
//   CLICKUP_API_TOKEN must be set (a Codespace secret; never paste it into chat or commit it).
//   npm run import:clickup-api:supabase -- --as you@company.com            (dry run: a report, nothing written)
//   npm run import:clickup-api:supabase -- --as you@company.com --apply    (import)
//
// Options: --workspace <slug> (if you belong to several), --key "Space name=KEY" (repeatable),
//          --space "Space name" (repeatable; default every space), --time-zone Asia/Manila,
//          --no-comments. Re-running is safe: what was imported is skipped, what failed is retried.
import { parseArgs } from "node:util";
import { loadEnvFiles } from "../load-env";

loadEnvFiles();
process.env.BETTER_AUTH_SECRET ??= "import-script-placeholder-not-used-for-signing";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

const { values } = parseArgs({
  options: {
    as: { type: "string" },
    workspace: { type: "string" },
    key: { type: "string", multiple: true, default: [] },
    space: { type: "string", multiple: true, default: [] },
    "time-zone": { type: "string", default: "Asia/Manila" },
    "no-comments": { type: "boolean", default: false },
    apply: { type: "boolean", default: false },
  },
});
if (!values.as) throw new Error("Missing --as <your Eightcore email>");
const token = process.env.CLICKUP_API_TOKEN?.trim();
if (!token) {
  throw new Error(
    "CLICKUP_API_TOKEN isn't set. In ClickUp: avatar → Settings → Apps → API Token (Generate). " +
      "Save it as a Codespace secret named CLICKUP_API_TOKEN, then reopen the Codespace.",
  );
}
new Intl.DateTimeFormat("en", { timeZone: values["time-zone"] }); // fails early on a bad zone

const { and, eq, sql } = await import("drizzle-orm");
const { db, closeDb } = await import("@/server/db");
const { users, workspaceMembers, workspaces } = await import("@/server/db/schema");
const { resolveActor } = await import("@/server/authz/actor");
const { canWorkspace } = await import("@/server/authz/policy");
const { clickUpHttpClient, runClickUpImport } = await import("@/modules/imports/clickup-run");

try {
  const [user] = await db()
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.email})`, values.as.toLowerCase()));
  if (!user) throw new Error(`No Eightcore account for ${values.as}`);
  const memberships = await db()
    .select({ slug: workspaces.slug, name: workspaces.name })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(and(eq(workspaceMembers.userId, user.id), eq(workspaceMembers.status, "active")));
  const workspace = values.workspace
    ? memberships.find((m) => m.slug === values.workspace)
    : memberships.length === 1
      ? memberships[0]
      : undefined;
  if (!workspace)
    throw new Error(
      `Pick a workspace with --workspace: ${memberships.map((m) => m.slug).join(", ") || "none"}`,
    );
  const actor = { ...(await resolveActor(user.id, workspace.slug)), actorKind: "import" as const };
  if (!canWorkspace(actor.workspaceRole, "project.view_all"))
    throw new Error("Run the import as a workspace owner or admin.");

  const keys = new Map<string, string>();
  for (const k of values.key) {
    const [name, key] = k.split("=");
    if (!name || !key || !/^[A-Za-z][A-Za-z0-9]{1,9}$/.test(key.trim()))
      throw new Error(`--key "${k}": use "Space name=KEY" (2–10 letters/digits, starting with a letter)`);
    keys.set(name.trim().toLowerCase(), key.trim().toUpperCase());
  }

  console.log(
    `\nEightcore workspace: ${workspace.name}   ${values.apply ? "IMPORTING" : "Dry run (nothing is written)"}\n`,
  );
  const started = Date.now();
  const report = await runClickUpImport({
    client: clickUpHttpClient(token, console.log),
    actor,
    apply: values.apply,
    timeZone: values["time-zone"],
    keys,
    spaces: values.space,
    comments: !values["no-comments"],
    log: console.log,
  });

  console.log("\nSpaces → projects");
  for (const s of report.spaces)
    console.log(
      `  ${s.name} → ${s.key}: ${s.lists} lists, ${s.tasks} tasks (${s.closed} closed, ${s.archived} archived, ${s.subtasks} subtasks)`,
    );
  console.log("\nPeople (matched by email)");
  for (const p of report.people)
    console.log(
      `  ${p.name} <${p.email ?? "no email"}> → ${p.matched ?? "NOT IN EIGHTCORE (left unassigned; comments attributed by name)"}`,
    );
  if (report.lossyFields.length)
    console.log(`\nFields that come across partly:\n  ${report.lossyFields.join("\n  ")}`);
  if (report.skippedFields.length)
    console.log(`\nFields skipped (no equivalent):\n  ${report.skippedFields.join("\n  ")}`);
  if (values.apply) {
    console.log("\nCreated");
    for (const [what, n] of Object.entries(report.created)) console.log(`  ${what}: ${n}`);
    if (report.warnings.length) console.log(`\n${report.warnings.length} warnings (listed above).`);
    console.log(
      `\nDone in ${Math.round((Date.now() - started) / 60000)} min. Re-run any time: nothing is duplicated.\n`,
    );
  } else {
    const minutes = Math.ceil((report.estimatedRequests * 0.65) / 60);
    console.log(
      `\nImporting will make about ${report.estimatedRequests} more ClickUp requests (~${minutes} min at ClickUp's rate limit).`,
    );
    console.log('Change a key with --key "Space name=KEY". Invite missing people first, then add --apply.\n');
  }
} finally {
  await closeDb();
}
