"use server";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/server/auth/session";
import { resolveActor } from "@/server/authz/actor";
import { formString, runAction } from "@/server/action";
import { formFiles } from "@/server/form-files";
import type { ActionState } from "@/lib/action-state";
import { addQaEvidence, concludeQaCycle, startQaCycle } from "./service";

async function actorFor(workspaceSlug: string) {
  const user = await requireUser();
  return resolveActor(user.id, workspaceSlug);
}

/** "Start QA round": where it's being tested and which build. */
export async function startQaAction(
  workspaceSlug: string,
  taskId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const round = await startQaCycle(await actorFor(workspaceSlug), taskId, {
      environmentUrl: formString(form, "environmentUrl"),
      buildRef: formString(form, "buildRef"),
    });
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    return { ok: true, message: `QA round #${round?.cycleNumber} started` };
  });
}

/** Pass or fail the open round, with notes and any evidence files. */
export async function concludeQaAction(
  workspaceSlug: string,
  taskId: string,
  cycleId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    const actor = await actorFor(workspaceSlug);
    const result = formString(form, "result") === "pass" ? "pass" : "fail";
    const files = await formFiles(form, "evidence");
    if (files.length) await addQaEvidence(actor, cycleId, files);
    await concludeQaCycle(actor, taskId, { result, summary: formString(form, "summary") });
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    return { ok: true, message: result === "pass" ? "QA passed" : "QA failed" };
  });
}

/** Evidence for the open round, added before deciding. */
export async function addQaEvidenceAction(
  workspaceSlug: string,
  cycleId: string,
  _prev: ActionState,
  form: FormData,
): Promise<ActionState> {
  return runAction(async () => {
    await addQaEvidence(await actorFor(workspaceSlug), cycleId, await formFiles(form, "evidence"));
    revalidatePath(`/w/${workspaceSlug}`, "layout");
    return { ok: true, message: "Evidence added" };
  });
}
