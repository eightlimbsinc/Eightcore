"use client";
import { useState, useTransition } from "react";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import {
  deleteTransitionAction,
  saveTransitionAction,
  setTransitionsStrictAction,
} from "@/modules/lists/actions";
import { StatusIcon, type StatusOption } from "@/components/tasks/status-menu";
import { cn } from "@/lib/utils";

export interface RuleView {
  id: string;
  fromStatusId: string | null;
  toStatusId: string;
  minRole: "editor" | "manager";
  requireComment: boolean;
  requiredFieldIds: string[];
  qaAction: "start" | "pass" | "fail" | null;
}

const select = "border-input bg-surface h-8 rounded-md border px-2 text-[13px]";

/**
 * A list's status rules: "from (any) → to" with who may move, whether a comment is needed and
 * which fields must be filled in. Strict mode allows only the listed moves.
 */
export function TransitionRules({
  workspaceSlug,
  listId,
  statuses,
  fields,
  rules,
  strict,
  canEdit,
}: {
  workspaceSlug: string;
  listId: string;
  statuses: StatusOption[];
  fields: { id: string; name: string }[];
  rules: RuleView[];
  strict: boolean;
  canEdit: boolean;
}) {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const name = (id: string | null) => (id ? (statuses.find((s) => s.id === id)?.name ?? "?") : "Any status");
  const run = (fn: () => Promise<{ ok: boolean; message?: string } | undefined>) =>
    startTransition(async () => {
      const result = await fn();
      setMessage(result ? { ok: result.ok, text: result.message ?? (result.ok ? "Saved" : "") } : null);
    });

  return (
    <div className="grid gap-4">
      <label className={cn("flex items-start gap-2 text-[13px]", !canEdit && "opacity-70")}>
        <input
          type="checkbox"
          checked={strict}
          disabled={!canEdit || pending}
          onChange={(e) => run(() => setTransitionsStrictAction(workspaceSlug, listId, e.target.checked))}
          className="accent-accent mt-0.5"
        />
        <span>
          <span className="font-medium">Only allow the moves listed below</span>
          <span className="text-muted-foreground block text-[12px]">
            Off: tasks can move anywhere, and the rules only add requirements. On: a move without a rule is
            refused.
          </span>
        </span>
      </label>

      {rules.length ? (
        <ul className="divide-y rounded-md border" aria-label="Status rules">
          {rules.map((r) => (
            <RuleRow
              key={r.id}
              rule={r}
              name={name}
              statuses={statuses}
              fields={fields}
              canEdit={canEdit}
              pending={pending}
              onSave={(next) => run(() => saveTransitionAction(workspaceSlug, listId, next))}
              onDelete={() => {
                if (!confirm(`Remove the rule ${name(r.fromStatusId)} → ${name(r.toStatusId)}?`)) return;
                run(() => deleteTransitionAction(workspaceSlug, r.id));
              }}
            />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-[13px]">
          No rules yet: anyone who can edit tasks can move them anywhere.
        </p>
      )}

      {canEdit ? (
        <NewRule
          statuses={statuses}
          pending={pending}
          onAdd={(rule) => run(() => saveTransitionAction(workspaceSlug, listId, rule))}
        />
      ) : null}
      {message?.text ? (
        <p role="status" className={cn("text-[13px]", message.ok ? "text-success" : "text-destructive")}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

function RuleRow({
  rule: saved,
  name,
  statuses,
  fields,
  canEdit,
  pending,
  onSave,
  onDelete,
}: {
  rule: RuleView;
  name: (id: string | null) => string;
  statuses: StatusOption[];
  fields: { id: string; name: string }[];
  canEdit: boolean;
  pending: boolean;
  onSave: (rule: Omit<RuleView, "id">) => void;
  onDelete: () => void;
}) {
  // Changes show at once; the saved rule replaces the draft when it comes back.
  const [draft, setDraft] = useState(saved);
  const [seen, setSeen] = useState(saved);
  if (seen !== saved) {
    setSeen(saved);
    setDraft(saved);
  }
  const rule = draft;
  const save = (patch: Partial<RuleView>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    onSave(next);
  };
  const status = (id: string | null) => statuses.find((s) => s.id === id);
  const label = `${name(rule.fromStatusId)} to ${name(rule.toStatusId)}`;
  return (
    <li className="grid gap-2 px-3 py-3" role="group" aria-label={`Rule ${label}`}>
      <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
        {status(rule.fromStatusId) ? <StatusIcon status={status(rule.fromStatusId)!} /> : null}
        {name(rule.fromStatusId)}
        <ArrowRight className="text-muted-foreground size-3.5" aria-hidden />
        {status(rule.toStatusId) ? <StatusIcon status={status(rule.toStatusId)!} /> : null}
        {name(rule.toStatusId)}
        {canEdit ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={pending}
            aria-label={`Remove rule ${label}`}
            className="text-muted-foreground hover:text-destructive ml-auto grid size-7 place-items-center rounded-sm"
          >
            <Trash2 className="size-3.5" />
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
        <label className="flex items-center gap-2">
          Who
          <select
            value={rule.minRole}
            disabled={!canEdit || pending}
            onChange={(e) => save({ minRole: e.target.value as RuleView["minRole"] })}
            aria-label={`Who can make the move ${label}`}
            className={select}
          >
            <option value="editor">Editors and managers</option>
            <option value="manager">Managers only</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          QA
          <select
            value={rule.qaAction ?? ""}
            disabled={!canEdit || pending}
            onChange={(e) => save({ qaAction: (e.target.value || null) as RuleView["qaAction"] })}
            aria-label={`QA for the move ${label}`}
            className={select}
          >
            <option value="">No QA step</option>
            <option value="start">Starts a QA round</option>
            <option value="pass">Passes QA</option>
            <option value="fail">Fails QA (asks what failed)</option>
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={rule.requireComment}
            disabled={!canEdit || pending}
            onChange={(e) => save({ requireComment: e.target.checked })}
            aria-label={`Needs a comment: ${label}`}
            className="accent-accent"
          />
          Needs a comment
        </label>
        {fields.length ? (
          <fieldset className="flex flex-wrap items-center gap-2">
            <legend className="sr-only">Fields that must be filled in</legend>
            <span className="text-muted-foreground">Must be filled in:</span>
            {fields.map((f) => {
              const on = rule.requiredFieldIds.includes(f.id);
              return (
                <label
                  key={f.id}
                  className={cn(
                    "has-[:checked]:bg-accent-soft/60 flex items-center gap-1.5 rounded-md border px-1.5 py-0.5",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={!canEdit || pending}
                    onChange={() =>
                      save({
                        requiredFieldIds: on
                          ? rule.requiredFieldIds.filter((id) => id !== f.id)
                          : [...rule.requiredFieldIds, f.id],
                      })
                    }
                    className="accent-accent"
                  />
                  {f.name}
                </label>
              );
            })}
          </fieldset>
        ) : null}
      </div>
    </li>
  );
}

function NewRule({
  statuses,
  pending,
  onAdd,
}: {
  statuses: StatusOption[];
  pending: boolean;
  onAdd: (rule: Omit<RuleView, "id">) => void;
}) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(statuses[0]?.id ?? "");
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd({
          fromStatusId: from || null,
          toStatusId: to,
          minRole: "editor",
          requireComment: false,
          requiredFieldIds: [],
          qaAction: null,
        });
      }}
    >
      <span className="text-[13px] font-medium">New rule:</span>
      <select
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        aria-label="From status"
        className={select}
      >
        <option value="">Any status</option>
        {statuses.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <ArrowRight className="text-muted-foreground size-3.5" aria-hidden />
      <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="To status" className={select}>
        {statuses.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending || !to}
        className="hover:bg-surface-muted inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[13px]"
      >
        <Plus className="size-3.5" aria-hidden /> Add rule
      </button>
    </form>
  );
}
