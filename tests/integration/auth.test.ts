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

describe("origin checks", () => {
  async function signInFrom(origin: string) {
    await signUpAndVerify(`origin-${Math.random().toString(36).slice(2)}@example.test`);
    return getAuth().handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin,
          "sec-fetch-site": "same-origin",
          "sec-fetch-mode": "cors",
        },
        body: JSON.stringify({ email: "nobody@example.test", password }),
      }),
    );
  }

  it("refuses sign-in requests from a foreign origin", async () => {
    const res = await signInFrom("https://evil.example");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "INVALID_ORIGIN" });
  });

  it("accepts the configured public URL, and localhost:3000 outside production (Codespaces rewrites Origin)", async () => {
    for (const origin of ["http://localhost:3000", process.env.BETTER_AUTH_URL!]) {
      const res = await signInFrom(origin);
      expect(res.status).not.toBe(403); // reaches the credential check: 401 for an unknown user
    }
  });
});
