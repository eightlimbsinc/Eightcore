import "server-only";
// ClickUp → Eightcore migration over ClickUp's API (read-only toward ClickUp).
// Everything is created through the app's own services, as the importing person, with
// automations, webhooks and notifications silenced. Each created row is recorded in
// import_mappings, so a re-run skips what's done and picks up what failed.
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/server/db";
import { comments, importMappings, projects, tasks, users, workspaceMembers } from "@/server/db/schema";
import type { ActorContext } from "@/server/authz/policy";
import { resolveActorById } from "@/server/authz/actor";
import { withoutOutbox } from "@/server/causation";
import { createProject } from "@/modules/projects/service";
import {
  addStatus,
  createFolder,
  createList,
  deleteStatus,
  listStatusesFor,
  updateStatus,
} from "@/modules/lists/service";
import { createTask, listAssignableMembers, setTaskArchived, setTaskWatchers } from "@/modules/tasks/service";
import { createTag, listProjectTags, setTaskTags } from "@/modules/tags/service";
import { createField, listProjectFields, setTaskFieldValues } from "@/modules/fields/service";
import { createComment } from "@/modules/comments/service";
import { addDependency } from "@/modules/dependencies/service";
import {
  attachmentsComment,
  attributedComment,
  dateOf,
  descriptionOf,
  estimateMinutes,
  fieldKind,
  fieldValue,
  normalizeColor,
  optionLabel,
  priorityOf,
  projectKeyFor,
  statusCategory,
  timestampOf,
  type CuField,
  type CuStatus,
  type CuTask,
  type CuUser,
} from "./clickup-api";

const SOURCE = "clickup";

export interface ClickUpClient {
  get<T>(path: string): Promise<T>;
}

/** ClickUp API v2 over HTTPS, paced under the 100 requests/minute limit, with retries. */
export function clickUpHttpClient(token: string, log: (s: string) => void = () => {}): ClickUpClient {
  let last = 0;
  let count = 0;
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  return {
    async get<T>(path: string): Promise<T> {
      for (let attempt = 1; ; attempt++) {
        const wait = last + 650 - Date.now();
        if (wait > 0) await pause(wait);
        last = Date.now();
        count++;
        if (count % 200 === 0) log(`  …${count} ClickUp requests so far`);
        let res: Response;
        try {
          res = await fetch(`https://api.clickup.com/api/v2${path}`, {
            headers: { Authorization: token, Accept: "application/json" },
            signal: AbortSignal.timeout(30_000),
          });
        } catch (error) {
          if (attempt >= 5) throw error;
          await pause(2000 * attempt);
          continue;
        }
        if (res.status === 429) {
          const reset = Number(res.headers.get("x-ratelimit-reset")) * 1000;
          await pause(Math.min(70_000, Math.max(5_000, reset ? reset - Date.now() + 1000 : 60_000)));
          continue;
        }
        if (res.status >= 500 && attempt < 5) {
          await pause(2000 * attempt);
          continue;
        }
        if (res.status === 401)
          throw new Error("ClickUp refused the API token (401). Check CLICKUP_API_TOKEN.");
        if (!res.ok) throw new Error(`ClickUp answered ${res.status} for ${path.split("?")[0]}`);
        return (await res.json()) as T;
      }
    },
  };
}

type CuList = { id: string; name: string; statuses?: CuStatus[]; task_count?: number };
type CuSpace = { id: string; name: string; private?: boolean };
type CuComment = {
  id: string;
  comment_text?: string;
  user?: CuUser;
  date?: string;
  reply_count?: number | string;
};

export interface ImportOptions {
  client: ClickUpClient;
  /** The person importing (they must own or administer the Eightcore workspace). */
  actor: ActorContext;
  apply: boolean;
  timeZone: string;
  /** Space name or id → project key. */
  keys?: Map<string, string>;
  /** Only these spaces (names or ids, any case). */
  spaces?: string[];
  comments?: boolean;
  log?: (line: string) => void;
}

interface PlannedList {
  list: CuList;
  folder: { id: string; name: string } | null;
  statuses: CuStatus[];
  fields: CuField[];
  tasks: CuTask[];
}
interface PlannedSpace {
  space: CuSpace;
  key: string;
  folders: { id: string; name: string }[];
  lists: PlannedList[];
}

export interface ImportReport {
  spaces: {
    name: string;
    key: string;
    lists: number;
    tasks: number;
    closed: number;
    archived: number;
    subtasks: number;
  }[];
  people: { name: string; email: string | null; matched: string | null }[];
  lossyFields: string[];
  skippedFields: string[];
  created: Record<string, number>;
  warnings: string[];
  estimatedRequests: number;
}

/** Reads ClickUp, then (with `apply`) creates the projects, lists, tasks, comments… in Eightcore. */
export async function runClickUpImport(options: ImportOptions): Promise<ImportReport> {
  const { client, actor } = options;
  const log = options.log ?? (() => {});
  const report: ImportReport = {
    spaces: [],
    people: [],
    lossyFields: [],
    skippedFields: [],
    created: {},
    warnings: [],
    estimatedRequests: 0,
  };
  const bump = (what: string) => (report.created[what] = (report.created[what] ?? 0) + 1);
  const warn = (msg: string) => {
    report.warnings.push(msg);
    log(`  ! ${msg}`);
  };

  // ── Read ClickUp ─────────────────────────────────────────────────────────────────────
  const { teams } = await client.get<{
    teams: { id: string; name: string; members?: { user: CuUser }[] }[];
  }>("/team");
  const members = new Map<number, CuUser>();
  for (const t of teams) for (const m of t.members ?? []) members.set(Number(m.user.id), m.user);

  // People: ClickUp members ↔ active Eightcore members, by email.
  const wsPeople = await db()
    .select({ id: users.id, email: users.email, name: users.name })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, actor.workspaceId), eq(workspaceMembers.status, "active")));
  const byEmail = new Map(wsPeople.map((p) => [p.email.toLowerCase(), p]));
  const people = new Map<number, string>();
  for (const [id, u] of members) {
    const match = u.email ? byEmail.get(u.email.toLowerCase()) : undefined;
    if (match) people.set(id, match.id);
    report.people.push({
      name: u.username ?? String(id),
      email: u.email ?? null,
      matched: match?.name ?? null,
    });
  }

  const wanted = (s: CuSpace) =>
    !options.spaces?.length ||
    options.spaces.some((x) => x === s.id || x.toLowerCase() === s.name.toLowerCase());
  const takenKeys = new Set(
    (
      await db()
        .select({ key: projects.key })
        .from(projects)
        .where(eq(projects.workspaceId, actor.workspaceId))
    ).map((r) => r.key),
  );
  const mapped = await loadMappings(actor.workspaceId);

  const planned: PlannedSpace[] = [];
  for (const team of teams) {
    const { spaces } = await client.get<{ spaces: CuSpace[] }>(`/team/${team.id}/space?archived=false`);
    for (const space of spaces.filter(wanted)) {
      log(`Reading ${space.name}…`);
      const existingProject = mapped.get(`project:${space.id}`);
      const key =
        options.keys?.get(space.id) ??
        options.keys?.get(space.name.toLowerCase()) ??
        (existingProject ? "(already imported)" : projectKeyFor(space.name, takenKeys));
      takenKeys.add(key);
      const { folders } = await client.get<{ folders: { id: string; name: string; lists: CuList[] }[] }>(
        `/space/${space.id}/folder?archived=false`,
      );
      const { lists: rootLists } = await client.get<{ lists: CuList[] }>(
        `/space/${space.id}/list?archived=false`,
      );
      const all = [
        ...folders.flatMap((f) => f.lists.map((l) => ({ list: l, folder: { id: f.id, name: f.name } }))),
        ...rootLists.map((l) => ({ list: l, folder: null })),
      ];
      const lists: PlannedList[] = [];
      for (const { list, folder } of all) {
        const detail = await client.get<CuList>(`/list/${list.id}`);
        const { fields } = await client.get<{ fields: CuField[] }>(`/list/${list.id}/field`);
        const tasksById = new Map<string, CuTask>();
        for (const archived of [false, true]) {
          for (let page = 0; page < 500; page++) {
            const res = await client.get<{
              tasks: (CuTask & { list?: { id: string } })[];
              last_page?: boolean;
            }>(
              `/list/${list.id}/task?include_closed=true&subtasks=true&include_markdown_description=true&archived=${archived}&page=${page}`,
            );
            for (const t of res.tasks) if (!t.list || t.list.id === list.id) tasksById.set(t.id, t);
            if (res.last_page !== false || !res.tasks.length) break;
          }
        }
        lists.push({ list, folder, statuses: detail.statuses ?? [], fields, tasks: [...tasksById.values()] });
      }
      planned.push({ space, key, folders: folders.map(({ id, name }) => ({ id, name })), lists });
      const ts = lists.flatMap((l) => l.tasks);
      report.spaces.push({
        name: space.name,
        key,
        lists: lists.length,
        tasks: ts.length,
        closed: ts.filter((t) => ["done", "closed"].includes(t.status.type)).length,
        archived: ts.filter((t) => t.archived).length,
        subtasks: ts.filter((t) => t.parent).length,
      });
      for (const f of new Map(lists.flatMap((l) => l.fields).map((f) => [f.id, f])).values()) {
        const kind = fieldKind(f.type);
        if (f.type === "attachment")
          report.lossyFields.push(
            `${space.name} › ${f.name}: files become links in the task's attachments comment`,
          );
        else if (!kind) report.skippedFields.push(`${space.name} › ${f.name} (${f.type})`);
        else if (kind.lossy) report.lossyFields.push(`${space.name} › ${f.name}: ${kind.lossy}`);
      }
    }
  }
  const taskCount = planned.flatMap((s) => s.lists.flatMap((l) => l.tasks)).length;
  // Per task: its detail (attachments, checklists) and its comments.
  report.estimatedRequests = taskCount * (options.comments === false ? 1 : 2);

  if (!options.apply) return report;

  // ── Write to Eightcore ───────────────────────────────────────────────────────────────
  const ws = actor.workspaceId;
  const remember = async (type: string, externalId: string, entityId: string) => {
    await db()
      .insert(importMappings)
      .values({ workspaceId: ws, source: SOURCE, entityType: type, externalId, entityId })
      .onConflictDoNothing();
    mapped.set(`${type}:${externalId}`, entityId);
  };
  const find = (type: string, externalId: string) => mapped.get(`${type}:${externalId}`);

  await withoutOutbox(async () => {
    for (const plan of planned) {
      const { space } = plan;
      log(`\n${space.name} (${plan.key})`);
      let projectId = find("project", space.id);
      if (!projectId) {
        const p = await createProject(actor, { name: space.name.slice(0, 120), key: plan.key });
        projectId = p.id;
        await remember("project", space.id, projectId);
        bump("projects");
      }

      for (const f of plan.folders) {
        if (find("folder", f.id)) continue;
        const folder = await createFolder(actor, projectId, { name: f.name.slice(0, 120) || "Folder" });
        await remember("folder", f.id, folder.id);
        bump("folders");
      }

      // Fields: one per ClickUp field id; tied to a list when only one list uses it.
      const fieldLists = new Map<string, Set<string>>();
      for (const l of plan.lists)
        for (const f of l.fields) fieldLists.set(f.id, (fieldLists.get(f.id) ?? new Set()).add(l.list.id));

      for (const pl of plan.lists) {
        const listId = await ensureList(pl, projectId);
        for (const f of pl.fields)
          await ensureField(f, projectId, fieldLists.get(f.id)!.size === 1 ? listId : null);
      }

      const tagIds = new Map(
        (await listProjectTags(actor, projectId)).map((t) => [t.name.toLowerCase(), t.id] as const),
      );
      for (const pl of plan.lists) await importTasks(pl, projectId, tagIds);
    }
    // Dependencies once every task exists (they can cross lists and spaces).
    const all = planned.flatMap((s) => s.lists.flatMap((l) => l.tasks));
    for (const t of all) {
      for (const d of t.dependencies ?? []) {
        if (d.task_id !== t.id) continue; // each link appears on both tasks; take it once
        const key = `${d.task_id}>${d.depends_on}`;
        const waiting = find("task", d.task_id);
        const blocker = find("task", d.depends_on);
        if (find("dependency", key) || !waiting || !blocker) continue;
        try {
          const ref = await refOf(blocker);
          await addDependency(actor, waiting, { ref, relation: "blocked_by" });
          await remember("dependency", key, waiting);
          bump("dependencies");
        } catch (error) {
          warn(`Dependency ${key} skipped: ${(error as Error).message}`);
        }
      }
    }
  });
  return report;

  // ── Helpers (closures over actor, mappings, report) ───────────────────────────────────
  async function ensureList(pl: PlannedList, projectId: string) {
    const existing = find("list", pl.list.id);
    if (existing) return existing;
    const folderId = pl.folder ? (find("folder", pl.folder.id) ?? null) : null;
    const list = await createList(actor, projectId, {
      name: pl.list.name.slice(0, 120) || "List",
      folderId,
      template: "simple",
    });
    await remember("list", pl.list.id, list.id);
    bump("lists");
    // ClickUp's statuses replace the template's (reusing same-named ones).
    const template = await listStatusesFor(db(), list.id);
    const used = new Set<string>();
    const ordered = [...pl.statuses].sort((a, b) => Number(a.orderindex ?? 0) - Number(b.orderindex ?? 0));
    for (const s of ordered) {
      const name = s.status.trim().slice(0, 40) || "Status";
      const input = { name, category: statusCategory(s), color: normalizeColor(s.color) };
      const same = template.find((t) => t.name.toLowerCase() === name.toLowerCase() && !used.has(t.id));
      if (find("status", `${pl.list.id}:${name.toLowerCase()}`)) continue; // same name twice in ClickUp
      let id: string;
      if (same) {
        await updateStatus(actor, same.id, input);
        id = same.id;
      } else id = (await addStatus(actor, list.id, input)).id;
      used.add(id);
      await remember("status", `${pl.list.id}:${name.toLowerCase()}`, id);
    }
    const keep = [...used][0];
    if (keep) for (const t of template) if (!used.has(t.id)) await deleteStatus(actor, t.id, keep);
    return list.id;
  }

  async function ensureField(f: CuField, projectId: string, listId: string | null) {
    if (find("field", f.id)) return;
    const kind = fieldKind(f.type);
    if (!kind) return;
    const existing = (await listProjectFields(actor, projectId)).fields;
    let name = f.name.trim().slice(0, 60) || "Field";
    for (let i = 2; existing.some((e) => e.name.toLowerCase() === name.toLowerCase()); i++)
      name = `${f.name.trim().slice(0, 55)} (${i})`;
    const opts = kind.kind === "dropdown" ? (f.type_config?.options ?? []) : [];
    const labels: string[] = [];
    for (const o of opts) {
      let label = optionLabel(o);
      for (let i = 2; labels.some((l) => l.toLowerCase() === label.toLowerCase()); i++)
        label = `${optionLabel(o).slice(0, 55)} (${i})`;
      labels.push(label);
    }
    const field = await createField(actor, projectId, {
      name,
      type: kind.kind,
      listId,
      options: labels.slice(0, 50),
    });
    await remember("field", f.id, field.id);
    bump("custom fields");
    if (opts.length) {
      const created = (await listProjectFields(actor, projectId)).fields.find((x) => x.id === field.id);
      for (const [i, o] of opts.entries()) {
        const target = created?.options[i];
        if (target) await remember("option", o.id, target.id);
      }
      if (opts.length > 50) warn(`${f.name}: only the first 50 dropdown options were kept`);
    }
  }

  async function importTasks(pl: PlannedList, projectId: string, tagIds: Map<string, string>) {
    const listId = find("list", pl.list.id)!;
    const statuses = await listStatusesFor(db(), listId);
    const statusOf = (s: CuStatus) =>
      find("status", `${pl.list.id}:${s.status.trim().slice(0, 40).toLowerCase()}`) ?? statuses[0]!.id;
    const assignable = new Set((await listAssignableMembers(actor, projectId, listId)).map((m) => m.userId));
    const person = (u: CuUser) => {
      const id = people.get(Number(u.id));
      return id && assignable.has(id) ? id : undefined;
    };
    // Parents before their subtasks.
    const inList = new Set(pl.tasks.map((t) => t.id));
    const depth = (t: CuTask, seen = 0): number =>
      t.parent && inList.has(t.parent) && seen < 10
        ? 1 +
          depth(
            pl.tasks.find((x) => x.id === t.parent)!,
            seen + 1,
          )
        : 0;
    const ordered = [...pl.tasks].sort((a, b) => depth(a) - depth(b));
    log(`  ${pl.list.name}: ${ordered.length} tasks`);

    for (const listed of ordered) {
      if (find("task", listed.id)) continue;
      try {
        const t = await client.get<CuTask>(`/task/${listed.id}?include_markdown_description=true`);
        const start = dateOf(t.start_date, options.timeZone);
        const due = dateOf(t.due_date, options.timeZone);
        const parentId = t.parent ? find("task", t.parent) : undefined;
        if (t.parent && !parentId)
          warn(`${t.name}: its parent task wasn't imported, so it's a top-level task`);
        const assigneeIds = [...new Set((t.assignees ?? []).map(person).filter((x): x is string => !!x))];
        // Assignees with no Eightcore account: named in the description and tagged "ClickUp: Name",
        // so their tasks can be found and reassigned once they join.
        const missing = (t.assignees ?? [])
          .filter((u) => !people.get(Number(u.id)))
          .map((u) => (u.username || u.email || "someone").trim());
        const created = await createTask(actor, listId, {
          title: t.name.trim().slice(0, 500) || "Untitled",
          description: descriptionOf(t, missing),
          statusId: statusOf(t.status),
          priority: priorityOf(t),
          startDate: start && due && start > due ? undefined : (start ?? undefined),
          dueDate: due ?? undefined,
          assigneeIds,
          parentTaskId: parentId,
        });
        await remember("task", t.id, created.id);
        bump("tasks");

        // Original dates and the estimate, as they were in ClickUp.
        const closed = ["done", "closed"].includes(t.status.type);
        await db()
          .update(tasks)
          .set({
            createdAt: timestampOf(t.date_created) ?? sql`${tasks.createdAt}`,
            updatedAt: timestampOf(t.date_updated) ?? sql`${tasks.updatedAt}`,
            completedAt: closed
              ? (timestampOf(t.date_done) ?? timestampOf(t.date_closed) ?? timestampOf(t.date_updated))
              : null,
            timeEstimateMinutes: estimateMinutes(t.time_estimate),
          })
          .where(eq(tasks.id, created.id));

        const tags: string[] = [];
        for (const tag of [
          ...(t.tags ?? []),
          ...missing.map((n) => ({ name: `ClickUp: ${n}`, tag_bg: "#9CA3AF" })),
        ]) {
          const name = tag.name.trim().slice(0, 40);
          if (!name) continue;
          let id = tagIds.get(name.toLowerCase());
          if (!id) {
            id = (await createTag(actor, projectId, { name, color: normalizeColor(tag.tag_bg, "#A1A1AA") }))
              .id;
            tagIds.set(name.toLowerCase(), id);
            bump("tags");
          }
          tags.push(id);
        }
        if (tags.length) await setTaskTags(actor, created.id, tags);

        const values: Record<string, string> = {};
        for (const f of t.custom_fields ?? []) {
          const target = find("field", f.id);
          if (!target) continue;
          const optionIds = new Map(
            (f.type_config?.options ?? [])
              .map((o) => [o.id, find("option", o.id)] as const)
              .filter((e): e is [string, string] => !!e[1]),
          );
          const v = fieldValue(f, { timeZone: options.timeZone, options: optionIds, people });
          if (v !== null && (f.type !== "users" || assignable.has(v))) values[target] = v;
        }
        if (Object.keys(values).length) {
          await setTaskFieldValues(actor, created.id, values).catch((e: Error) =>
            warn(`${t.name}: some custom field values skipped (${e.message})`),
          );
        }

        if (options.comments !== false) await importComments(t, created.id, assignable);
        const files = attachmentsComment(t);
        if (files) {
          await createComment(actor, created.id, { body: files });
          bump("attachment link comments");
        }
        // Followers (last: posting comments makes the poster follow): ClickUp's watchers; the importer isn't left following everything.
        const watchers = [...new Set((t.watchers ?? []).map(person).filter((x): x is string => !!x))];
        await setTaskWatchers(actor, created.id, {
          add: watchers,
          remove: watchers.includes(actor.userId) ? [] : [actor.userId],
        });

        if (t.archived) await setTaskArchived(actor, created.id, true);
      } catch (error) {
        warn(`Task "${listed.name}" (${listed.id}) not imported: ${(error as Error).message}`);
      }
    }
  }

  async function importComments(t: CuTask, taskId: string, assignable: Set<string>) {
    const all: CuComment[] = [];
    let path = `/task/${t.id}/comment`;
    for (let page = 0; page < 100; page++) {
      const { comments: batch } = await client.get<{ comments: CuComment[] }>(path);
      all.push(...batch);
      if (batch.length < 25) break;
      const oldest = batch[batch.length - 1]!;
      path = `/task/${t.id}/comment?start=${oldest.date}&start_id=${oldest.id}`;
    }
    for (const c of all.reverse()) {
      const id = await postComment(c, taskId, undefined, assignable);
      if (id && Number(c.reply_count) > 0) {
        const { comments: replies } = await client.get<{ comments: CuComment[] }>(`/comment/${c.id}/reply`);
        for (const r of replies) await postComment(r, taskId, id, assignable);
      }
    }
  }

  async function postComment(
    c: CuComment,
    taskId: string,
    parentCommentId: string | undefined,
    assignable: Set<string>,
  ) {
    const done = find("comment", c.id);
    if (done) return done;
    const at = timestampOf(c.date);
    const author = c.user ? people.get(Number(c.user.id)) : undefined;
    const text = (c.comment_text ?? "").trim() || "(an image or file in ClickUp)";
    // As the original author when they're here and can see the task; otherwise attributed in the text.
    const asAuthor = author === actor.userId || (author && assignable.has(author));
    const as =
      author && asAuthor && author !== actor.userId
        ? await resolveActorById(author, actor.workspaceId, "import")
        : actor;
    const body = !asAuthor
      ? attributedComment(text, c.user?.username ?? c.user?.email ?? "Someone", at)
      : text.slice(0, 10_000);
    const { id } = await createComment(as, taskId, { body, parentCommentId });
    if (at) await db().update(comments).set({ createdAt: at, updatedAt: at }).where(eq(comments.id, id));
    await remember("comment", c.id, id);
    bump("comments");
    return id;
  }

  async function refOf(taskId: string) {
    const [row] = await db()
      .select({ key: projects.key, number: tasks.number })
      .from(tasks)
      .innerJoin(projects, eq(projects.id, tasks.projectId))
      .where(eq(tasks.id, taskId));
    return `${row!.key}-${row!.number}`;
  }
}

async function loadMappings(workspaceId: string) {
  const rows = await db()
    .select({ type: importMappings.entityType, ext: importMappings.externalId, id: importMappings.entityId })
    .from(importMappings)
    .where(and(eq(importMappings.workspaceId, workspaceId), eq(importMappings.source, SOURCE)));
  return new Map(rows.map((r) => [`${r.type}:${r.ext}`, r.id]));
}
