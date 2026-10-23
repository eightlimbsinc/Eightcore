import { z } from "zod";

export const FIELD_TYPES = ["text", "number", "date", "dropdown", "checkbox", "person", "url"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: "Text",
  number: "Number",
  date: "Date",
  dropdown: "Dropdown",
  checkbox: "Checkbox",
  person: "Person",
  url: "Link",
};

export const OPTION_COLORS = [
  "#64748b",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
];

const fieldName = z.string().trim().min(1, "Name is required").max(60, "Use at most 60 characters");
const optionLabel = z.string().trim().min(1, "Option is required").max(60, "Use at most 60 characters");

export const createFieldInput = z.object({
  name: fieldName,
  type: z.enum(FIELD_TYPES, { message: "Pick a type" }),
  /** Null: every list in the project. */
  listId: z.uuid().nullable().default(null),
  /** Dropdown choices, in order. */
  options: z.array(optionLabel).max(50, "At most 50 options").default([]),
});
export type CreateFieldInput = z.input<typeof createFieldInput>;

export const renameFieldInput = z.object({ name: fieldName });
export const optionInput = z.object({ label: optionLabel });

/** "Design, Build, QA" or one per line → ["Design", "Build", "QA"] (blank entries dropped). */
export function splitOptions(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A typed value ready to store, or null to clear the field. */
export type StoredValue =
  | { valueText: string }
  | { valueNumber: string }
  | { valueDate: string }
  | { valueBool: true }
  | { valueOptionId: string }
  | { valueUserId: string }
  | null;

const NUMBER_RE = /^-?\d{1,15}(\.\d{1,6})?$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Turns form text into a stored value for a field type. Throws a message for bad input.
 * An empty string (or an unticked checkbox) clears the value.
 */
export function parseFieldValue(type: FieldType, raw: string): StoredValue {
  const value = raw.trim();
  if (value === "" || (type === "checkbox" && value !== "on" && value !== "true")) return null;
  switch (type) {
    case "text":
      if (value.length > 2000) throw new Error("Use at most 2,000 characters");
      return { valueText: value };
    case "number": {
      const normalised = value.replace(/,/g, "");
      if (!NUMBER_RE.test(normalised)) throw new Error("Enter a number");
      return { valueNumber: normalised };
    }
    case "date":
      if (!z.iso.date().safeParse(value).success) throw new Error("Use a valid date");
      return { valueDate: value };
    case "checkbox":
      return { valueBool: true };
    case "dropdown":
      if (!UUID_RE.test(value)) throw new Error("Pick an option");
      return { valueOptionId: value };
    case "person":
      if (!UUID_RE.test(value)) throw new Error("Pick a person");
      return { valueUserId: value };
    case "url": {
      let url: URL;
      try {
        url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`);
      } catch {
        throw new Error("Enter a web address");
      }
      // Only web links: no javascript:, data: or file: URLs.
      if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Use an http or https link");
      if (url.href.length > 2000) throw new Error("That link is too long");
      return { valueText: url.href };
    }
  }
}
