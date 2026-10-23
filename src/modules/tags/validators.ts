import { z } from "zod";

/** Tag colours offered in the UI. Any #rrggbb is accepted from the API. */
export const TAG_COLORS = [
  "#64748b",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
] as const;

export const tagInput = z.object({
  name: z.string().trim().min(1, "Name is required").max(40, "Use at most 40 characters"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour")
    .default(TAG_COLORS[0]),
});
export type TagInput = z.input<typeof tagInput>;
