"use client";
import { useActionState, useState } from "react";
import { createWorkspaceAction } from "@/modules/workspaces/actions";
import { slugify } from "@/modules/workspaces/validators";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";

export function CreateWorkspaceForm() {
  const [state, action, pending] = useActionState(createWorkspaceAction, undefined);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="grid gap-4">
      {state && !state.ok && !errors ? <Alert variant="destructive">{state.message}</Alert> : null}
      <Field label="Workspace name" htmlFor="name" error={errors?.name}>
        <Input
          id="name"
          name="name"
          required
          autoFocus
          maxLength={80}
          value={name}
          placeholder="8limbs"
          onChange={(e) => {
            setName(e.target.value);
            if (!slugEdited) setSlug(slugify(e.target.value));
          }}
        />
      </Field>
      <Field
        label="Address"
        htmlFor="slug"
        error={errors?.slug}
        hint="Lowercase letters, numbers and dashes."
      >
        <div className="border-input bg-surface focus-within:outline-ring flex items-center rounded-md border focus-within:outline-2">
          <span className="text-muted-foreground pl-3">/w/</span>
          <Input
            id="slug"
            name="slug"
            required
            maxLength={48}
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugEdited(true);
            }}
            className="border-0 pl-0.5 focus-visible:outline-none"
          />
        </div>
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Creating…" : "Create workspace"}
      </Button>
    </form>
  );
}
