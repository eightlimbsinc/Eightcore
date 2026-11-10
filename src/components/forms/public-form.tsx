"use client";
import { useActionState, useState, useTransition } from "react";
import { FORM_MAX_FILES, FORM_MAX_TOTAL_BYTES } from "@/modules/forms/rules";
import { submitFormAction, type SubmitFormState } from "@/modules/forms/actions";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";

type Question = {
  key: string;
  kind: string;
  label: string;
  help: string;
  required: boolean;
  multiline: boolean;
  type: string | null;
  options: { id: string; label: string }[];
};
type Form = { workspaceName: string; name: string; description: string; fields: Question[] };

const PRIORITIES = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "High" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low" },
];

function Control({ q }: { q: Question }) {
  const id = `q-${q.key}`;
  const common = {
    id,
    name: q.key,
    required: q.required,
    "aria-describedby": q.help ? `${id}-help` : undefined,
  };
  if (
    q.kind === "description" ||
    (q.kind === "question" && q.multiline) ||
    (q.kind === "custom_field" && q.type === "text" && q.multiline)
  )
    return <Textarea {...common} rows={5} maxLength={15_000} />;
  if (q.kind === "priority")
    return (
      <NativeSelect {...common} defaultValue="" className="w-full">
        <option value="">Select priority…</option>
        {PRIORITIES.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </NativeSelect>
    );
  if (q.kind === "due_date") return <Input {...common} type="date" />;
  if (q.kind === "attachments")
    return (
      <>
        <Input {...common} type="file" multiple />
        <span className="text-muted-foreground text-[12px]">
          Up to {FORM_MAX_FILES} files, {FORM_MAX_TOTAL_BYTES / 1024 / 1024} MB in total. For bigger videos,
          paste a link instead.
        </span>
      </>
    );
  if (q.kind === "custom_field") {
    switch (q.type) {
      case "dropdown":
        return (
          <NativeSelect {...common} defaultValue="" className="w-full">
            <option value="">Select an option…</option>
            {q.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        );
      case "number":
        return <Input {...common} type="number" step="any" />;
      case "date":
        return <Input {...common} type="date" />;
      case "url":
        return <Input {...common} type="url" placeholder="https://" />;
      case "checkbox":
        return (
          <label className="flex items-center gap-2 text-[14px]">
            <input id={id} name={q.key} type="checkbox" /> Yes
          </label>
        );
      default:
        return <Input {...common} maxLength={500} />;
    }
  }
  return <Input {...common} maxLength={q.kind === "title" ? 500 : 3000} />;
}

/** The public form: answers in, a ticket out, with a thank-you message. */
export function PublicForm({ token, form }: { token: string; form: Form }) {
  // A new round starts the form afresh (and forgets the last result).
  const [round, setRound] = useState(0);
  return <FormRound key={round} token={token} form={form} onAgain={() => setRound((r) => r + 1)} />;
}

function FormRound({ token, form, onAgain }: { token: string; form: Form; onAgain: () => void }) {
  const [state, action, pending] = useActionState<SubmitFormState, FormData>(async (prev, data) => {
    // Too-big files never reach us (the host refuses them), so check here first.
    const errors: Record<string, string> = {};
    for (const q of form.fields.filter((f) => f.kind === "attachments")) {
      const files = data.getAll(q.key).filter((v): v is File => v instanceof File && v.size > 0);
      const total = files.reduce((sum, f) => sum + f.size, 0);
      if (files.length > FORM_MAX_FILES) errors[q.key] = `At most ${FORM_MAX_FILES} files`;
      else if (total > FORM_MAX_TOTAL_BYTES)
        errors[q.key] =
          `Files can be at most ${FORM_MAX_TOTAL_BYTES / 1024 / 1024} MB together (these are ${(total / 1024 / 1024).toFixed(1)} MB). For a bigger video, paste a link (Loom, Google Drive…) instead.`;
    }
    if (Object.keys(errors).length)
      return { ok: false, errors, message: "Please check the highlighted answers." };
    try {
      return await submitFormAction(token, prev, data);
    } catch {
      return {
        ok: false,
        errors: {},
        message:
          "We couldn't send your response. Check your connection (and keep files small), then try again.",
      };
    }
  }, undefined);
  const [, startTransition] = useTransition();
  if (state?.ok)
    return (
      <div className="bg-surface rounded-xl border p-8 text-center" role="status">
        <h1 className="text-xl font-semibold">{state.message}</h1>
        <Button type="button" variant="outline" className="mt-4" onClick={onAgain}>
          Send another response
        </Button>
      </div>
    );
  const errors = state && !state.ok ? state.errors : {};
  return (
    <form
      // Sent by hand (not as the form's action) so answers stay filled in if something needs fixing.
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="bg-surface grid gap-5 rounded-xl border p-6 sm:p-8"
      noValidate
    >
      <div className="grid gap-1">
        <p className="text-muted-foreground text-[12px] tracking-wide uppercase">{form.workspaceName}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{form.name}</h1>
        {form.description ? (
          <p className="text-muted-foreground text-[14px] whitespace-pre-wrap">{form.description}</p>
        ) : null}
      </div>
      {state && !state.ok && state.message ? <Alert variant="destructive">{state.message}</Alert> : null}
      {form.fields.map((q) => (
        <div key={q.key} className="grid gap-1.5">
          <label htmlFor={`q-${q.key}`} className="text-[14px] font-medium">
            {q.label}
            {q.required || q.kind === "title" ? <span className="text-destructive"> *</span> : null}
          </label>
          {q.help ? (
            <p id={`q-${q.key}-help`} className="text-muted-foreground text-[12px]">
              {q.help}
            </p>
          ) : null}
          <Control q={q} />
          {errors[q.key] ? (
            <p className="text-destructive text-[12px]" role="alert">
              {errors[q.key]}
            </p>
          ) : null}
        </div>
      ))}
      {/* Spam trap: hidden from people, filled in by bots. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website <input name="_website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Submit"}
        </Button>
      </div>
    </form>
  );
}
