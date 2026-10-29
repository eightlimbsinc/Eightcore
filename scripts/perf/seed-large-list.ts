// Performance fixture: a project "Perf" in the demo workspace with one list of 1,000 tasks
// (plus 200 subtasks), spread over statuses, priorities, due dates, assignees and tags.
// Run after `npm run db:seed`:  npm run perf:seed   (refuses to run in production)
import { loadEnvFiles } from "../load-env";

loadEnvFiles();
if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production");

const { eq, and } = await import("drizzle-orm");
const { db, closeDb } = await import("@/server/db");
const { users, projects, workspaces, workspaceMembers } = await import("@/server/db/schema");
const { resolveActor } = await import("@/server/authz/actor");
const { createProject } = await import("@/modules/projects/service");
const { createList, listStatusesFor } = await import("@/modules/lists/service");
const { createTask } = await import("@/modules/tasks/service");
const { createTag, setTaskTags } = await import("@/modules/tags/service");

const TASKS = Number(process.env.PERF_TASKS ?? 1000);
const SUBTASKS = Math.round(TASKS / 5);

const [owner] = await db()
  .select({ id: users.id })
  .from(users)
  .where(eq(users.email, "owner@demo.eightcore.local"));
if (!owner) throw new Error("Run `npm run db:seed` first");
const actor = await resolveActor(owner.id, "demo");
const [ws] = await db().select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, "demo"));
const [existing] = await db()
  .select({ id: projects.id })
  .from(projects)
  .where(and(eq(projects.workspaceId, ws!.id), eq(projects.key, "PERF")));
if (existing) {
  // Start fresh each run (dev data only): the project's lists and tasks go with it.
  await db().delete(projects).where(eq(projects.id, existing.id));
}

const started = Date.now();
const project = await createProject(actor, { name: "Perf", key: "PERF" });
const list = await createList(actor, project.id, { name: "Big list", template: "agency" });
const statuses = await listStatusesFor(db(), list.id);
const people = (
  await db()
    .select({ id: workspaceMembers.userId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, ws!.id))
)
  // Guests can only be assigned on projects shared with them.
  .filter((m) => m.role !== "guest")
  .map((m) => m.id);
const tags = [];
for (const [name, color] of [
  ["Client review", "#3B82F6"],
  ["Bug", "#EF4444"],
  ["Design", "#8B5CF6"],
] as const)
  tags.push(await createTag(actor, project.id, { name, color }));

const priorities = ["urgent", "high", "normal", "low", "none"] as const;
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const parents: string[] = [];
for (let i = 0; i < TASKS; i++) {
  const task = await createTask(actor, list.id, {
    title: `Perf task ${i + 1}: ${["Homepage", "Checkout", "Blog", "Careers", "Podcast"][i % 5]} ${["copy", "layout", "QA", "assets"][i % 4]}`,
    statusId: statuses[i % statuses.length]!.id,
    priority: priorities[i % priorities.length],
    dueDate: i % 4 === 0 ? day((i % 60) - 20) : null,
    assigneeIds: i % 3 === 0 ? [] : [people[i % people.length]!],
  });
  if (i % 7 === 0) await setTaskTags(actor, task.id, [tags[i % tags.length]!.id]);
  if (parents.length < SUBTASKS / 2 && i % 5 === 0) parents.push(task.id);
  if ((i + 1) % 100 === 0) console.log(`${i + 1} tasks…`);
}
for (let i = 0; i < SUBTASKS; i++) {
  await createTask(actor, list.id, { title: `Subtask ${i + 1}`, parentTaskId: parents[i % parents.length] });
}
console.log(
  `Seeded ${TASKS} tasks and ${SUBTASKS} subtasks in ${((Date.now() - started) / 1000).toFixed(1)}s.`,
);
console.log(`List: /w/demo/l/${list.id}`);
await closeDb();
