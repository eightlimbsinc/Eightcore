import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/server/db";
import * as schema from "@/server/db/schema";
import { env, signupMode } from "@/server/env";
import { actionEmail, sendMail } from "@/server/mail";
import { recordAudit } from "@/modules/activity/service";
import { hasPendingInvitation } from "@/modules/workspaces/service";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-policy";

/** Invite-only sign-up rule (docs/RUNBOOK.md). Throws a FORBIDDEN APIError when not allowed. */
async function assertSignupAllowed(rawEmail: unknown): Promise<void> {
  const current = env();
  if (signupMode(current) === "open" || typeof rawEmail !== "string") return;
  const email = rawEmail.trim().toLowerCase();
  if (current.SIGNUP_ALLOWED_EMAILS.includes(email) || (await hasPendingInvitation(email))) return;
  await recordAudit(db(), { event: "auth.signup_blocked", metadata: { email } });
  throw new APIError("FORBIDDEN", { code: "SIGNUP_INVITE_ONLY", message: "Sign-up is by invitation only" });
}

function createAuth() {
  const e = env();
  return betterAuth({
    appName: "Eightcore",
    baseURL: e.BETTER_AUTH_URL,
    secret: e.BETTER_AUTH_SECRET,
    trustedOrigins: [
      e.BETTER_AUTH_URL,
      // In development, forwarders such as GitHub Codespaces rewrite the browser's Origin
      // to the internal address. Only pages served from localhost:3000 can send that origin.
      ...(e.NODE_ENV === "production" ? [] : ["http://localhost:3000"]),
    ],
    telemetry: { enabled: false },
    database: drizzleAdapter(db(), {
      provider: "pg",
      schema: {
        users: schema.users,
        auth_sessions: schema.authSessions,
        auth_accounts: schema.authAccounts,
        auth_verifications: schema.authVerifications,
        auth_rate_limits: schema.authRateLimits,
      },
    }),
    user: { modelName: "users" },
    session: {
      modelName: "auth_sessions",
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // slide expiry at most daily
      // No cookie cache: every request re-reads the session row, so revocation is immediate.
      cookieCache: { enabled: false },
    },
    account: { modelName: "auth_accounts" },
    verification: { modelName: "auth_verifications" },
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: e.NODE_ENV === "production",
      cookiePrefix: "eightcore",
      // Behind a host's proxy, the visitor's IP is in a host-specific header (rate limiting uses it).
      ...(e.AUTH_IP_HEADERS.length ? { ipAddress: { ipAddressHeaders: e.AUTH_IP_HEADERS } } : {}),
      // Better Auth skips origin checks under NODE_ENV=test by default; keep them on so
      // tests exercise the same protection as the running app.
      disableOriginCheck: false,
    },
    rateLimit: {
      enabled: true,
      storage: "database",
      modelName: "auth_rate_limits",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 300, max: 3 },
        "/send-verification-email": { window: 300, max: 3 },
        "/change-password": { window: 60, max: 5 },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: 256,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        await sendMail({
          to: user.email,
          subject: "Reset your Eightcore password",
          ...actionEmail({
            heading: "Reset your password",
            body: "Someone asked to reset the password for this account. The link expires in one hour. If it wasn't you, ignore this email.",
            actionLabel: "Choose a new password",
            url,
          }),
        });
      },
      onPasswordReset: async ({ user }) => {
        await recordAudit(db(), { event: "auth.password_reset", actorId: user.id });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      expiresIn: 60 * 60 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        await sendMail({
          to: user.email,
          subject: "Verify your Eightcore email",
          ...actionEmail({
            heading: "Confirm your email",
            body: "Confirm this address to finish setting up your Eightcore account.",
            actionLabel: "Verify email",
            url,
          }),
        });
      },
    },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            await recordAudit(db(), {
              event: "auth.session_created",
              actorId: session.userId,
              ip: session.ipAddress,
              userAgent: session.userAgent,
            });
          },
        },
      },
      user: {
        create: {
          // Backstop for every sign-up path. Better Auth turns errors here into a generic
          // success response (anti-enumeration), so the clear message comes from hooks.before.
          before: async (user) => {
            await assertSignupAllowed(user.email);
          },
          after: async (user) => {
            await recordAudit(db(), { event: "auth.user_created", actorId: user.id });
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email")
          await assertSignupAllowed((ctx.body as { email?: unknown })?.email);
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/email" && ctx.context.returned instanceof APIError) {
          await recordAudit(db(), {
            event: "auth.sign_in_failed",
            ip: ctx.request?.headers.get("x-forwarded-for") ?? null,
            userAgent: ctx.request?.headers.get("user-agent") ?? null,
            metadata: { status: ctx.context.returned.status },
          });
        }
      }),
    },
    // Must be last: lets Server Actions set auth cookies.
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { eightcoreAuth?: { key: string; auth: Auth } };

/**
 * Lazily-created Better Auth instance (so builds don't need runtime secrets).
 * Rebuilt when the public URL or secret changes, e.g. after .env.local is edited
 * while `next dev` is running; otherwise origin checks would use the old URL.
 */
export function getAuth(): Auth {
  const { BETTER_AUTH_URL, BETTER_AUTH_SECRET } = env();
  const key = `${BETTER_AUTH_URL}\n${BETTER_AUTH_SECRET}`;
  if (globalForAuth.eightcoreAuth?.key !== key) {
    globalForAuth.eightcoreAuth = { key, auth: createAuth() };
  }
  return globalForAuth.eightcoreAuth.auth;
}
