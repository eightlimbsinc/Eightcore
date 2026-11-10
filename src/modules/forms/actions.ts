"use server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth/session";
import { resolveActor } from "@/server/authz/actor";
import { runAction } from "@/server/action";
import { env } from "@/server/env";
import type { ActionState } from "@/lib/action-state";
import type { FormInput } from "./rules";
import {
  FormClosedError,
  createForm,
  deleteForm,
  regenerateFormLink,
  submitForm,
  updateForm,
} from "./service";

async function actorFor(workspaceSlug: string) {
  const user = await requireUser();
  return resolveActor(user.id, workspaceSlug);
}

/** "+ View → Form": makes a form and opens its builder. */
export async function createFormAction(workspaceSlug: string, listId: string): Promise<ActionState> {
  let id = "";
  const result = await runAction(async () => {
    ({ id } = await createForm(await actorFor(workspaceSlug), listId));
    revalidatePath(`/w/${workspaceSlug}/l/${listId}`, "layout");
  });
  if (result?.ok) redirect(`/w/${workspaceSlug}/l/${listId}/forms/${id}`);
  return result;
}

export async function updateFormAction(
  workspaceSlug: string,
  formId: string,
  input: FormInput,
): Promise<ActionState> {
  return runAction(async () => {
    await updateForm(await actorFor(workspaceSlug), formId, input);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    return { ok: true, message: "Saved" };
  });
}

export async function regenerateFormLinkAction(workspaceSlug: string, formId: string): Promise<ActionState> {
  return runAction(async () => {
    await regenerateFormLink(await actorFor(workspaceSlug), formId);
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
}

export async function deleteFormAction(workspaceSlug: string, formId: string): Promise<ActionState> {
  let listId = "";
  const result = await runAction(async () => {
    ({ listId } = await deleteForm(await actorFor(workspaceSlug), formId));
    revalidatePath(`/w/${workspaceSlug}`, "layout");
  });
  if (result?.ok) redirect(`/w/${workspaceSlug}/l/${listId}`);
  return result;
}

export type SubmitFormState =
  { ok: true; message: string } | { ok: false; errors: Record<string, string>; message?: string } | undefined;

/** The public form's submit (no sign-in): answers and files in, a task out. */
export async function submitFormAction(
  token: string,
  _prev: SubmitFormState,
  data: FormData,
): Promise<SubmitFormState> {
  const answers: Record<string, string> = {};
  const files: Record<string, File[]> = {};
  for (const [key, value] of data.entries()) {
    if (typeof value === "string") answers[key] = value;
    else (files[key] ??= []).push(value);
  }
  const h = await headers();
  const configured = env().AUTH_IP_HEADERS;
  const ipHeaders = configured.length ? configured : ["x-forwarded-for"];
  const ip = ipHeaders.map((name) => h.get(name)?.split(",")[0]?.trim()).find(Boolean) ?? "";
  try {
    const result = await submitForm(token, answers, files, ip);
    if (result.ok)
      after(() =>
        import("@/modules/automations/engine").then((m) => m.processOutbox()).catch(() => undefined),
      );
    return result;
  } catch (error) {
    if (error instanceof FormClosedError)
      return { ok: false, errors: {}, message: "This form isn't taking responses right now." };
    console.error("[form] submit failed", error);
    return { ok: false, errors: {}, message: "Something went wrong. Please try again." };
  }
}
