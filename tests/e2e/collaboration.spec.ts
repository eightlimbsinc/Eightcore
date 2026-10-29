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
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await page.getByLabel("New task title").fill("New logo");
  await page.getByRole("dialog").getByRole("button", { name: "Create task" }).click();
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
  await page.getByRole("button", { name: "Tags: none" }).click();
  await page.getByLabel("Search or create tags").fill("Client review");
  await page.getByRole("button", { name: "Create “Client review”" }).click();
  await expect(page.getByText("Created “Client review”")).toBeVisible();
  await expect(page.getByRole("menuitemcheckbox", { name: "Client review" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Tags: Client review" })).toBeVisible();
  await expect(page.getByText("added the tag “Client review”")).toBeVisible();

  // Attach a file to the task itself (Attachments, at the bottom of the task).
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

test("search and filters across the workspace and on a list", async ({ page }) => {
  await signIn(page, owner);
  await expect(page).toHaveURL(/\/w\//);
  await page.goto(`/w/${workspaceSlug}`);

  // All tasks: search as you type.
  await page.getByRole("link", { name: "All tasks" }).click();
  await expect(page.getByRole("heading", { name: "Tasks" })).toBeVisible();
  await page.getByLabel("Search tasks").fill("logo");
  await expect(page).toHaveURL(/q=logo/);
  await expect(page.getByRole("link", { name: "New logo" })).toBeVisible();
  await page.getByLabel("Search tasks").fill("zzz-nothing");
  await expect(page.getByText("No tasks match.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("link", { name: "New logo" })).toBeVisible();

  // Filter menu: by tag, then "My Work" (nothing assigned to Cora yet).
  await page.getByRole("button", { name: "Filters" }).click();
  await page
    .getByRole("group", { name: "Tags" })
    .getByRole("menuitemcheckbox", { name: "Client review" })
    .click();
  await expect(page).toHaveURL(/tag=Client/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: "New logo" })).toBeVisible();
  await page.getByRole("link", { name: "My Work" }).click();
  await expect(page.getByRole("heading", { name: "My Work" })).toBeVisible();
  await expect(page.getByText("No tasks match.")).toBeVisible();
  // Nothing late (like a delayed search update) takes the page elsewhere.
  await page.waitForTimeout(600);
  await expect(page).toHaveURL(/assignee=me/);

  // On a list: filter by priority, nothing matches, clear again.
  const projectsNav = page.getByRole("navigation", { name: "Projects" });
  await projectsNav.getByRole("button", { name: "Expand Brand" }).click();
  await projectsNav.getByRole("link", { name: "Design" }).click();
  await expect(page.getByRole("heading", { name: "Design" })).toBeVisible();
  await page.getByRole("button", { name: "Filters" }).click();
  await page
    .getByRole("group", { name: "Priority" })
    .getByRole("menuitemcheckbox", { name: "Urgent" })
    .click();
  await page.keyboard.press("Escape");
  await expect(page.getByText("No tasks match these filters.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByRole("link", { name: "New logo" })).toBeVisible();
});

test("the dashboard summarises work and links to the matching tasks", async ({ page }) => {
  await signIn(page, owner);
  await expect(page).toHaveURL(/\/w\//);
  await page.goto(`/w/${workspaceSlug}`);
  await page.getByRole("link", { name: "Dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  // "New logo" is the one open task; it is unassigned and tagged "Client review".
  await expect(page.getByRole("link", { name: /Open tasks\s*1/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Top tags" })).toContainText("Client review");

  await page
    .getByRole("link", { name: /Unassigned\s*1/ })
    .first()
    .click();
  await expect(page).toHaveURL(/assignee=none/);
  await expect(page.getByRole("link", { name: "New logo" })).toBeVisible();

  // Focusing on a project keeps the drill-down within it.
  await page.goto(`/w/${workspaceSlug}/dashboard`);
  await page.getByRole("navigation", { name: "Dashboard for" }).getByRole("link", { name: "Brand" }).click();
  await expect(page).toHaveURL(/project=BRD/);
  await page.getByRole("link", { name: /Open tasks\s*1/ }).click();
  await expect(page).toHaveURL(/project=BRD/);
  await expect(page.getByText("only")).toBeVisible();
});

test("the board moves tasks between statuses, also by keyboard", async ({ page }) => {
  await signIn(page, owner);
  await expect(page).toHaveURL(/\/w\//);
  await page.goto(`/w/${workspaceSlug}`);
  const projectsNav = page.getByRole("navigation", { name: "Projects" });
  await projectsNav.getByRole("button", { name: "Expand Brand" }).click();
  await projectsNav.getByRole("link", { name: "Design" }).click();
  await page.getByRole("navigation", { name: "Layout" }).getByRole("link", { name: "Board" }).click();
  await expect(page).toHaveURL(/\/board/);

  const columns = page.getByRole("list", { name: "Board columns" });
  const card = page.getByRole("button", { name: "BRD-1 New logo" });
  await expect(columns.getByRole("listitem", { name: /^Backlog, 1 task/ })).toBeVisible();

  // Keyboard drag: focus the card, Space to lift, Right arrow to the next column, Space to drop.
  await card.focus();
  await page.keyboard.press("Space");
  await expect(page.getByText(/New logo is over Backlog/)).toBeAttached();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByText(/New logo is over To Do/)).toBeAttached();
  await page.keyboard.press("Space");
  await expect(columns.getByRole("listitem", { name: /^To Do, 1 task/ })).toBeVisible();
  await page.reload();
  await expect(columns.getByRole("listitem", { name: /^To Do, 1 task/ })).toContainText("New logo");

  // Right-click works on cards too.
  await card.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: /Copy ID/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // The task's history shows the status change.
  await page.getByRole("link", { name: "New logo" }).click();
  await expect(page.getByRole("dialog").getByText("changed status from Backlog to To Do")).toBeVisible();
});

test("the calendar schedules and reschedules tasks by dragging", async ({ page }) => {
  await signIn(page, owner);
  await expect(page).toHaveURL(/\/w\//);
  await page.goto(`/w/${workspaceSlug}`);
  const projectsNav = page.getByRole("navigation", { name: "Projects" });
  await projectsNav.getByRole("button", { name: "Expand Brand" }).click();
  await projectsNav.getByRole("link", { name: "Design" }).click();
  await page.getByRole("navigation", { name: "Layout" }).getByRole("link", { name: "Calendar" }).click();
  await expect(page).toHaveURL(/\/calendar/);

  // "New logo" has no due date yet: drag it from the side panel onto today.
  const undated = page.getByRole("region", { name: /^No due date/ });
  const chip = page.getByRole("button", { name: "BRD-1 New logo" });
  await expect(undated.getByRole("button", { name: "BRD-1 New logo" })).toBeVisible();
  const today = page.getByRole("gridcell", { name: /, today:/ });
  await page.setViewportSize({ width: 1400, height: 1100 });
  await today.scrollIntoViewIfNeeded();
  const from = (await chip.boundingBox())!;
  const to = (await today.boundingBox())!;
  await page.mouse.move(from.x + 10, from.y + 8);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + 12, { steps: 4 });
  // Aim near the top of the cell: dragging near the window's edge scrolls the page.
  await page.mouse.move(to.x + to.width / 2, to.y + 28, { steps: 15 });
  await page.mouse.up();
  await expect(today.getByRole("button", { name: "BRD-1 New logo" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("gridcell", { name: /, today: 1 task/ })).toContainText("New logo");

  // Keyboard: one day later (in week view, so tomorrow is always on screen).
  await page.getByRole("navigation", { name: "Calendar range" }).getByRole("link", { name: "Week" }).click();
  await expect(page).toHaveURL(/cal=week/);
  const todayName = await page.getByRole("gridcell", { name: /, today:/ }).getAttribute("aria-label");
  const todayDate = todayName!.split(",")[0]!; // e.g. "Oct 23"
  await chip.focus();
  await page.keyboard.press("Space");
  await expect(page.getByText(`New logo is over ${todayDate}.`)).toBeAttached();
  await page.keyboard.press("ArrowRight");
  // Wait until it is over another day before dropping.
  await expect(
    page.getByText(new RegExp(`New logo is over (?!${todayDate}\\.)\\w{3} \\d+\\.`)),
  ).toBeAttached();
  await page.keyboard.press("Space");
  await expect(page.getByRole("gridcell", { name: /, today: 0 tasks/ })).toBeVisible();
});

test("Ctrl+K finds tasks and jumps anywhere", async ({ page }) => {
  await signIn(page, owner);
  await expect(page).toHaveURL(/\/w\//);
  await page.goto(`/w/${workspaceSlug}`);

  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "Search or jump to" });
  await expect(palette).toBeVisible();
  await palette.getByRole("combobox").fill("logo");
  await expect(palette.getByRole("option", { name: /BRD-1\s*New logo/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/t\/BRD-1$/);

  // By ID, then pages and commands by name.
  await page.goto(`/w/${workspaceSlug}`);
  await page.getByRole("button", { name: /Search or jump to/ }).click();
  await palette.getByRole("combobox").fill("brd-1");
  await expect(palette.getByRole("option", { name: /BRD-1\s*New logo/ })).toBeVisible();
  await palette.getByRole("combobox").fill("dashboard");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.keyboard.press("Control+k");
  await palette.getByRole("combobox").fill("dark theme");
  await page.keyboard.press("Enter");
  await expect(page.locator("html")).toHaveClass(/dark/);
});

test("bulk actions change and archive many tasks at once", async ({ page }) => {
  await signIn(page, owner);
  await expect(page).toHaveURL(/\/w\//);
  await page.goto(`/w/${workspaceSlug}`);
  const projectsNav = page.getByRole("navigation", { name: "Projects" });
  await projectsNav.getByRole("button", { name: "Expand Brand" }).click();
  await projectsNav.getByRole("link", { name: "Design" }).click();
  for (const title of ["Bulk one", "Bulk two", "Bulk three"]) {
    await page.getByRole("button", { name: "Add task", exact: true }).click();
    await page.getByLabel("New task title").fill(title);
    await page.getByLabel("New task title").press("Enter");
    await expect(page.getByRole("link", { name: title })).toBeVisible();
  }

  // Keyboard: j/k move between rows, x selects, Enter opens, ? shows the shortcuts.
  const focused = page.locator("[data-row]:focus");
  await page.keyboard.press("j");
  await expect(focused).toHaveCount(1);
  for (let i = 0; i < 10 && !/Bulk one$/.test((await focused.getAttribute("aria-label")) ?? ""); i++) {
    await page.keyboard.press("j");
  }
  await expect(focused).toHaveAttribute("aria-label", /BRD-\d+ Bulk one$/);
  await page.keyboard.press("j");
  await expect(focused).toHaveAttribute("aria-label", /Bulk two$/);
  await page.keyboard.press("k");
  await expect(focused).toHaveAttribute("aria-label", /Bulk one$/);
  await page.keyboard.press("x");
  await expect(page.getByRole("checkbox", { name: /^Select BRD-\d+ Bulk one$/ })).toBeChecked();
  await page.keyboard.press("x");
  await expect(page.getByRole("checkbox", { name: /^Select BRD-\d+ Bulk one$/ })).not.toBeChecked();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/t\/BRD-\d+$/);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/l\//);
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("n");
  await expect(page.getByLabel("New task title")).toBeFocused();
  await page.keyboard.press("Escape");

  // Click the first, Shift+click the last: all three are selected.
  await page.getByRole("checkbox", { name: /^Select BRD-\d+ Bulk one$/ }).click();
  await page.getByRole("checkbox", { name: /^Select BRD-\d+ Bulk three$/ }).click({ modifiers: ["Shift"] });
  const bar = page.getByRole("toolbar", { name: "Bulk actions" });
  await expect(bar.getByText("3 tasks selected")).toBeVisible();

  await bar.getByRole("button", { name: "Priority" }).click();
  await page.getByRole("menuitem", { name: "High" }).click();
  await expect(bar.getByRole("status")).toHaveText("Updated 3 tasks");
  await expect(page.getByRole("button", { name: /Priority of BRD-\d+: High/ })).toHaveCount(3);

  page.once("dialog", (d) => void d.accept());
  await bar.getByRole("button", { name: "Archive" }).click();
  await expect(bar.getByRole("status")).toHaveText("Archived 3 tasks");
  await expect(page.getByRole("link", { name: "Bulk two" })).toHaveCount(0);
  await expect(page.getByText("tasks selected")).toHaveCount(0);
});

test("projects, folders and lists get their own icon and colour", async ({ page }) => {
  await signIn(page, owner);
  await expect(page).toHaveURL(/\/w\//);
  await page.goto(`/w/${workspaceSlug}`);
  const projectsNav = page.getByRole("navigation", { name: "Projects" });
  await projectsNav.getByRole("button", { name: "Expand Brand" }).click();

  await projectsNav.getByRole("button", { name: "Change icon and colour of project Brand" }).click();
  const picker = page.getByRole("dialog", { name: "Icon and colour for Brand" });
  await picker.getByRole("radio", { name: "Blue" }).click();
  await picker.getByRole("radio", { name: "Rocket" }).click();
  await expect(picker.getByRole("radio", { name: "Rocket" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");

  await projectsNav.getByRole("button", { name: "Change icon and colour of list Design" }).click();
  await page
    .getByRole("dialog", { name: "Icon and colour for Design" })
    .getByRole("radio", { name: "Palette" })
    .click();
  await page.keyboard.press("Escape");

  // Saved: still chosen after a reload.
  await page.reload();
  await projectsNav.getByRole("button", { name: "Change icon and colour of project Brand" }).click();
  await expect(picker.getByRole("radio", { name: "Rocket" })).toHaveAttribute("aria-checked", "true");
  await expect(picker.getByRole("radio", { name: "Blue" })).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");
});

test("a tab from before a release reloads itself instead of crashing", async ({ page }) => {
  await signIn(page, owner);
  await expect(page).toHaveURL(/\/w\//);
  await page.goto(`/w/${workspaceSlug}`);
  const projectsNav = page.getByRole("navigation", { name: "Projects" });
  await projectsNav.getByRole("button", { name: "Expand Brand" }).click();
  await projectsNav.getByRole("link", { name: "Design" }).click();
  await expect(page.getByRole("link", { name: "New logo" })).toBeVisible();

  // What a new release answers to an old tab's Server Action.
  await page.route("**/*", (route) =>
    route.request().method() === "POST" && route.request().headers()["next-action"]
      ? route.fulfill({ status: 404, headers: { "x-nextjs-action-not-found": "1" }, body: "" })
      : route.fallback(),
  );
  const reloaded = page.waitForEvent("load");
  await page.getByRole("button", { name: /^Priority of BRD-1/ }).click();
  await page.getByRole("menuitem", { name: "Low" }).click();
  await reloaded;
  await expect(page.getByRole("link", { name: "New logo" })).toBeVisible();
  await expect(page.getByText("This page couldn’t load")).toHaveCount(0);
});

test("Completed tasks hide behind Closed; finished groups collapse; status templates", async ({ page }) => {
  await signIn(page, owner);
  await expect(page).toHaveURL(/\/w\//);
  await page.goto(`/w/${workspaceSlug}`);
  const projectsNav = page.getByRole("navigation", { name: "Projects" });
  await projectsNav.getByRole("button", { name: "Expand Brand" }).click();
  await projectsNav.getByRole("link", { name: "Design" }).click();
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await page.getByLabel("New task title").fill("Old work");
  await page.getByLabel("New task title").press("Enter");
  await expect(page.getByRole("link", { name: "Old work" })).toBeVisible();

  // Completed: gone from the list until "Closed" is turned on.
  await page
    .getByRole("button", { name: /^Status of BRD-\d+: Backlog/ })
    .last()
    .click();
  await page.getByRole("menuitem", { name: "Completed" }).click();
  await expect(page.getByRole("link", { name: "Old work" })).toHaveCount(0);
  await page.getByRole("link", { name: "Show closed tasks (1)" }).click();
  await expect(page).toHaveURL(/closed=show/);
  await expect(page.getByRole("link", { name: "Old work" })).toBeVisible();

  // Any group can be collapsed.
  await page.getByRole("button", { name: "Collapse Completed" }).click();
  await expect(page.getByRole("link", { name: "Old work" })).toHaveCount(0);
  await page.getByRole("button", { name: "Expand Completed" }).click();

  // Done statuses (Accepted) start collapsed.
  await page.getByRole("button", { name: /^Status of BRD-\d+: Completed/ }).click();
  await page.getByRole("menuitem", { name: "Accepted" }).click();
  await page.getByRole("link", { name: "Hide closed tasks" }).click();
  await expect(page.getByRole("button", { name: "Expand Accepted" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Old work" })).toHaveCount(0);
  await page.getByRole("button", { name: "Expand Accepted" }).click();
  await expect(page.getByRole("link", { name: "Old work" })).toBeVisible();

  // Status templates: save this list's statuses, apply another set, reuse the saved one.
  await page.getByRole("link", { name: /List settings/ }).click();

  await page.getByLabel("Save this list's statuses as a template").fill("Brand flow");
  await page.getByRole("button", { name: "Save as template" }).click();
  await expect(page.getByText("Saved “Brand flow” as a template")).toBeVisible();
  const templates = page.getByRole("list", { name: "Status templates" });
  await expect(templates).toContainText("Brand flow");

  page.once("dialog", (d) => void d.accept());
  await templates.getByRole("button", { name: "Apply Simple" }).click();
  await expect(page.getByText(/Template applied\./)).toBeVisible();
  await expect(page.locator('input[value="In Progress"]')).toBeVisible();
  await expect(page.locator('input[value="Backlog"]')).toHaveCount(0);

  // The saved template is offered when creating a list.
  await page.goto(`/w/${workspaceSlug}/p/BRD`);
  await expect(page.getByRole("radio", { name: /Brand flow/ })).toBeVisible();
});
