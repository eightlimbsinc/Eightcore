import { z } from "zod";

export const TASK_PRIORITIES = ["urgent", "high", "normal", "low", "none"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

const title = z.string().trim().min(1, "Title is required").max(500, "Use at most 500 characters");
/** "" from an empty date input means "no date". */
const optionalDate = z.preprocess(
  (v) => (v === "" ? null : v),
  z.iso.date({ message: "Use a valid date" }).nullable(),
);

export const createTaskInput = z.object({
  title,
  description: z.string().max(20_000, "The description is too long").default(""),
  statusId: z.uuid().optional(),
  parentTaskId: z.uuid().optional(),
  priority: z.enum(TASK_PRIORITIES).default("none"),
  startDate: optionalDate.optional(),
  dueDate: optionalDate.optional(),
  assigneeIds: z.array(z.uuid()).max(50).default([]),
});
export type CreateTaskInput = z.input<typeof createTaskInput>;

export const updateTaskInput = z
  .object({
    title: title.optional(),
    description: z.string().max(20_000, "The description is too long").optional(),
    statusId: z.uuid().optional(),
    priority: z.enum(TASK_PRIORITIES).optional(),
    startDate: optionalDate.optional(),
    dueDate: optionalDate.optional(),
    /** Planned effort in minutes; null clears it. */
    timeEstimateMinutes: z.number().int().min(1).max(100_000).nullable().optional(),
  })
  .refine((v) => !v.startDate || !v.dueDate || v.startDate <= v.dueDate, {
    message: "The start date must be on or before the due date",
    path: ["dueDate"],
  });
export type UpdateTaskInput = z.input<typeof updateTaskInput>;

/** "WEB-12" → { key: "WEB", number: 12 } */
export function parseTaskRef(ref: string): { key: string; number: number } | null {
  const match = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,9})$/.exec(ref.trim());
  return match ? { key: match[1]!.toUpperCase(), number: Number(match[2]) } : null;
}
