"use client";
import { useActionState, useRef, useState, useTransition } from "react";
import { FORM_MAX_FILES } from "@/modules/forms/rules";
import { DIRECT_UPLOAD_MAX_BYTES, THROUGH_APP_MAX_BYTES, uploadFile } from "@/lib/direct-upload";
import { startFormUploadsAction, submitFormAction, type SubmitFormState } from "@/modules/forms/actions";
import { Button } from "@/components/ui/button";
import { Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Check, Loader2, Paperclip, Plus, RotateCw, X } from "lucide-react";

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

function Control({ q, files }: { q: Question; files: React.ReactNode }) {
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
  if (q.kind === "attachments") return files;
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

const size = (n: number) =>
  n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

type Item = {
  key: string;
  file: File;
  /** uploading → done; "send": couldn't go straight to storage, small enough to go with the form. */
  status: "uploading" | "done" | "send" | "error" | "too-big";
  loaded: number;
  uploadId?: string;
  error?: string;
};

/** What a file question tells the form: still uploading, or something to fix first. */
export type FilesState = { busy: boolean; problem: string | null; count: number };

/**
 * A file question. Files start uploading as soon as they're picked, each with its own progress
 * bar, so people see them arrive before pressing Submit. Picking again adds more files (for
 * people who don't know how to select several at once); each file can be removed or retried.
 */
function FilesControl({
  token,
  q,
  onChange,
}: {
  token: string;
  q: Question;
  onChange: (state: FilesState) => void;
}) {
  const id = `q-${q.key}`;
  const picker = useRef<HTMLInputElement>(null);
  const fallback = useRef<HTMLInputElement>(null);
  const [items, setItemsState] = useState<Item[]>([]);
  const itemsRef = useRef<Item[]>([]);

  const setItems = (update: (current: Item[]) => Item[]) => {
    const next = update(itemsRef.current);
    itemsRef.current = next;
    setItemsState(next);
    // Files that go with the form (not uploaded straight to storage) ride in a hidden input.
    try {
      const all = new DataTransfer();
      next.filter((i) => i.status === "send").forEach((i) => all.items.add(i.file));
      if (fallback.current) fallback.current.files = all.files;
    } catch {
      // Very old browsers: no fallback files.
    }
    const tooBig = next.find((i) => i.status === "too-big");
    const failed = next.find((i) => i.status === "error");
    onChange({
      busy: next.some((i) => i.status === "uploading"),
      problem: tooBig
        ? `“${tooBig.file.name}” is over 25 MB. Remove it, or paste a link (Loom, Google Drive…) instead.`
        : failed
          ? `“${failed.file.name}” didn't upload. Retry it or remove it.`
          : null,
      count: next.filter((i) => i.status === "done" || i.status === "send").length,
    });
  };
  const patch = (key: string, change: Partial<Item>) =>
    setItems((all) => all.map((i) => (i.key === key ? { ...i, ...change } : i)));

  const upload = async (batch: Item[]) => {
    if (!batch.length) return;
    let started: Awaited<ReturnType<typeof startFormUploadsAction>> | null = null;
    try {
      started = await startFormUploadsAction(
        token,
        q.key,
        batch.map((i) => ({ name: i.file.name, size: i.file.size })),
      );
    } catch {
      started = null;
    }
    const failed = (item: Item, message: string) => {
      // Small files can still go along with the form itself.
      const alongside = itemsRef.current
        .filter((i) => i.status === "send")
        .reduce((sum, i) => sum + i.file.size, 0);
      if (alongside + item.file.size <= THROUGH_APP_MAX_BYTES) patch(item.key, { status: "send" });
      else patch(item.key, { status: "error", error: message });
    };
    if (!started?.ok) {
      const message = started && !started.ok ? started.message : "Couldn't start the upload.";
      batch.forEach((i) => failed(i, message));
      return;
    }
    await Promise.all(
      batch.map(async (item, n) => {
        const target = started.uploads[n]!;
        try {
          await uploadFile(target.url, item.file, (loaded) => patch(item.key, { loaded }));
          // Removed while uploading: nothing to update.
          if (itemsRef.current.some((i) => i.key === item.key))
            patch(item.key, { status: "done", uploadId: target.id, loaded: item.file.size });
        } catch {
          if (itemsRef.current.some((i) => i.key === item.key)) failed(item, "The upload didn't go through.");
        }
      }),
    );
  };

  const add = (picked: File[]) => {
    const room = FORM_MAX_FILES - itemsRef.current.length;
    const fresh = picked.slice(0, Math.max(0, room)).map((file): Item => ({
      key: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      status: file.size > DIRECT_UPLOAD_MAX_BYTES ? "too-big" : "uploading",
      loaded: 0,
    }));
    setItems((all) => [...all, ...fresh]);
    void upload(fresh.filter((i) => i.status === "uploading"));
  };

  return (
    <>
      {/* The real picker is visually hidden: the buttons below open it, and the list shows the files. */}
      <input
        id={id}
        ref={picker}
        type="file"
        multiple
        className="sr-only"
        aria-describedby={q.help ? `${id}-help` : undefined}
        disabled={items.length >= FORM_MAX_FILES}
        onChange={(e) => {
          add([...(e.currentTarget.files ?? [])]);
          e.currentTarget.value = ""; // so the same file can be picked again after removing it
        }}
      />
      {items.length === 0 ? (
        <Button
          type="button"
          variant="outline"
          className="justify-self-start"
          onClick={() => picker.current?.click()}
        >
          <Paperclip aria-hidden /> Choose files
        </Button>
      ) : null}
      {/* Small files that couldn't go straight to storage are sent with the form instead. */}
      <input ref={fallback} type="file" name={q.key} multiple hidden tabIndex={-1} aria-hidden />
      {items
        .filter((i) => i.status === "done" && i.uploadId)
        .map((i) => (
          <input key={i.key} type="hidden" name={`${q.key}__upload`} value={`${i.uploadId}|${i.file.name}`} />
        ))}
      {items.length ? (
        <>
          <ul aria-label="Attached files" className="grid gap-2 text-[13px]">
            {items.map((item) => {
              const percent = Math.min(100, Math.round((item.loaded / Math.max(1, item.file.size)) * 100));
              const bad = item.status === "too-big" || item.status === "error";
              return (
                <li key={item.key} className="grid gap-1">
                  <div className="flex items-center gap-2">
                    {item.status === "uploading" ? (
                      <Loader2 className="text-accent size-4 shrink-0 animate-spin" aria-hidden />
                    ) : bad ? (
                      <X className="text-destructive size-4 shrink-0" aria-hidden />
                    ) : (
                      <Check className="size-4 shrink-0 text-emerald-600" aria-hidden />
                    )}
                    <span className="min-w-0 truncate">{item.file.name}</span>
                    <span className={bad ? "text-destructive shrink-0" : "text-muted-foreground shrink-0"}>
                      {item.status === "uploading"
                        ? `Uploading… ${percent}%`
                        : item.status === "too-big"
                          ? `${size(item.file.size)} · over 25 MB`
                          : item.status === "error"
                            ? "Didn't upload"
                            : `${size(item.file.size)} · Attached`}
                    </span>
                    <span className="ml-auto flex shrink-0 items-center gap-3">
                      {item.status === "error" ? (
                        <button
                          type="button"
                          onClick={() => {
                            patch(item.key, { status: "uploading", loaded: 0, error: undefined });
                            void upload([{ ...item, status: "uploading", loaded: 0 }]);
                          }}
                          className="text-foreground inline-flex items-center gap-1 text-[12px] underline-offset-2 hover:underline"
                        >
                          <RotateCw className="size-3" aria-hidden /> Retry
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setItems((all) => all.filter((i) => i.key !== item.key))}
                        aria-label={`Remove ${item.file.name}`}
                        className="text-muted-foreground hover:text-foreground text-[12px] underline-offset-2 hover:underline"
                      >
                        Remove
                      </button>
                    </span>
                  </div>
                  {item.status === "uploading" ? (
                    <div
                      role="progressbar"
                      aria-label={`Uploading ${item.file.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={percent}
                      className="bg-surface-muted ml-6 h-1.5 overflow-hidden rounded-full"
                    >
                      <div
                        className="bg-accent h-full rounded-full transition-[width] duration-200"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {items.length < FORM_MAX_FILES ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() => picker.current?.click()}
            >
              <Plus aria-hidden /> Add more files
            </Button>
          ) : null}
        </>
      ) : null}
      <span className="text-muted-foreground text-[12px]">
        Up to {FORM_MAX_FILES} files, 25 MB each. For bigger videos, paste a link instead.
      </span>
    </>
  );
}

/** The public form: answers in, a ticket out, with a thank-you message. */
export function PublicForm({ token, form }: { token: string; form: Form }) {
  // A new round starts the form afresh (and forgets the last result).
  const [round, setRound] = useState(0);
  return <FormRound key={round} token={token} form={form} onAgain={() => setRound((r) => r + 1)} />;
}

function FormRound({ token, form, onAgain }: { token: string; form: Form; onAgain: () => void }) {
  const [files, setFiles] = useState<Record<string, FilesState>>({});
  const uploading = Object.values(files).some((f) => f.busy);
  const attached = Object.values(files).reduce((sum, f) => sum + f.count, 0);
  // File questions changed since the last Submit: their old error no longer applies.
  const [filesAtSubmit, setFilesAtSubmit] = useState(files);
  const [state, action, pending] = useActionState<SubmitFormState, FormData>(async (prev, data) => {
    // Files were uploaded when picked; anything still wrong with them is fixed first.
    const errors: Record<string, string> = {};
    for (const [key, f] of Object.entries(files)) {
      if (f.busy) errors[key] = "Still uploading. Submit again once the files show “Attached”.";
      else if (f.problem) errors[key] = f.problem;
    }
    if (Object.keys(errors).length)
      return { ok: false, errors, message: "Please check the highlighted answers." };
    try {
      return await submitFormAction(token, prev, data);
    } catch {
      return {
        ok: false,
        errors: {},
        message: "We couldn't send your response. Check your connection, then try again.",
      };
    }
  }, undefined);
  const [, startTransition] = useTransition();
  if (state?.ok)
    return (
      <div className="bg-surface rounded-xl border p-8 text-center" role="status">
        <h1 className="text-xl font-semibold">{state.message}</h1>
        {attached ? (
          <p className="text-muted-foreground mt-2 flex items-center justify-center gap-1.5 text-[14px]">
            <Check className="size-4 text-emerald-600" aria-hidden />
            {attached === 1 ? "Your file was attached." : `All ${attached} files were attached.`}
          </p>
        ) : null}
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
        setFilesAtSubmit(files);
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
          <Control
            q={q}
            files={
              q.kind === "attachments" ? (
                <FilesControl
                  token={token}
                  q={q}
                  onChange={(next) => setFiles((all) => ({ ...all, [q.key]: next }))}
                />
              ) : null
            }
          />
          {errors[q.key] && !(q.kind === "attachments" && files[q.key] !== filesAtSubmit[q.key]) ? (
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
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || uploading}>
          {pending ? "Sending…" : "Submit"}
        </Button>
        {uploading ? (
          <span className="text-muted-foreground text-[13px]" role="status">
            Waiting for your files to finish uploading…
          </span>
        ) : null}
      </div>
    </form>
  );
}
