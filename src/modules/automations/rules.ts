import { z } from "zod";

/** Automation definitions, shared by the server (validation, engine) and the editor screen. */
const id = z.uuid();
const priority = z.enum(["urgent", "high", "normal", "low", "none"]);

export const triggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("task_created") }),
  z.object({
    type: z.literal("status_changed"),
    /** Null: any status. */
    fromStatusId: id.nullable().default(null),
    toStatusId: id.nullable().default(null),
  }),
  z.object({ type: z.literal("assignee_added"), userId: id.nullable().default(null) }),
  z.object({ type: z.literal("priority_changed"), priority: priority.nullable().default(null) }),
  z.object({ type: z.literal("comment_added") }),
  z.object({ type: z.literal("qa_concluded"), result: z.enum(["pass", "fail"]).nullable().default(null) }),
]);
export type Trigger = z.infer<typeof triggerSchema>;

export const conditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("status_is"), statusIds: z.array(id).min(1).max(30) }),
  z.object({ type: z.literal("priority_is"), priorities: z.array(priority).min(1) }),
  z.object({ type: z.literal("has_tag"), tagId: id }),
  /** "none": nobody assigned. */
  z.object({ type: z.literal("assignee_is"), userId: z.union([id, z.literal("none")]) }),
  /**
   * A custom field's value: the option id (dropdown), user id (person), true/false (checkbox),
   * a number, a date (YYYY-MM-DD) or text (any case). Null: the field is empty.
   */
  z.object({
    type: z.literal("field_is"),
    fieldId: id,
    value: z.union([z.string().trim().max(500), z.number(), z.boolean(), z.null()]),
  }),
]);
export type Condition = z.infer<typeof conditionSchema>;

export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("set_status"), statusId: id }),
  z.object({ type: z.literal("assign"), userId: id }),
  z.object({ type: z.literal("unassign_all") }),
  z.object({ type: z.literal("set_priority"), priority }),
  z.object({ type: z.literal("add_comment"), body: z.string().trim().min(1).max(5000) }),
  z.object({ type: z.literal("add_tag"), tagId: id }),
  /** Due date = today + days. */
  z.object({ type: z.literal("set_due"), days: z.number().int().min(0).max(365) }),
  z.object({ type: z.literal("send_webhook"), endpointId: id }),
  /** Add, remove or replace assignees. `reassign` (when not empty) replaces everyone. */
  z.object({
    type: z.literal("update_assignees"),
    add: z.array(id).max(20).default([]),
    remove: z.array(id).max(20).default([]),
    reassign: z.array(id).max(20).default([]),
    removeAll: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("update_followers"),
    add: z.array(id).max(20).default([]),
    remove: z.array(id).max(20).default([]),
  }),
  /** POST the task to a web address (e.g. a Make webhook), typed straight into the automation. */
  z.object({ type: z.literal("call_url"), url: z.string().trim().min(1, "Enter the address").max(2000) }),
]);
export type Action = z.infer<typeof actionSchema>;

export const automationInput = z.object({
  name: z.string().trim().min(1, "Name it").max(120),
  listId: id.nullable().default(null),
  enabled: z.boolean().default(true),
  trigger: triggerSchema,
  conditions: z.array(conditionSchema).max(10).default([]),
  actions: z.array(actionSchema).min(1, "Add at least one action").max(10),
});
export type AutomationInput = z.input<typeof automationInput>;

export const TRIGGER_LABELS: Record<Trigger["type"], string> = {
  task_created: "A task is created",
  status_changed: "The status changes",
  assignee_added: "Someone is assigned",
  priority_changed: "The priority changes",
  comment_added: "A comment is added",
  qa_concluded: "A QA round is concluded",
};

export const CONDITION_LABELS: Record<Condition["type"], string> = {
  status_is: "Status is",
  priority_is: "Priority is",
  has_tag: "Has the tag",
  assignee_is: "Assigned to",
  field_is: "Custom field",
};

export const ACTION_LABELS: Record<Action["type"], string> = {
  set_status: "Change status to",
  assign: "Assign",
  unassign_all: "Unassign everyone",
  set_priority: "Set priority to",
  add_comment: "Add a comment",
  add_tag: "Add the tag",
  set_due: "Set due date",
  send_webhook: "Send to a saved webhook",
  update_assignees: "Update assignees",
  update_followers: "Update followers",
  call_url: "Call webhook (Make)",
};

/** What the editor offers (older kinds stay valid for automations that already use them). */
export const EDITOR_ACTIONS: Action["type"][] = [
  "set_status",
  "update_assignees",
  "update_followers",
  "set_priority",
  "add_comment",
  "add_tag",
  "set_due",
  "call_url",
  "send_webhook",
];

/** How many automations may trigger one another before the loop guard stops them. */
export const MAX_CHAIN_DEPTH = 3;
