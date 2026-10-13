/** What every form-backed Server Action returns. */
export type ActionState =
  | { ok: true; message?: string }
  | { ok: false; message: string; fieldErrors?: Record<string, string> }
  | undefined;
