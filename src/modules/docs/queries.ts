import "server-only";
import { notFound } from "next/navigation";
import { NotFoundError } from "@/server/errors";
import { getWorkspaceContext } from "@/modules/workspaces/queries";
import { getProjectByKey } from "@/modules/projects/service";
import { getProjectTree } from "@/modules/lists/service";
import { getDoc, listDocs } from "./service";

async function orNotFound<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

/** A project's docs, as a tree. */
export async function getDocsPage(slug: string, key: string) {
  const { actor } = await getWorkspaceContext(slug);
  return orNotFound(async () => {
    const project = await getProjectByKey(actor, key);
    const [{ docs, canCreate }, tree] = await Promise.all([
      listDocs(actor, project.id),
      getProjectTree(actor, project.id),
    ]);
    const lists = [...tree.rootLists, ...tree.folders.flatMap((f) => f.lists)].map((l) => ({
      id: l.id,
      name: l.name,
    }));
    return {
      project,
      docs,
      canCreate,
      lists,
      mustPickList: actor.workspaceRole === "guest" && lists.length > 0,
    };
  });
}

export async function getDocPage(slug: string, key: string, docId: string) {
  const { actor } = await getWorkspaceContext(slug);
  return orNotFound(async () => {
    const page = await getDoc(actor, docId);
    // The address must name the doc's own project.
    if (page.project.key !== key.toUpperCase()) notFound();
    return page;
  });
}
