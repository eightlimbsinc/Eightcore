// Phase 3b journey: comments with @mentions and files, the inbox, tags, attachments.
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { linkFromLatestMail } from "./mail";

const run = randomUUID().slice(0, 6);
const owner = { name: "Cora Owner", email: "cora@e2e.example.test", password: "cora passphrase 123" };
const member = { name: "Milo Member", email: `milo-${run}@example.test`, password: "milo passphrase 123" };
const workspaceSlug = `cora-co-${run}`;

async function signUp(page: Page, user: typeof owner) {
  await page.getByLabel("Full name").fill(user.name);
  await page.getByLabel("Work email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
}

async function signIn(page: Page, user: typeof owner) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe.configure({ mode: "serial" });
// A separate visitor IP for this spec (see AUTH_IP_HEADERS in playwright.config.ts).
test.use({ extraHTTPHeaders: { "x-e2e-client-ip": "203.0.113.3" } });

test("owner sets up a task and invites a teammate", async ({ page }) => {
  await page.goto("/sign-up");
  await signUp(page, owner);
  await page.goto(await linkFromLatestMail(owner.email, "Verify"));
  await page.getByLabel("Workspace name").fill(`Cora Co ${run}`);
  await page.getByRole("button", { name: "Create workspace" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}$`));

  await page.getByRole("link", { name: "New project" }).first().click();
  await page.getByLabel("Project name").fill("Brand");
  await page.getByLabel("Key").fill("BRD");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByLabel("List name").fill("Design");
  await page.getByRole("button", { name: "Create list" }).click();
  await page.getByLabel("New task title").fill("New logo");
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByText("Created BRD-1")).toBeVisible();

  await page.getByRole("link", { name: "Members" }).click();
  await page.getByLabel("Email", { exact: true }).fill(member.email);
  await page.getByLabel("Role", { exact: true }).selectOption("member");
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText(`Invitation sent to ${member.email}`)).toBeVisible();
});

test("teammate comments with an @mention and a file", async ({ page }) => {
  await page.goto(await linkFromLatestMail(member.email, "invited you"));
  await page.getByRole("link", { name: "Create an account" }).click();
  await signUp(page, member);
  await page.goto(await linkFromLatestMail(member.email, "Verify"));
  await page.getByRole("button", { name: "Accept invitation" }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceSlug}$`));

  await page.goto(`/w/${workspaceSlug}/t/BRD-1`);
  const box = page.getByRole("combobox", { name: "New comment" });
  await box.fill("Draft is ready, @Co");
  await page.getByRole("option", { name: owner.name }).click();
  await expect(box).toHaveValue(`Draft is ready, @${owner.name} `);
  await box.pressSequentially("what do you think?");
  await page.getByLabel("Attach files to this comment").setInputFiles({
    name: "logo-draft.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("logo draft v1"),
  });
  await page.getByRole("button", { name: "Comment", exact: true }).click();

  const comment = page.getByRole("article", { name: `Comment by ${member.name}` });
  await expect(comment.getByText("what do you think?")).toBeVisible();
  await expect(comment.getByText(`@${owner.name}`)).toBeVisible();
  await expect(comment.getByRole("link", { name: "logo-draft.txt", exact: true })).toBeVisible();
  // Commenting makes you a watcher.
  await expect(page.getByRole("button", { name: "Stop watching" })).toBeVisible();
});

test("owner sees the mention in the inbox, replies, tags and attaches", async ({ page }) => {
  await signIn(page, owner);
  await expect(page).toHaveURL(/\/w\//);
  await page.goto(`/w/${workspaceSlug}`);
  const inbox = page.getByRole("link", { name: /Inbox/ });
  await expect(inbox.getByLabel("1 unread")).toBeVisible();
  await inbox.click();
  await expect(page.getByText(`${member.name} mentioned you`)).toBeVisible();
  await page.getByRole("button", { name: new RegExp(`${member.name} mentioned you`) }).click();
  await expect(page).toHaveURL(/\/t\/BRD-1$/);
  await expect(inbox.getByLabel("1 unread")).toHaveCount(0);

  // The file posted with the comment downloads (after the permission check).
  const href = await page.getByRole("link", { name: "logo-draft.txt", exact: true }).getAttribute("href");
  const download = await page.request.get(`${href}?download`);
  expect(download.status()).toBe(200);
  expect(download.headers()["content-disposition"]).toContain("attachment");
  expect(await download.text()).toBe("logo draft v1");

  // Reply in the thread.
  await page.getByRole("button", { name: "Reply" }).click();
  await page.getByRole("combobox", { name: `Reply to ${member.name}` }).fill("Love it, ship it");
  await page.getByRole("button", { name: "Reply", exact: true }).last().click();
  await expect(page.getByRole("article", { name: `Comment by ${owner.name}` })).toContainText(
    "Love it, ship it",
  );

  // Create a tag straight onto the task.
  await page.getByLabel("New tag").fill("Client review");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Created “Client review”")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Client review" })).toBeChecked();
  await expect(page.getByText("added the tag “Client review”")).toBeVisible();

  // Attach a file to the task itself.
  await page.getByLabel(/Attach files \(up to/).setInputFiles({
    name: "brief.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("the brief"),
  });
  await page.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText("File attached")).toBeVisible();
  await expect(page.getByRole("link", { name: "brief.txt", exact: true })).toBeVisible();

  // The list shows the tag on the task row.
  await page.getByRole("link", { name: "Design" }).first().click();
  await expect(page).toHaveURL(/\/l\//);
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "New logo" })
      .getByLabel("Tags", { exact: true })
      .getByText("Client review"),
  ).toBeVisible();
});

test("files are not served to signed-out visitors", async ({ request }) => {
  const res = await request.get(`/w/${workspaceSlug}/files/00000000-0000-4000-8000-000000000000`, {
    maxRedirects: 0,
  });
  expect([302, 307, 404]).toContain(res.status());
});
