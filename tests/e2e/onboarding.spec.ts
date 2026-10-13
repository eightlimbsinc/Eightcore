// Journey 1 (docs/TESTING_STRATEGY.md §3.4): sign up → verify → create workspace →
// invite a member → the member signs up from the invitation and joins.
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { linkFromLatestMail } from "./mail";

const run = randomUUID().slice(0, 6);
const owner = { name: "Olivia Owner", email: `olivia-${run}@example.test`, password: "olivia passphrase 1" };
const invitee = { name: "Max Member", email: `max-${run}@example.test`, password: "max passphrase 1234" };
const workspaceName = `Acme Studio ${run}`;
const workspaceSlug = `acme-studio-${run}`;

async function signUp(page: Page, user: typeof owner) {
  await page.getByLabel("Full name").fill(user.name);
  await page.getByLabel("Work email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
}

test.describe.configure({ mode: "serial" });

test("signed-out visitors are sent to sign-in, with a strict CSP", async ({ page }) => {
  const response = await page.goto(`/w/${workspaceSlug}`);
  await expect(page).toHaveURL(/\/sign-in\?next=/);
  expect(response?.headers()["content-security-policy"]).toContain("script-src 'self' 'nonce-");
  expect(response?.headers()["x-frame-options"]).toBe("DENY");
});

test("health endpoint reports the database", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toEqual({ ok: true, database: "up" });
});

test("owner signs up, verifies, creates a workspace, invites a member and a project", async ({ page }) => {
  await page.goto("/sign-up");
  await signUp(page, owner);

  // Unverified accounts can't sign in.
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Please verify your email address first")).toBeVisible();

  // The verification link signs the owner in; with no workspace yet they land on /w/new.
  await page.goto(await linkFromLatestMail(owner.email, "Verify"));
  await expect(page).toHaveURL(/\/w\/new$/);

  await page.getByLabel("Workspace name").fill(workspaceName);
  await expect(page.getByLabel("Address")).toHaveValue(workspaceSlug);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}$`));
  await expect(page.getByRole("heading", { name: "Welcome, Olivia" })).toBeVisible();

  // Invite a member.
  await page.getByRole("link", { name: "Members" }).click();
  await page.getByLabel("Email", { exact: true }).fill(invitee.email);
  await page.getByLabel("Role", { exact: true }).selectOption("member");
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText(`Invitation sent to ${invitee.email}`)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: invitee.email })).toBeVisible();

  // Create a workspace-visible project.
  await page.getByRole("link", { name: "New project" }).first().click();
  await page.getByLabel("Project name").fill("Website relaunch");
  await expect(page.getByLabel("Key")).toHaveValue("WR");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}/p/WR$`));
  await expect(page.getByRole("heading", { name: "Website relaunch" })).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Projects" }).getByText("Website relaunch"),
  ).toBeVisible();
});

test("invitee signs up from the invitation, joins, and sees member-level controls only", async ({ page }) => {
  const inviteLink = await linkFromLatestMail(invitee.email, "invited you");
  await page.goto(inviteLink);
  await expect(page.getByRole("heading", { name: `Join ${workspaceName}` })).toBeVisible();
  await page.getByRole("link", { name: "Create an account" }).click();
  await signUp(page, invitee);

  // Verifying returns them to the invitation.
  await page.goto(await linkFromLatestMail(invitee.email, "Verify"));
  await expect(page.getByRole("heading", { name: `Join ${workspaceName}` })).toBeVisible();
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}$`));

  // Workspace-visible project is there; a member can open it but not manage it.
  await page.getByRole("navigation", { name: "Projects" }).getByText("Website relaunch").click();
  await expect(page.getByText(/Your role:\s*editor/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Archive project" })).toHaveCount(0);

  // Members can see the directory but not invite or change roles.
  await page.getByRole("link", { name: "Members" }).click();
  await expect(page.getByRole("cell", { name: /Olivia Owner/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send invite" })).toHaveCount(0);
  await expect(page.getByRole("combobox")).toHaveCount(0);

  // The invitation can't be reused.
  await page.goto(inviteLink);
  await expect(page.getByRole("heading", { name: "Invitation unavailable" })).toBeVisible();
});

test("a stranger gets a 404 for the workspace, and sign out everywhere ends the session", async ({
  page,
}) => {
  const stranger = {
    name: "Sam Stranger",
    email: `sam-${run}@example.test`,
    password: "sam passphrase 12345",
  };
  await page.goto("/sign-up");
  await signUp(page, stranger);
  await page.goto(await linkFromLatestMail(stranger.email, "Verify"));
  await expect(page).toHaveURL(/\/w\/new$/);

  const response = await page.goto(`/w/${workspaceSlug}`);
  expect(response?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Nothing here" })).toBeVisible();

  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out everywhere" }).click();
  await expect(page).toHaveURL(/\/sign-in\?signedOut=everywhere/);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in/);
});
