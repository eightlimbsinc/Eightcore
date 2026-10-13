// Better Auth behaviour we rely on: verification required, password policy, revocation.
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { getAuth } from "@/server/auth/config";
import { count } from "../support/db";

const outbox = path.resolve(".mail/test");

async function lastMailTo(email: string) {
  const files = (await readdir(outbox)).sort().reverse();
  for (const file of files) {
    const mail = JSON.parse(await readFile(path.join(outbox, file), "utf8")) as { to: string; text: string };
    if (mail.to === email) return mail;
  }
  throw new Error(`no mail to ${email}`);
}

function linkFrom(text: string): string {
  const match = text.match(/https?:\/\/\S+/);
  if (!match) throw new Error("no link in mail");
  return match[0];
}

const password = "correct horse battery staple";

async function signUpAndVerify(email: string) {
  const auth = getAuth();
  await auth.api.signUpEmail({ body: { name: "Test Person", email, password } });
  const url = new URL(linkFrom((await lastMailTo(email)).text));
  await auth.api.verifyEmail({ query: { token: url.searchParams.get("token")! } });
}

async function signIn(email: string, pw = password) {
  const res = await getAuth().api.signInEmail({ body: { email, password: pw }, asResponse: true });
  const cookie = res.headers.get("set-cookie");
  return { status: res.status, cookie: cookie?.split(";")[0] ?? null };
}

async function sessionFor(cookie: string | null) {
  return getAuth().api.getSession({ headers: new Headers(cookie ? { cookie } : {}) });
}

beforeEach(async () => {
  await rm(outbox, { recursive: true, force: true });
});

describe("authentication", () => {
  it("requires email verification before sign-in", async () => {
    await getAuth().api.signUpEmail({ body: { name: "Pending", email: "pending@example.test", password } });
    expect((await signIn("pending@example.test")).status).toBe(403);

    const url = new URL(linkFrom((await lastMailTo("pending@example.test")).text));
    await getAuth().api.verifyEmail({ query: { token: url.searchParams.get("token")! } });
    const { status, cookie } = await signIn("pending@example.test");
    expect(status).toBe(200);
    expect((await sessionFor(cookie))?.user.email).toBe("pending@example.test");
  });

  it("rejects short passwords", async () => {
    await expect(
      getAuth().api.signUpEmail({
        body: { name: "Short", email: "short@example.test", password: "elevenchars" },
      }),
    ).rejects.toThrow();
  });

  it("stores a password hash, never the password", async () => {
    await signUpAndVerify("hash@example.test");
    expect(await count("auth_accounts", "password = $1", [password])).toBe(0);
    expect(await count("auth_accounts", "password is not null")).toBe(1);
  });

  it("rejects wrong passwords and records the failure", async () => {
    await signUpAndVerify("wrong@example.test");
    expect((await signIn("wrong@example.test", "not the right password")).status).toBe(401);
    expect(await count("audit_log", "event = 'auth.sign_in_failed'")).toBe(1);
  });

  it("revokes every session on 'sign out everywhere'", async () => {
    await signUpAndVerify("everywhere@example.test");
    const first = await signIn("everywhere@example.test");
    const second = await signIn("everywhere@example.test");
    expect(await sessionFor(first.cookie)).not.toBeNull();
    await getAuth().api.revokeSessions({ headers: new Headers({ cookie: first.cookie! }) });
    expect(await sessionFor(first.cookie)).toBeNull();
    expect(await sessionFor(second.cookie)).toBeNull();
  });

  it("revokes other sessions when the password changes", async () => {
    await signUpAndVerify("change@example.test");
    const current = await signIn("change@example.test");
    const other = await signIn("change@example.test");
    await getAuth().api.changePassword({
      headers: new Headers({ cookie: current.cookie! }),
      body: {
        currentPassword: password,
        newPassword: "an even better passphrase",
        revokeOtherSessions: true,
      },
    });
    expect(await sessionFor(other.cookie)).toBeNull();
    expect((await signIn("change@example.test")).status).toBe(401);
    expect((await signIn("change@example.test", "an even better passphrase")).status).toBe(200);
  });

  it("resets a password with a single-use token and signs out existing sessions", async () => {
    await signUpAndVerify("reset@example.test");
    const existing = await signIn("reset@example.test");
    await getAuth().api.requestPasswordReset({
      body: { email: "reset@example.test", redirectTo: "/reset-password" },
    });
    const link = linkFrom((await lastMailTo("reset@example.test")).text);
    const token = new URL(link).pathname.split("/").pop()!;
    await getAuth().api.resetPassword({ body: { token, newPassword: "a brand new passphrase" } });
    expect(await sessionFor(existing.cookie)).toBeNull();
    await expect(
      getAuth().api.resetPassword({ body: { token, newPassword: "and another passphrase" } }),
    ).rejects.toThrow();
    expect((await signIn("reset@example.test", "a brand new passphrase")).status).toBe(200);
  });
});
