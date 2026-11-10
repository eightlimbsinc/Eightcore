"use server";
import { requireUser } from "@/server/auth/session";
import { resolveActor } from "@/server/authz/actor";
import type { LinkPreview } from "@/lib/links";
import { linkPreviewsFor } from "./service";

/** Previews for links shown in a comment or description (signed-in workspace members only). */
export async function linkPreviewsAction(workspaceSlug: string, urls: string[]): Promise<LinkPreview[]> {
  const user = await requireUser();
  await resolveActor(user.id, workspaceSlug);
  if (!Array.isArray(urls)) return [];
  return linkPreviewsFor(urls.slice(0, 6)).catch(() => []);
}
