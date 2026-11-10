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
  // Files the browser already uploaded straight to storage arrive as "<upload id>|<name>".
  const direct = form
    .getAll(`${key}__upload`)
    .filter((v): v is string => typeof v === "string" && v.includes("|"))
    .map((v) => ({ uploadId: v.slice(0, v.indexOf("|")), name: v.slice(v.indexOf("|") + 1) }));
  return [
    ...direct,
    ...(await Promise.all(
      chosen.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })),
    )),
  ];
}

export function formStrings(form: FormData, key: string): string[] {
  return form.getAll(key).filter((v): v is string => typeof v === "string" && v !== "");
}
