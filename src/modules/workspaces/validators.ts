import { z } from "zod";
import { WORKSPACE_ROLES } from "@/server/authz/matrix";

export const RESERVED_SLUGS = new Set(["new", "api", "admin", "settings", "invite", "w", "app"]);

export const workspaceSlug = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, "Use at least 2 characters")
  .max(48, "Use at most 48 characters")
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    "Lowercase letters, numbers and dashes; no leading or trailing dash",
  )
  .refine((s) => !RESERVED_SLUGS.has(s), "That address is reserved");

export const createWorkspaceInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(80, "Use at most 80 characters"),
  slug: workspaceSlug,
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInput>;

export const invitableRole = z.enum(["admin", "member", "guest"]);

export const inviteMemberInput = z.object({
  email: z.email("Enter a valid email").trim().toLowerCase().max(254),
  role: invitableRole,
});
export type InviteMemberInput = z.infer<typeof inviteMemberInput>;

export const changeRoleInput = z.object({
  userId: z.uuid(),
  role: z.enum(WORKSPACE_ROLES),
});

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
}
