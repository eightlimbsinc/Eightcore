import { z } from "zod";
import { PROJECT_ROLES } from "@/server/authz/matrix";

export const projectKey = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{1,9}$/, "2–10 letters or digits, starting with a letter");

export const createProjectInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120, "Use at most 120 characters"),
  key: projectKey,
  description: z.string().trim().max(2000).default(""),
  visibility: z.enum(["workspace", "private"]).default("workspace"),
});
export type CreateProjectInput = z.input<typeof createProjectInput>;

export const updateProjectInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(120).optional(),
  description: z.string().trim().max(2000).optional(),
  visibility: z.enum(["workspace", "private"]).optional(),
});
export type UpdateProjectInput = z.input<typeof updateProjectInput>;

export const setProjectMemberInput = z.object({
  userId: z.uuid(),
  role: z.enum(PROJECT_ROLES).nullable(),
});

/** Suggests a project key from its name: "Acme Website" → "AW", "Platform" → "PLAT". */
export function suggestProjectKey(name: string): string {
  const words = name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "";
  const key = words.length > 1 ? words.map((w) => w[0]).join("") : words[0]!.slice(0, 4);
  const trimmed = key.replace(/^[0-9]+/, "").slice(0, 10);
  return trimmed.length >= 2 ? trimmed : (trimmed + "PRJ").slice(0, 4);
}
