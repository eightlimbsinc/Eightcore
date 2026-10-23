// Starting points for a new list's statuses. After creation each list's statuses are its own.
export type StatusCategory = "backlog" | "unstarted" | "active" | "review" | "done" | "cancelled";

export interface StatusTemplate {
  name: string;
  category: StatusCategory;
  color: string;
}

export const STATUS_TEMPLATES = {
  agency: {
    label: "Agency delivery",
    description: "Backlog → development → QA → production → accepted",
    statuses: [
      { name: "Backlog", category: "backlog", color: "#8B8B93" },
      { name: "To Do", category: "unstarted", color: "#A1A1AA" },
      { name: "Ready for Dev", category: "unstarted", color: "#60A5FA" },
      { name: "In Development", category: "active", color: "#3B82F6" },
      { name: "Ready to Test", category: "review", color: "#A78BFA" },
      { name: "Testing in Staging", category: "review", color: "#8B5CF6" },
      { name: "Final Review", category: "review", color: "#C9A96E" },
      { name: "Push to Production", category: "active", color: "#F59E0B" },
      { name: "Accepted", category: "done", color: "#22C55E" },
      { name: "Cancelled", category: "cancelled", color: "#EF4444" },
    ],
  },
  simple: {
    label: "Simple",
    description: "To Do → In Progress → Done",
    statuses: [
      { name: "To Do", category: "unstarted", color: "#A1A1AA" },
      { name: "In Progress", category: "active", color: "#3B82F6" },
      { name: "Done", category: "done", color: "#22C55E" },
    ],
  },
} as const satisfies Record<
  string,
  { label: string; description: string; statuses: readonly StatusTemplate[] }
>;

export type StatusTemplateKey = keyof typeof STATUS_TEMPLATES;

export const STATUS_CATEGORIES: { value: StatusCategory; label: string }[] = [
  { value: "backlog", label: "Backlog" },
  { value: "unstarted", label: "Not started" },
  { value: "active", label: "In progress" },
  { value: "review", label: "In review" },
  { value: "done", label: "Done" },
  { value: "cancelled", label: "Cancelled" },
];

/** Tasks in these categories count as finished (completed_at is set). */
export function isClosedCategory(category: StatusCategory): boolean {
  return category === "done" || category === "cancelled";
}
