import { z } from "zod";

/** What a form question fills in on the new task. */
export const FORM_FIELD_KINDS = [
  "title",
  "description",
  "priority",
  "due_date",
  "custom_field",
  "attachments",
  "question",
] as const;
export type FormFieldKind = (typeof FORM_FIELD_KINDS)[number];

export const formFieldSchema = z.object({
  /** Stable key for the question within the form (also the form input's name). */
  key: z.string().regex(/^[a-z0-9]{6,24}$/),
  kind: z.enum(FORM_FIELD_KINDS),
  label: z.string().trim().min(1, "Give the question a label").max(120),
  help: z.string().trim().max(300).default(""),
  required: z.boolean().default(false),
  /** custom_field: which field. */
  fieldId: z.uuid().optional(),
  /** question: one line or a paragraph. */
  multiline: z.boolean().default(false),
});
export type FormField = z.infer<typeof formFieldSchema>;

export const formInput = z.object({
  name: z.string().trim().min(1, "Name the form").max(120),
  description: z.string().trim().max(2000).default(""),
  fields: z
    .array(formFieldSchema)
    .min(1)
    .max(30, "At most 30 questions")
    .refine(
      (f) => f.filter((x) => x.kind === "title").length === 1,
      "The form needs exactly one title question",
    )
    .refine((f) => new Set(f.map((x) => x.key)).size === f.length, "Duplicate question")
    .refine(
      (f) =>
        ["description", "priority", "due_date", "attachments"].every(
          (k) => f.filter((x) => x.kind === k).length <= 1,
        ),
      "Each built-in question can be added once",
    ),
  statusId: z.uuid().nullable().default(null),
  assigneeIds: z.array(z.uuid()).max(10).default([]),
  submitMessage: z.string().trim().max(500).default(""),
  enabled: z.boolean().default(true),
});
export type FormInput = z.input<typeof formInput>;

export const FORM_KIND_LABELS: Record<FormFieldKind, string> = {
  title: "Ticket title",
  description: "Details (description)",
  priority: "Priority",
  due_date: "Due date",
  custom_field: "Custom field",
  attachments: "Files",
  question: "Extra question (added to the details)",
};

/** Files a response may carry (the whole request must stay under about 5 MB). */
export const FORM_MAX_FILES = 5;
export const FORM_MAX_TOTAL_BYTES = 4 * 1024 * 1024;

export const newFieldKey = () => Math.random().toString(36).slice(2, 10).padEnd(6, "0");
