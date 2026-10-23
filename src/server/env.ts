import "server-only";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  BETTER_AUTH_URL: z.url(),
  SMTP_URL: z.preprocess((v) => (v === "" ? undefined : v), z.url({ protocol: /^smtps?$/ }).optional()),
  MAIL_FROM: z.string().min(3).default("Eightcore <no-reply@eightcore.local>"),
  MAIL_OUTBOX_DIR: z.string().default(".mail"),
  /**
   * Who may create an account. "invite-only" allows emails in SIGNUP_ALLOWED_EMAILS and
   * emails with a pending workspace invitation. Defaults: invite-only in production, open otherwise.
   */
  SIGNUP_MODE: z.enum(["open", "invite-only"]).optional(),
  SIGNUP_ALLOWED_EMAILS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean),
    ),
  /** Request headers holding the visitor's IP, in priority order (e.g. Netlify: x-nf-client-connection-ip). */
  AUTH_IP_HEADERS: z
    .string()
    .default("")
    .transform((v) =>
      v
        .split(",")
        .map((h) => h.trim().toLowerCase())
        .filter(Boolean),
    ),
  /** Lets a production build write mail to MAIL_OUTBOX_DIR. Only for the local E2E server. */
  EIGHTCORE_ALLOW_FILE_MAIL: z.enum(["0", "1"]).default("0"),
});

export type Env = z.infer<typeof schema>;

export function signupMode(e: Env): "open" | "invite-only" {
  return e.SIGNUP_MODE ?? (e.NODE_ENV === "production" ? "invite-only" : "open");
}

let cached: Env | undefined;

/**
 * Validated server environment. Read lazily so `next build` doesn't need
 * runtime secrets; the first request (or script) fails fast if anything is missing.
 * Cached only in production: `next dev` reloads .env.local in place, and a stale
 * copy would keep the old values until a full restart.
 */
export function env(): Env {
  if (cached && process.env.NODE_ENV === "production") return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Environment validation failed:\n${issues}\nSee .env.example and docs/RUNBOOK.md.`);
  }
  cached = parsed.data;
  return cached;
}
