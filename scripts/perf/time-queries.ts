// Times the list view's database work for the Perf list (see seed-large-list.ts).
import { loadEnvFiles } from "../load-env";

loadEnvFiles();
const { eq } = await import("drizzle-orm");
const { db, closeDb } = await import("@/server/db");
const { users, taskLists } = await import("@/server/db/schema");
const { resolveActor } = await import("@/server/authz/actor");
const { getList } = await import("@/modules/lists/service");
const { listTasks, listAssignableMembers } = await import("@/modules/tasks/service");
const { tagsForTasks } = await import("@/modules/tags/service");
const { openBlockerCounts } = await import("@/modules/dependencies/service");
const { fieldValuesForTasks } = await import("@/modules/fields/service");

const [owner] = await db()
  .select({ id: users.id })
  .from(users)
  .where(eq(users.email, "owner@demo.eightcore.local"));
const actor = await resolveActor(owner!.id, "demo");
const [list] = await db()
  .select({ id: taskLists.id, projectId: taskLists.projectId })
  .from(taskLists)
  .where(eq(taskLists.name, "Big list"));
const time = async <T>(name: string, fn: () => Promise<T>) => {
  const t = performance.now();
  const r = await fn();
  console.log(`${name.padEnd(22)} ${(performance.now() - t).toFixed(0)}ms`);
  return r;
};
for (let round = 0; round < 2; round++) {
  console.log(`— round ${round + 1}`);
  await time("getList", () => getList(actor, list!.id));
  const tasks = await time("listTasks", () => listTasks(actor, list!.id));
  const ids = tasks.map((t) => t.id);
  await time("tagsForTasks", () => tagsForTasks(db(), ids));
  await time("openBlockerCounts", () => openBlockerCounts(db(), actor, ids));
  await time("fieldValuesForTasks", () => fieldValuesForTasks(db(), ids));
  await time("assignable members", () => listAssignableMembers(actor, list!.projectId));
}
await closeDb();
