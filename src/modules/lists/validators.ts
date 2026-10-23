import { z } from "zod";
import { STATUS_TEMPLATES } from "./templates";

const name = z.string().trim().min(1, "Name is required").max(120, "Use at most 120 characters");

export const createFolderInput = z.object({ name });
export const renameFolderInput = z.object({ name });

export const createListInput = z.object({
  name,
  folderId: z.uuid().nullable().default(null),
  template: z.enum(Object.keys(STATUS_TEMPLATES) as [keyof typeof STATUS_TEMPLATES]).default("agency"),
});
export type CreateListInput = z.input<typeof createListInput>;

export const updateListInput = z.object({
  name: name.optional(),
  description: z.string().trim().max(2000).optional(),
  folderId: z.uuid().nullable().optional(),
});
export type UpdateListInput = z.input<typeof updateListInput>;

export const statusInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(40, "Use at most 40 characters"),
  category: z.enum(["backlog", "unstarted", "active", "review", "done", "cancelled"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #3B82F6"),
});
export type StatusInput = z.input<typeof statusInput>;
