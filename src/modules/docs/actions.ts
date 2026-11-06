"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { resolveActor } from "@/server/authz/actor";
import { runAction } from "@/server/action";
import type { ActionState } from "@/lib/action-state";
import { ValidationError } from "@/server/errors";
import { MAX_DOC_JSON } from "./content";
import { createDoc, deleteDoc, searchDocs, updateDoc } from "./service";

async function actorFor(workspaceSlug: string) {
  const user = await requireUser();
  return resolveActor(user.id, workspaceSlug);
}

/** Creates a doc and opens it. */
export async function createDocAction(
  workspaceSlug: string,
  projectKey: string,
  projectId: string,
  options: { parentId?: string | null; listId?: string | null } = {},
): Promise<ActionState> {
  let id = "";
  const result = await runAction(async () => {
    ({ id } = await createDoc(await actorFor(workspaceSlug), projectId, { title: "", ...options }));
    revalidatePath(`/w/${workspaceSlug}/p/${projectKey}`, "layout");
  });
  if (result?.ok) redirect(`/w/${workspaceSlug}/p/${projectKey}/docs/${id}`);
  return result;
}

export type SaveDocState =
  { ok: true; version: number; savedAt: string } | { ok: false; message: string; conflict?: boolean };

/** Autosave: the new version comes back for the next save. */
export async function saveDocAction(
  workspaceSlug: string,
  docId: string,
  version: number,
  patch: { title?: string; content?: string },
): Promise<SaveDocState> {
  let saved: { version: number; updatedAt: Date } | null = null;
  const result = await runAction(async () => {
    let content: unknown;
    if (typeof patch.content === "string") {
      if (patch.content.length > MAX_DOC_JSON) throw new ValidationError("The document is too long");
      try {
        content = JSON.parse(patch.content);
      } catch {
        throw new ValidationError("The document couldn't be read");
      }
    }
    saved = await updateDoc(await actorFor(workspaceSlug), docId, version, {
      title: typeof patch.title === "string" ? patch.title : undefined,
      content,
    });
  });
  if (result?.ok && saved) {
    const s = saved as { version: number; updatedAt: Date };
    return { ok: true, version: s.version, savedAt: s.updatedAt.toISOString() };
  }
  const message = result && !result.ok ? result.message : "Could not save";
  return { ok: false, message, conflict: /someone else changed/i.test(message) };
}

export async function deleteDocAction(
  workspaceSlug: string,
  projectKey: string,
  docId: string,
  parentId: string | null,
): Promise<ActionState> {
  const result = await runAction(async () => {
    await deleteDoc(await actorFor(workspaceSlug), docId);
    revalidatePath(`/w/${workspaceSlug}/p/${projectKey}`, "layout");
  });
  if (result?.ok) redirect(`/w/${workspaceSlug}/p/${projectKey}${parentId ? `/docs/${parentId}` : "/docs"}`);
  return result;
}

/** For the search palette. */
export async function quickFindDocsAction(workspaceSlug: string, query: string) {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return [];
  return searchDocs(await actorFor(workspaceSlug), q, 5);
}
