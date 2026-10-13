/** Domain errors. Actions and pages translate these into HTTP-ish outcomes. */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "forbidden" | "conflict" | "validation",
    readonly fieldErrors?: Record<string, string>,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** The resource doesn't exist *or the caller may not know it exists* (avoids enumeration). */
export class NotFoundError extends DomainError {
  constructor(message = "Not found") {
    super(message, "not_found");
  }
}

/** The caller can see the resource but may not perform this action. */
export class ForbiddenError extends DomainError {
  constructor(message = "You don't have permission to do that") {
    super(message, "forbidden");
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, "conflict");
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, fieldErrors?: Record<string, string>) {
    super(message, "validation", fieldErrors);
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** IDs arrive from Server Action arguments, which callers control. A malformed one is simply "not found". */
export function assertId(id: unknown, message?: string): asserts id is string {
  if (typeof id !== "string" || !UUID_RE.test(id)) throw new NotFoundError(message);
}

/** Postgres error details we inspect (node-postgres surfaces these on the error or its cause). */
export function pgErrorInfo(error: unknown): { code?: string; constraint?: string } {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const e = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (typeof e.code === "string" && /^[0-9A-Z]{5}$/.test(e.code)) {
      return { code: e.code, constraint: typeof e.constraint === "string" ? e.constraint : undefined };
    }
    current = e.cause;
  }
  return {};
}
