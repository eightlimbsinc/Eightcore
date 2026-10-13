import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import type { ActionState } from "@/lib/action-state";
import { DomainError } from "@/server/errors";

/**
 * Runs a Server Action body and turns expected failures into form state.
 * Redirects and notFound() pass through; unexpected errors are logged and hidden.
 */
export async function runAction(fn: () => Promise<ActionState | void>): Promise<ActionState> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof ZodError) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of error.issues) {
        const key = issue.path.join(".") || "form";
        fieldErrors[key] ??= issue.message;
      }
      return { ok: false, message: "Please check the highlighted fields", fieldErrors };
    }
    if (error instanceof DomainError) {
      return { ok: false, message: error.message, fieldErrors: error.fieldErrors };
    }
    console.error("[action] unexpected error", error);
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

export function formString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}
