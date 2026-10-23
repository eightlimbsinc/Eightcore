import "server-only";
import type { IncomingFile } from "@/modules/attachments/service";

/**
 * Files from a form field. An empty file input still submits one blank entry (no name, or
 * "undefined" after Server Action decoding); those are skipped.
 */
export async function formFiles(form: FormData, key: string): Promise<IncomingFile[]> {
  const files = form
    .getAll(key)
    .filter((v): v is File => typeof v === "object" && v !== null && "arrayBuffer" in v);
  const chosen = files.filter((f) => f.size > 0 || (f.name !== "" && f.name !== "undefined"));
  return Promise.all(
    chosen.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
  );
}

export function formStrings(form: FormData, key: string): string[] {
  return form.getAll(key).filter((v): v is string => typeof v === "string" && v !== "");
}
