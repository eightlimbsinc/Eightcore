// Imports tasks from a ClickUp CSV export into one Eightcore list, through the app's own
// services (so every permission and data rule applies). Dry run unless --apply is given.
//
//   npm run import:clickup -- --file export.csv --as you@company.com --project "Blend 360" --list Website
//   (add --apply to write; --workspace <slug> if you belong to several; --status "To Do")
//
// Against the test site, run it from the machine holding .env.netlify:
//   npm run import:clickup:supabase -- --file ... --as ... --project ... --list ... [--apply]
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadEnvFiles } from "../load-env";

loadEnvFiles();
// The import never signs anything; these only satisfy the shared settings check.
process.env.BETTER_AUTH_SECRET ??= "import-script-placeholder-not-used-for-signing";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";

const { values } = parseArgs({
  options: {
    file: { type: "string" },
    as: { type: "string" },
    workspace: { type: "string" },
    project: { type: "string" },
    list: { type: "string" },
    status: { type: "string" },
    apply: { type: "boolean", default: false },
  },
});
for (const required of ["file", "as", "project", "list"] as const) {
  if (!values[required]) throw new Error(`Missing --${required}`);
}

const { and, eq, ilike, or, sql } = await import("drizzle-orm");
const { db, closeDb } = await import("@/server/db");
const { projects, taskAssignees, taskLists, tasks, users, workspaceMembers, workspaces } =
  await import("@/server/db/schema");
const { resolveActor } = await import("@/server/authz/actor");
const { createList, listStatusesFor } = await import("@/modules/lists/service");
const { createTask, listAssignableMembers, setTaskAssignees, updateTask } =
  await import("@/modules/tasks/service");
const { isClosedCategory } = await import("@/modules/lists/templates");
const { matchPerson, readClickUpExport } = await import("@/modules/imports/clickup-csv");

try {
  const { tasks: rows, ignoredColumns } = readClickUpExport(await readFile(values.file!, "utf8"));

  // Who is importing (must be able to manage lists in the project).
  const [user] = await db()
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(sql`lower(${users.email})`, values.as!.toLowerCase()));
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
  if (!workspace) {
    throw new Error(
      `Pick a workspace with --workspace: ${memberships.map((m) => `${m.slug} (${m.name})`).join(", ") || "none"}`,
    );
  }
  const actor = { ...(await resolveActor(user.id, workspace.slug)), actorKind: "import" as const };

  const [project] = await db()
    .select({ id: projects.id, key: projects.key, name: projects.name })
    .from(projects)
    .where(
      and(
        eq(projects.workspaceId, actor.workspaceId),
        or(eq(projects.key, values.project!.toUpperCase()), ilike(projects.name, values.project!)),
      ),
    );
  if (!project) throw new Error(`No project "${values.project}" in ${workspace.name}`);

  const [existingList] = await db()
    .select({ id: taskLists.id })
    .from(taskLists)
    .where(
      and(
        eq(taskLists.projectId, project.id),
        ilike(taskLists.name, values.list!),
        sql`${taskLists.archivedAt} is null`,
      ),
    );

  // People: ClickUp names → members who can see this project.
  const people = await listAssignableMembers(actor, project.id);
  const names = [...new Set(rows.flatMap((r) => r.assignees))];
  const matched = new Map(names.map((n) => [n, matchPerson(n, people)]));
  const missing = names.filter((n) => !matched.get(n));

  // Already imported (re-runs don't duplicate them): ClickUp ids recorded in descriptions.
  const done = new Map<string, string>();
  if (existingList) {
    const prior = await db()
      .select({ id: tasks.id, description: tasks.description })
      .from(tasks)
      .where(eq(tasks.listId, existingList.id));
    for (const t of prior) {
      const id = /ClickUp task (\S+)/.exec(t.description)?.[1];
      if (id) done.set(id, t.id);
    }
  }
  const todo = rows.filter((r) => !r.clickUpId || !done.has(r.clickUpId));
  const assigneeIdsOf = (row: (typeof rows)[number]) =>
    row.assignees.map((n) => matched.get(n)?.userId).filter((id): id is string => Boolean(id));

  console.log(`\nWorkspace: ${workspace.name}   Project: ${project.name} (${project.key})`);
  console.log(`List: ${values.list}${existingList ? "" : " (will be created, agency delivery statuses)"}`);
  console.log(
    `Tasks in file: ${rows.length}   to create: ${todo.length}   already imported: ${rows.length - todo.length}`,
  );
  console.log(`Ignored columns: ${ignoredColumns.join(", ") || "none"}`);
  console.log("People:");
  for (const [n, m] of matched)
    console.log(`  ${n} → ${m ? `${m.name} <${m.email}>` : "NOT FOUND (left unassigned)"}`);
  if (missing.length) {
    console.log(
      `\n${missing.length} people aren't members who can see this project. Invite them first (Members),`,
    );
    console.log(
      "then re-run with --apply: nothing is duplicated, and imported tasks get the people who joined.",
    );
  }

  if (!values.apply) {
    console.log("\nDry run: nothing was written. Add --apply to import.\n");
  } else {
    const listId =
      existingList?.id ??
      (await createList(actor, project.id, { name: values.list!, template: "agency" })).id;
    const statuses = await listStatusesFor(db(), listId);
    const status = values.status
      ? statuses.find((s) => s.name.toLowerCase() === values.status!.toLowerCase())
      : (statuses.find((s) => s.name.toLowerCase() === "to do") ??
        statuses.find((s) => !isClosedCategory(s.category)));
    if (!status)
      throw new Error(`No status "${values.status}" in this list: ${statuses.map((s) => s.name).join(", ")}`);

    let created = 0;
    for (const row of todo) {
      const assigneeIds = assigneeIdsOf(row);
      const task = await createTask(actor, listId, {
        title: row.title,
        statusId: status.id,
        priority: row.priority,
        dueDate: row.dueDate,
        assigneeIds,
      });
      const note = [
        row.clickUpId ? `Imported from ClickUp task ${row.clickUpId}` : "Imported from ClickUp",
        row.createdLabel ? `(created ${row.createdLabel})` : "",
      ]
        .filter(Boolean)
        .join(" ");
      await updateTask(actor, task.id, 1, { description: note });
      created++;
      console.log(`  ${task.ref}  ${row.title}`);
    }
    // Tasks imported before: add people who have joined since (nobody is removed).
    let updated = 0;
    for (const row of rows) {
      const taskId = row.clickUpId ? done.get(row.clickUpId) : undefined;
      const wanted = assigneeIdsOf(row);
      if (!taskId || !wanted.length) continue;
      const current = (
        await db()
          .select({ userId: taskAssignees.userId })
          .from(taskAssignees)
          .where(eq(taskAssignees.taskId, taskId))
      ).map((r) => r.userId);
      if (wanted.every((id) => current.includes(id))) continue;
      await setTaskAssignees(actor, taskId, [...new Set([...current, ...wanted])]);
      updated++;
    }
    console.log(
      `\nImported ${created} tasks into ${project.name} › ${values.list} (status "${status.name}").`,
    );
    if (updated) console.log(`Added newly matched assignees to ${updated} previously imported tasks.`);
    console.log("");
  }
} finally {
  await closeDb();
}
