"use client";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, Copy, ExternalLink, RefreshCw, Trash2, X } from "lucide-react";
import { deleteFormAction, regenerateFormLinkAction, updateFormAction } from "@/modules/forms/actions";
import { FORM_KIND_LABELS, newFieldKey, type FormField, type FormFieldKind } from "@/modules/forms/rules";
import type { ActionState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Option = { id: string; name: string };
type Props = {
  workspaceSlug: string;
  form: {
    id: string;
    name: string;
    description: string;
    fields: FormField[];
    statusId: string | null;
    assigneeIds: string[];
    submitMessage: string;
    enabled: boolean;
    responses: number;
  };
  publicUrl: string;
  statuses: Option[];
  people: Option[];
  customFields: (Option & { type: string })[];
};

const BUILT_IN: FormFieldKind[] = ["description", "priority", "due_date", "attachments"];

/** Build a list's form: its questions (what each fills in on the ticket), settings and link. */
export function FormBuilder({ workspaceSlug, form, publicUrl, statuses, people, customFields }: Props) {
  const [name, setName] = useState(form.name);
  const [description, setDescription] = useState(form.description);
  const [fields, setFields] = useState<FormField[]>(form.fields);
  const [statusId, setStatusId] = useState(form.statusId ?? "");
  const [assigneeIds, setAssigneeIds] = useState(form.assigneeIds);
  const [submitMessage, setSubmitMessage] = useState(form.submitMessage);
  const [enabled, setEnabled] = useState(form.enabled);
  const [result, setResult] = useState<ActionState>(undefined);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const setField = (i: number, patch: Partial<FormField>) =>
    setFields((all) => all.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const move = (i: number, d: -1 | 1) =>
    setFields((all) => {
      const next = [...all];
      const j = i + d;
      if (j < 0 || j >= next.length) return all;
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });
  const add = (kind: FormFieldKind, extra: Partial<FormField> = {}) =>
    setFields((all) => [
      ...all,
      {
        key: newFieldKey(),
        kind,
        label: extra.label ?? FORM_KIND_LABELS[kind].replace(/ \(.*\)$/, ""),
        help: "",
        required: false,
        multiline: kind === "description",
        ...extra,
      },
    ]);
  const used = new Set(fields.map((f) => f.kind));
  const usedFields = new Set(fields.map((f) => f.fieldId).filter(Boolean));

  function save() {
    startTransition(async () => {
      setResult(
        await updateFormAction(workspaceSlug, form.id, {
          name,
          description,
          fields,
          statusId: statusId || null,
          assigneeIds,
          submitMessage,
          enabled,
        }),
      );
    });
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <Card className="content-start">
        <CardHeader>
          <CardTitle>Questions</CardTitle>
          <CardDescription>
            Each answer fills in part of the new ticket. Reorder them with the arrows.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {fields.map((f, i) => {
            const custom = f.kind === "custom_field" ? customFields.find((c) => c.id === f.fieldId) : null;
            return (
              <div
                key={f.key}
                className="grid gap-2 rounded-md border p-3"
                aria-label={`Question: ${f.label}`}
                role="group"
              >
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground flex-1 text-[12px]">
                    {f.kind === "custom_field"
                      ? `Custom field: ${custom?.name ?? "removed"}`
                      : FORM_KIND_LABELS[f.kind]}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Move up"
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Move down"
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown />
                  </Button>
                  {f.kind !== "title" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${f.label}`}
                      onClick={() => setFields((all) => all.filter((_, j) => j !== i))}
                    >
                      <X />
                    </Button>
                  ) : null}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Input
                    aria-label="Question label"
                    value={f.label}
                    onChange={(e) => setField(i, { label: e.target.value })}
                  />
                  <Input
                    aria-label="Help text"
                    placeholder="Help text (optional)"
                    value={f.help}
                    onChange={(e) => setField(i, { help: e.target.value })}
                  />
                </div>
                <div className="flex flex-wrap gap-4 text-[13px]">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={f.kind === "title" || f.required}
                      disabled={f.kind === "title"}
                      onChange={(e) => setField(i, { required: e.target.checked })}
                    />
                    Required
                  </label>
                  {f.kind === "question" ? (
                    <label className="flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={f.multiline}
                        onChange={(e) => setField(i, { multiline: e.target.checked })}
                      />
                      Paragraph answer
                    </label>
                  ) : null}
                </div>
              </div>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <NativeSelect
              aria-label="Add a question"
              value=""
              onChange={(e) => {
                const v = e.target.value;
                if (!v) return;
                if (v.startsWith("cf:")) {
                  const cf = customFields.find((c) => c.id === v.slice(3));
                  if (cf) add("custom_field", { fieldId: cf.id, label: cf.name });
                } else add(v as FormFieldKind, v === "question" ? { label: "Question" } : {});
              }}
              className="h-9 w-64"
            >
              <option value="">+ Add a question…</option>
              {BUILT_IN.filter((k) => !used.has(k)).map((k) => (
                <option key={k} value={k}>
                  {FORM_KIND_LABELS[k]}
                </option>
              ))}
              {customFields.filter((c) => !usedFields.has(c.id)).length ? (
                <optgroup label="Custom fields">
                  {customFields
                    .filter((c) => !usedFields.has(c.id))
                    .map((c) => (
                      <option key={c.id} value={`cf:${c.id}`}>
                        {c.name}
                      </option>
                    ))}
                </optgroup>
              ) : null}
              <option value="question">{FORM_KIND_LABELS.question}</option>
            </NativeSelect>
          </div>
        </CardContent>
      </Card>

      <div className="grid content-start gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Share</CardTitle>
            <CardDescription>
              Anyone with the link can send a request (no account needed). {form.responses} response
              {form.responses === 1 ? "" : "s"} so far.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            <div className="flex min-w-0 gap-2">
              <Input
                aria-label="Form link"
                readOnly
                value={publicUrl}
                className="min-w-0 flex-1 font-mono text-[12px]"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => navigator.clipboard.writeText(publicUrl).then(() => setCopied(true))}
              >
                <Copy /> {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button asChild variant="ghost" size="sm">
                <a href={publicUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink /> Open form
                </a>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => {
                  if (confirm("Make a new link? The current link stops working."))
                    startTransition(async () =>
                      setResult(await regenerateFormLinkAction(workspaceSlug, form.id)),
                    );
                }}
              >
                <RefreshCw /> New link
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Settings</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <Field label="Form name" htmlFor="form-name">
              <Input id="form-name" value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Intro text" htmlFor="form-intro">
              <Textarea
                id="form-intro"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <Field label="New tickets get the status" htmlFor="form-status">
              <NativeSelect
                id="form-status"
                value={statusId}
                onChange={(e) => setStatusId(e.target.value)}
                className="w-full"
              >
                <option value="">The list&apos;s first open status</option>
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <fieldset className="grid gap-1">
              <legend className="mb-1 text-[13px] font-medium">Assign new tickets to</legend>
              {people.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-[13px]">
                  <input
                    type="checkbox"
                    checked={assigneeIds.includes(p.id)}
                    onChange={(e) =>
                      setAssigneeIds((ids) =>
                        e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id),
                      )
                    }
                  />
                  {p.name}
                </label>
              ))}
            </fieldset>
            <Field label="Thank-you message" htmlFor="form-thanks">
              <Input
                id="form-thanks"
                placeholder="Thanks! We got your request."
                value={submitMessage}
                onChange={(e) => setSubmitMessage(e.target.value)}
              />
            </Field>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              Accepting responses
            </label>
          </CardContent>
        </Card>

        {result && !result.ok ? <Alert variant="destructive">{result.message}</Alert> : null}
        {result?.ok && result.message ? (
          <p role="status" className="text-[13px] text-emerald-700 dark:text-emerald-400">
            {result.message}
          </p>
        ) : null}
        <div className="flex flex-wrap justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            className="text-destructive"
            disabled={pending}
            onClick={() => {
              if (confirm(`Delete the form “${form.name}”? Tickets it created stay.`))
                startTransition(async () => setResult(await deleteFormAction(workspaceSlug, form.id)));
            }}
          >
            <Trash2 /> Delete form
          </Button>
          <Button type="button" onClick={save} disabled={pending}>
            {pending ? "Saving…" : "Save form"}
          </Button>
        </div>
      </div>
    </div>
  );
}
