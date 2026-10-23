// Invite-only sign-up: only allowlisted emails and people with a pending invitation.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAuth } from "@/server/auth/config";
import { inviteMember } from "@/modules/workspaces/service";
import { count } from "../support/db";
import { createWorkspaceWithRoles } from "../support/factories";

const password = "correct horse battery staple";

async function signUp(email: string) {
  return getAuth().handler(
    new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ name: "Someone", email, password }),
    }),
  );
}

describe("invite-only sign-up", () => {
  beforeEach(() => {
    process.env.SIGNUP_MODE = "invite-only";
    process.env.SIGNUP_ALLOWED_EMAILS = "Founder@Example.test, ops@example.test";
  });
  afterEach(() => {
    delete process.env.SIGNUP_MODE;
    delete process.env.SIGNUP_ALLOWED_EMAILS;
  });

  it("refuses strangers without creating an account", async () => {
    const res = await signUp("stranger@example.test");
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "SIGNUP_INVITE_ONLY" });
    expect(await count("users", "email = $1", ["stranger@example.test"])).toBe(0);
    expect(await count("audit_log", "event = 'auth.signup_blocked'")).toBe(1);
  });

  it("allows allowlisted emails, case-insensitively", async () => {
    expect((await signUp("founder@example.test")).status).toBe(200);
  });

  it("allows people with a pending invitation", async () => {
    const { actors } = await createWorkspaceWithRoles();
    await inviteMember(actors.owner, { email: "invited@example.test", role: "member" });
    expect((await signUp("Invited@Example.test")).status).toBe(200);
  });
});

describe("open sign-up (development default)", () => {
  it("lets anyone sign up when SIGNUP_MODE is unset outside production", async () => {
    expect((await signUp("anyone@example.test")).status).toBe(200);
  });
});
