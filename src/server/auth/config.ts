import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware, APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { db } from "@/server/db";
import * as schema from "@/server/db/schema";
import { env } from "@/server/env";
import { actionEmail, sendMail } from "@/server/mail";
import { recordAudit } from "@/modules/activity/service";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-policy";

function createAuth() {
  const e = env();
  return betterAuth({
    appName: "Eightcore",
    baseURL: e.BETTER_AUTH_URL,
    secret: e.BETTER_AUTH_SECRET,
    trustedOrigins: [e.BETTER_AUTH_URL],
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
          after: async (user) => {
            await recordAudit(db(), { event: "auth.user_created", actorId: user.id });
          },
        },
      },
    },
    hooks: {
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

const globalForAuth = globalThis as unknown as { eightcoreAuth?: Auth };

/** Lazily-created Better Auth instance (so builds don't need runtime secrets). */
export function getAuth(): Auth {
  globalForAuth.eightcoreAuth ??= createAuth();
  return globalForAuth.eightcoreAuth;
}
