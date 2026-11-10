import "server-only";
import { notFound } from "next/navigation";
import { ForbiddenError, NotFoundError } from "@/server/errors";
import { env } from "@/server/env";
import { getWorkspaceContext } from "@/modules/workspaces/queries";
import { getFormForEditing, getPublicForm, listFormsFor } from "./service";

/** The form builder (people who can manage forms on the list; others get a 404). */
export async function getFormBuilderPage(slug: string, listId: string, formId: string) {
  const { actor } = await getWorkspaceContext(slug);
  try {
    const data = await getFormForEditing(actor, formId);
    if (data.list.id !== listId) notFound();
    const forms = await listFormsFor(actor, listId);
    return {
      ...data,
      forms: forms.map(({ id, name }) => ({ id, name })),
      publicUrl: new URL(`/f/${data.form.token}`, env().BETTER_AUTH_URL).toString(),
    };
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) notFound();
    throw error;
  }
}

export async function getPublicFormPage(token: string) {
  return getPublicForm(token);
}
