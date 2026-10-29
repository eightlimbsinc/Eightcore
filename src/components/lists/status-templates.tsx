"use client";
import { useActionState, useState, useTransition } from "react";
import { BookmarkPlus, Trash2 } from "lucide-react";
import {
  applyStatusTemplateAction,
  deleteStatusTemplateAction,
  saveStatusTemplateAction,
} from "@/modules/lists/actions";
import { STATUS_TEMPLATES, type StatusCategory, type StatusTemplateKey } from "@/modules/lists/templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { StatusIcon } from "@/components/tasks/status-menu";

export interface SavedTemplate {
  id: string;
  name: string;
  statuses: { name: string; category: StatusCategory; color: string }[];
  canDelete: boolean;
}

/** A template's statuses as a row of small labelled icons. */
export function TemplatePreview({ statuses }: { statuses: SavedTemplate["statuses"] }) {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Statuses">
      {statuses.map((s) => (
        <li key={s.name} className="text-muted-foreground flex items-center gap-1 text-[12px]">
          <StatusIcon status={s} className="size-3.5" />
          {s.name}
        </li>
      ))}
    </ul>
  );
}

/**
 * Save this list's statuses as a workspace template, or replace them with a template
 * (built-in or saved). Applying keeps every task: unmatched statuses' tasks move to the
 * closest status in the template.
 */
export function StatusTemplatesPanel({
  workspaceSlug,
  listId,
  saved,
}: {
  workspaceSlug: string;
  listId: string;
  saved: SavedTemplate[];
}) {
  const [saveState, saveAction, saving] = useActionState(
    saveStatusTemplateAction.bind(null, workspaceSlug, listId),
    undefined,
  );
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const templates: {
    key: string;
    name: string;
    statuses: SavedTemplate["statuses"];
    source: Parameters<typeof applyStatusTemplateAction>[2];
    canDelete: boolean;
    id?: string;
  }[] = [
    ...Object.entries(STATUS_TEMPLATES).map(([key, t]) => ({
      key: `builtin:${key}`,
      name: t.label,
      statuses: t.statuses as unknown as SavedTemplate["statuses"],
      source: { builtin: key as StatusTemplateKey },
      canDelete: false,
    })),
    ...saved.map((t) => ({
      key: t.id,
      id: t.id,
      name: t.name,
      statuses: t.statuses,
      source: { id: t.id },
      canDelete: t.canDelete,
    })),
  ];

  const apply = (name: string, source: Parameters<typeof applyStatusTemplateAction>[2]) => {
    if (
      !confirm(
        `Replace this list's statuses with “${name}”?\n\nStatuses with the same name are kept. Others are removed and their tasks move to the closest status in the template. No tasks are lost.`,
      )
    )
      return;
    startTransition(async () => {
      const result = await applyStatusTemplateAction(workspaceSlug, listId, source);
      setMessage(result ? { ok: result.ok, text: result.message ?? "Template applied" } : null);
    });
  };
  const remove = (id: string, name: string) => {
    if (!confirm(`Delete the template “${name}”? Lists that used it keep their statuses.`)) return;
    startTransition(async () => {
      const result = await deleteStatusTemplateAction(workspaceSlug, id);
      setMessage(
        result && !result.ok ? { ok: false, text: result.message } : { ok: true, text: `Deleted “${name}”` },
      );
    });
  };

  return (
    <div className="grid gap-5">
      <form action={saveAction} className="grid gap-2">
        <label htmlFor="template-name" className="text-[13px] font-medium">
          Save this list&apos;s statuses as a template
        </label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="template-name"
            name="name"
            required
            maxLength={60}
            placeholder="e.g. Podcast flow"
            className="max-w-72"
          />
          <Button type="submit" variant="outline" disabled={saving}>
            <BookmarkPlus /> {saving ? "Saving…" : "Save as template"}
          </Button>
        </div>
        {saveState ? (
          <Alert variant={saveState.ok ? "success" : "destructive"}>
            {saveState.ok ? saveState.message : (saveState.fieldErrors?.form ?? saveState.message)}
          </Alert>
        ) : null}
      </form>

      <div className="grid gap-2">
        <h3 className="text-[13px] font-medium">Apply a template</h3>
        {message ? <Alert variant={message.ok ? "success" : "destructive"}>{message.text}</Alert> : null}
        <ul className="divide-y rounded-md border" aria-label="Status templates">
          {templates.map((t) => (
            <li key={t.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5">
              <div className="grid min-w-0 flex-1 gap-1">
                <span className="text-[13px] font-medium">
                  {t.name}
                  {t.key.startsWith("builtin:") ? (
                    <span className="text-muted-foreground ml-2 text-[11px] font-normal">Built-in</span>
                  ) : null}
                </span>
                <TemplatePreview statuses={t.statuses} />
              </div>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  aria-label={`Apply ${t.name}`}
                  onClick={() => apply(t.name, t.source)}
                >
                  Apply
                </Button>
                {t.canDelete && t.id ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    aria-label={`Delete template ${t.name}`}
                    onClick={() => remove(t.id!, t.name)}
                  >
                    <Trash2 />
                  </Button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
