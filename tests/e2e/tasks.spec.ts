// Phase 3a journey: lists with their own statuses, tasks, subtasks, assignees.
import { expect, test } from "@playwright/test";
import { linkFromLatestMail } from "./mail";

const owner = { name: "Tess Tasks", email: "tess@e2e.example.test", password: "tess passphrase 123" };

test.describe.configure({ mode: "serial" });

test("an owner organises work into lists and tasks", async ({ page }) => {
  // Sign up, verify, create a workspace and a project.
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(owner.name);
  await page.getByLabel("Work email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.goto(await linkFromLatestMail(owner.email, "Verify"));
  await page.getByLabel("Workspace name").fill("Tess Studio");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.getByRole("link", { name: "New project" }).first().click();
  await page.getByLabel("Project name").fill("Website");
  await page.getByLabel("Key").fill("WEB");
  await page.getByRole("button", { name: "Create project" }).click();
  await expect(page.getByRole("heading", { name: "Website" })).toBeVisible();

  // A folder, then a list in it using the agency workflow.
  await page.getByLabel("New folder").fill("Phase 1");
  await page.getByRole("button", { name: "Add folder" }).click();
  await expect(page.getByRole("heading", { name: "Phase 1" })).toBeVisible();
  await page.getByLabel("List name").fill("Build");
  await page.getByLabel("Folder", { exact: true }).selectOption({ label: "Phase 1" });
  await page.getByRole("button", { name: "Create list" }).click();
  await expect(page.getByRole("heading", { name: "Build" })).toBeVisible();

  // Add a task; it gets the project's first number.
  await page.getByLabel("New task title").fill("Homepage hero");
  await page.getByLabel("Status", { exact: true }).selectOption({ label: "To Do" });
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByText("Created WEB-1")).toBeVisible();
  await expect(
    page.getByRole("region", { name: /To Do/ }).getByRole("link", { name: "Homepage hero" }),
  ).toBeVisible();

  // Open it and edit fields.
  await page.getByRole("link", { name: "Homepage hero" }).click();
  await expect(page).toHaveURL(/\/t\/WEB-1$/);
  await page.getByLabel("Status", { exact: true }).selectOption({ label: "In Development" });
  await page.getByLabel("Priority").selectOption({ label: "High" });
  await page.getByLabel("Due date", { exact: true }).fill("2030-01-15");
  await page.getByLabel("Description").fill("Hero with video background.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await expect(page.getByText("changed status from To Do to In Development")).toBeVisible();

  // Assign it to myself, add a subtask.
  await page.getByRole("checkbox", { name: /Tess Tasks/ }).check();
  await page.getByRole("button", { name: "Save assignees" }).click();
  await expect(page.getByText("Assignees saved")).toBeVisible();
  await page.getByLabel("New subtask title").fill("Pick hero video");
  await page.getByRole("button", { name: "Add subtask" }).click();
  await expect(page.getByRole("link", { name: "Pick hero video" })).toBeVisible();
  await page.getByRole("link", { name: "Pick hero video" }).click();
  await expect(page).toHaveURL(/\/t\/WEB-2$/);
  await expect(page.getByText("Subtask of")).toBeVisible();

  // Customise this list's statuses: rename "To Do" to "Queued".
  await page.getByRole("link", { name: "Build" }).first().click();
  await page.getByRole("link", { name: "List settings & statuses" }).click();
  const toDoRow = page.getByRole("listitem").filter({ has: page.locator('input[value="To Do"]') });
  await toDoRow.getByLabel("Status name").fill("Queued");
  await toDoRow.getByRole("button", { name: "Save" }).click();
  await expect(page.locator('input[value="Queued"]')).toBeVisible();
  await page.getByRole("link", { name: /Back to Build/ }).click();
  await expect(
    page.getByRole("region", { name: /In Development/ }).getByRole("link", { name: "Homepage hero" }),
  ).toBeVisible();
  await expect(page.getByLabel("Status", { exact: true })).toContainText("Queued");
});
