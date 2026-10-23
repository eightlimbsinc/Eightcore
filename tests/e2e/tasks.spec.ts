// Phase 3a journey: lists with their own statuses, tasks, subtasks, assignees.
import { expect, test } from "@playwright/test";
import { linkFromLatestMail } from "./mail";

const owner = { name: "Tess Tasks", email: "tess@e2e.example.test", password: "tess passphrase 123" };

test.describe.configure({ mode: "serial" });
// A separate visitor IP for this spec (see AUTH_IP_HEADERS in playwright.config.ts).
test.use({ extraHTTPHeaders: { "x-e2e-client-ip": "203.0.113.2" } });

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

  // The side navigation shows the project's folder and list.
  const sidebar = page.getByRole("navigation", { name: "Projects" });
  await expect(sidebar.getByText("Phase 1")).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Build" })).toHaveAttribute("aria-current", "page");
  await sidebar.getByRole("button", { name: "Collapse Website" }).click();
  await expect(sidebar.getByRole("link", { name: "Build" })).toBeHidden();
  await sidebar.getByRole("button", { name: "Expand Website" }).click();

  // Add a task; it gets the project's first number.
  await page.getByLabel("New task title").fill("Homepage hero");
  await page.getByLabel("Status", { exact: true }).selectOption({ label: "To Do" });
  await page.getByRole("button", { name: "Add task" }).click();
  await expect(page.getByText("Created WEB-1")).toBeVisible();
  await expect(
    page.getByRole("region", { name: /To Do/ }).getByRole("link", { name: "Homepage hero" }),
  ).toBeVisible();

  // Opening it from the list shows it in a window; the address is the task's own link.
  await page.getByRole("link", { name: "Homepage hero" }).click();
  await expect(page).toHaveURL(/\/t\/WEB-1$/);
  const win = page.getByRole("dialog", { name: "Task WEB-1" });
  await expect(win).toBeVisible();
  await page.getByRole("button", { name: "Status: To Do" }).click();
  await page.getByRole("menuitem", { name: "In Development" }).click();
  await expect(page.getByRole("button", { name: "Status: In Development" })).toBeVisible();
  await win.getByLabel("Priority").selectOption({ label: "High" });
  await win.getByLabel("Due date", { exact: true }).fill("2030-01-15");
  await win.getByLabel("Description").fill("Hero with video background.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(win.getByText("Saved", { exact: true })).toBeVisible();
  await expect(win.getByText("changed status from To Do to In Development")).toBeVisible();

  // Assign it to myself, add a subtask.
  await page.getByRole("checkbox", { name: /Tess Tasks/ }).check();
  await page.getByRole("button", { name: "Save assignees" }).click();
  await expect(win.getByText("Assignees saved")).toBeVisible();
  await win.getByLabel("New subtask title").fill("Pick hero video");
  await page.getByRole("button", { name: "Add subtask" }).click();
  await expect(page.getByRole("link", { name: "Pick hero video" })).toBeVisible();
  await page.getByRole("link", { name: "Pick hero video" }).click();
  await expect(page).toHaveURL(/\/t\/WEB-2$/);
  await expect(page.getByRole("dialog", { name: "Task WEB-2" }).getByText("Subtask of")).toBeVisible();

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

  // Manage folders and lists from the side navigation.
  await sidebar.getByRole("button", { name: "Add to Website" }).click();
  await page.getByRole("menuitem", { name: "New folder" }).click();
  await sidebar.getByLabel("New folder name").fill("Phase 2");
  await sidebar.getByLabel("New folder name").press("Enter");
  await expect(sidebar.getByText("Phase 2")).toBeVisible();
  // An empty folder shows no placeholder rows.
  await expect(sidebar.getByText("Empty")).toHaveCount(0);

  await sidebar.getByRole("button", { name: "Folder options for Phase 2" }).click();
  await page.getByRole("menuitem", { name: "New list in folder" }).click();
  await sidebar.getByLabel("New list name").fill("QA");
  await sidebar.getByLabel("New list name").press("Enter");
  await expect(page.getByRole("heading", { name: "QA" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "QA" })).toHaveAttribute("aria-current", "page");

  await sidebar.getByRole("button", { name: "List options for QA" }).click();
  await page.getByRole("menuitem", { name: "Rename list" }).click();
  await sidebar.getByLabel("List name").fill("Quality checks");
  await sidebar.getByLabel("List name").press("Enter");
  await expect(sidebar.getByRole("link", { name: "Quality checks" })).toBeVisible();

  page.once("dialog", (d) => void d.accept());
  await sidebar.getByRole("button", { name: "List options for Quality checks" }).click();
  await page.getByRole("menuitem", { name: "Delete list" }).click();
  await expect(sidebar.getByRole("link", { name: "Quality checks" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/p\/WEB$/);

  page.once("dialog", (d) => void d.accept());
  await sidebar.getByRole("button", { name: "Folder options for Phase 2" }).click();
  await page.getByRole("menuitem", { name: "Delete folder" }).click();
  await expect(sidebar.getByText("Phase 2")).toHaveCount(0);
  await expect(sidebar.getByText("Phase 1")).toBeVisible();

  // Custom fields: a project-wide dropdown, filled in on a task.
  await page.getByRole("link", { name: "Custom fields" }).click();
  await page.getByLabel("Field name", { exact: true }).fill("Channel");
  await page.getByLabel("Type", { exact: true }).selectOption({ label: "Dropdown" });
  await page.getByLabel("Options", { exact: true }).fill("Social\nEmail");
  await page.getByRole("button", { name: "Create field" }).click();
  await expect(page.getByText("Created “Channel”")).toBeVisible();
  await expect(page.getByRole("list", { name: "Options of Channel" })).toContainText("Email");

  await page.goto(page.url().replace(/\/p\/WEB\/fields$/, "/t/WEB-1"));
  await page.getByLabel("Channel", { exact: true }).selectOption({ label: "Social" });
  await page.getByRole("button", { name: "Save fields" }).click();
  await expect(page.getByText("Fields saved")).toBeVisible();
  await expect(page.getByText("updated the field “Channel”")).toBeVisible();

  // Dependencies: WEB-1 waits on WEB-2, and closing it asks first.
  await page.getByLabel("Task reference").fill("WEB-2");
  await page.getByRole("button", { name: "Link" }).click();
  await expect(page.getByText("Dependency added")).toBeVisible();
  await expect(page.getByRole("list", { name: "Blocked by" })).toContainText("Pick hero video");
  await expect(page.getByText("Blocked", { exact: true }).first()).toBeVisible();
  page.once("dialog", (d) => {
    expect(d.message()).toContain("still blocked");
    void d.dismiss();
  });
  await page.getByRole("button", { name: "Status: In Development" }).click();
  await page.getByRole("menuitem", { name: "Accepted" }).click();
  await expect(page.getByRole("button", { name: "Status: In Development" })).toBeVisible();

  // The list row shows both.
  await page.getByRole("link", { name: "Build" }).first().click();
  const row = page.getByRole("listitem").filter({ hasText: "Homepage hero" });
  await expect(row.getByText("Blocked")).toBeVisible();
  await expect(row.getByLabel("Custom fields")).toContainText("Social");

  // The blocker's page shows the other side; unlinking clears the badge.
  await page.goto(page.url().replace(/\/l\/[^/]+$/, "/t/WEB-2"));
  await expect(page.getByRole("list", { name: "Blocking" })).toContainText("Homepage hero");
  await page.getByRole("button", { name: "Remove link to WEB-1" }).click();
  await expect(page.getByText("No tasks are waiting on this one.")).toBeVisible();

  // List view: change status from the row's icon, add a task under a group, flip the group order.
  await page.getByRole("navigation", { name: "Projects" }).getByRole("link", { name: "Build" }).click();
  await expect(page.getByRole("heading", { name: "Build" })).toBeVisible();
  await page.getByRole("button", { name: /^Status of WEB-1:/ }).click();
  await page.getByRole("menuitem", { name: "Ready to Test" }).click();
  await expect(
    page.getByRole("region", { name: /Ready to Test/ }).getByRole("link", { name: "Homepage hero" }),
  ).toBeVisible();
  const readyToTest = page.getByRole("region", { name: /Ready to Test/ });
  await readyToTest.getByRole("button", { name: "Add Task" }).click();
  await page.getByLabel("New task in Ready to Test").fill("Cross-browser check");
  await page.getByLabel("New task in Ready to Test").press("Enter");
  await expect(readyToTest.getByRole("link", { name: "Cross-browser check" })).toBeVisible();

  const groupNames = () => page.getByRole("region").locator("h2").allInnerTexts();
  const firstOrder = await groupNames();
  await page.getByRole("link", { name: /Show last to first/ }).click();
  await expect(page).toHaveURL(/order=desc/);
  await expect.poll(groupNames).toEqual([...firstOrder].reverse());

  // The window can open the full page, and Escape closes it.
  await page.getByRole("link", { name: "Cross-browser check" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page).toHaveURL(/\/l\/.+order=desc/);
  await page.getByRole("link", { name: "Cross-browser check" }).click();
  await page.getByRole("link", { name: "Open full page" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Cross-browser check" })).toBeVisible();
});
