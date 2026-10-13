"use client";
import { useActionState, useState } from "react";
import { createProjectAction } from "@/modules/projects/actions";
import { suggestProjectKey } from "@/modules/projects/validators";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

export function CreateProjectForm({ workspaceSlug }: { workspaceSlug: string }) {
  const [state, action, pending] = useActionState(createProjectAction.bind(null, workspaceSlug), undefined);
  const [key, setKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="grid max-w-xl gap-5">
      {state && !state.ok && !errors ? <Alert variant="destructive">{state.message}</Alert> : null}
      <Field label="Project name" htmlFor="name" error={errors?.name}>
        <Input
          id="name"
          name="name"
          required
          autoFocus
          maxLength={120}
          placeholder="Acme website relaunch"
          onChange={(e) => {
            if (!keyEdited) setKey(suggestProjectKey(e.target.value));
          }}
        />
      </Field>
      <Field
        label="Key"
        htmlFor="key"
        error={errors?.key}
        hint="Prefix for task IDs, like WEB-142. 2–10 letters or digits."
      >
        <Input
          id="key"
          name="key"
          required
          maxLength={10}
          value={key}
          onChange={(e) => {
            setKey(e.target.value.toUpperCase());
            setKeyEdited(true);
          }}
          className="w-40 font-mono uppercase"
        />
      </Field>
      <Field label="Description" htmlFor="description" error={errors?.description}>
        <Textarea
          id="description"
          name="description"
          maxLength={2000}
          placeholder="What is this project about?"
        />
      </Field>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-[13px] font-medium">Visibility</legend>
        <VisibilityOption
          value="workspace"
          defaultChecked
          title="Workspace"
          text="Every workspace member can see and edit it. Guests only if added."
        />
        <VisibilityOption
          value="private"
          title="Private"
          text="Only people you add, plus workspace admins."
        />
      </fieldset>
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create project"}
        </Button>
      </div>
    </form>
  );
}

export function VisibilityOption({
  value,
  title,
  text,
  defaultChecked,
}: {
  value: "workspace" | "private";
  title: string;
  text: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="bg-surface has-[:checked]:border-accent has-[:checked]:bg-accent-soft/40 flex cursor-pointer gap-3 rounded-md border p-3">
      <input
        type="radio"
        name="visibility"
        value={value}
        defaultChecked={defaultChecked}
        className="mt-0.5 accent-[var(--accent)]"
      />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="text-muted-foreground block text-[13px]">{text}</span>
      </span>
    </label>
  );
}
