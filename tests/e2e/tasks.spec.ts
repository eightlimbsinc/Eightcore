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
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await page.getByLabel("New task title").fill("Homepage hero");
  await page.getByLabel("Description").fill("Big image, short headline.");
  await page.getByRole("button", { name: /^Status: / }).click();
  await page.getByRole("menuitem", { name: "To Do" }).click();
  await page.getByRole("button", { name: /^Priority: / }).click();
  await page.getByRole("menuitem", { name: "High" }).click();
  await expect(page.getByRole("button", { name: "Status: To Do" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Create task" }).click();
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
  await win.getByRole("button", { name: "Assignees: nobody" }).click();
  await page.getByLabel("Search people").fill("tess");
  await page.getByRole("option", { name: /Me/ }).click();
  await expect(win.getByRole("button", { name: "Assignees: Tess Tasks" })).toBeVisible();
  await page.keyboard.press("Escape");
  // Time tracking: the timer (also shown in the sidebar), time typed in, an estimate.
  await win.getByRole("button", { name: "Start timer" }).click();
  await expect(win.getByRole("button", { name: "Stop timer" })).toBeVisible();
  await expect(page.locator('[aria-label="Timer running on WEB-1"]')).toBeVisible();
  await win.getByRole("button", { name: "Stop timer" }).click();
  await expect(page.locator('[aria-label="Timer running on WEB-1"]')).toHaveCount(0);
  await win.getByRole("button", { name: "Log time" }).click();
  await page.getByLabel("Time spent").fill("1h 30m");
  await page.getByLabel("Note").fill("Hero layout");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("Time added")).toBeVisible();
  await expect(page.getByRole("list", { name: "Entries" })).toContainText("Hero layout");
  await page.keyboard.press("Escape");
  await expect(win.getByText(/^1h 3\dm$/)).toBeVisible();
  await win.getByRole("button", { name: "Time estimate: none" }).click();
  await win.getByLabel("Time estimate").fill("4h");
  await win.getByLabel("Time estimate").press("Enter");
  await expect(win.getByRole("button", { name: "Time estimate: 4h" })).toBeVisible();
  await expect(win.getByRole("meter", { name: "Tracked against estimate" })).toBeVisible();

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
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  await page.getByRole("button", { name: /^Status: / }).click();
  await expect(page.getByRole("menuitem", { name: "Queued" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

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
  // A second field, moved above the first with the arrow buttons.
  await page.getByPlaceholder("e.g. Budget").fill("Budget");
  await page.getByLabel("Type", { exact: true }).selectOption({ label: "Number" });
  await page.getByRole("button", { name: "Create field" }).click();
  await expect(page.getByText("Created “Budget”")).toBeVisible();
  const fieldOrder = page.getByRole("list", { name: "Fields in order" }).locator(":scope > li");
  await expect(fieldOrder.first().getByLabel("Field name")).toHaveValue("Channel");
  await page.getByRole("button", { name: "Move Budget up" }).click();
  await expect(fieldOrder.first().getByLabel("Field name")).toHaveValue("Budget");
  await page.reload();
  await expect(fieldOrder.first().getByLabel("Field name")).toHaveValue("Budget");

  await page.goto(page.url().replace(/\/p\/WEB\/fields$/, "/t/WEB-1"));
  await page.getByLabel("Channel", { exact: true }).selectOption({ label: "Social" });
  await page.getByRole("button", { name: "Save fields" }).click();
  await expect(page.getByText("Fields saved")).toBeVisible();
  await expect(page.getByText("updated the field “Channel”")).toBeVisible();

  // Dependencies (the side panel's Relationships tab): WEB-1 waits on WEB-2, and closing it asks first.
  await page
    .getByRole("navigation", { name: "Task panels" })
    .getByRole("button", { name: /^Relationships/ })
    .click();
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
  await page
    .getByRole("navigation", { name: "Task panels" })
    .getByRole("button", { name: /^Relationships/ })
    .click();
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
  await page.getByRole("button", { name: /^View options/ }).click();
  await page.getByRole("link", { name: "Last status first" }).click();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/order=desc/);
  await expect.poll(groupNames).toEqual([...firstOrder].reverse());

  // Subtasks expand under their parent, with their own pickers.
  await expect(page.getByRole("link", { name: "Pick hero video" })).toHaveCount(0);
  await page.getByRole("button", { name: "Show subtasks of WEB-1 Homepage hero" }).click();
  await expect(page.getByRole("link", { name: "Pick hero video" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Status of WEB-2:/ })).toBeVisible();
  await page.getByRole("button", { name: "Hide subtasks of WEB-1 Homepage hero" }).click();
  await expect(page.getByRole("link", { name: "Pick hero video" })).toHaveCount(0);

  // Assign from the list row, then unassign.
  const newRow = page.getByRole("listitem").filter({ hasText: "Cross-browser check" });
  await newRow.getByRole("button", { name: /^Assignees of .*: nobody$/ }).click();
  await page.getByRole("option", { name: /Me/ }).click();
  await expect(newRow.getByRole("button", { name: /^Assignees of .*: Tess Tasks$/ })).toBeVisible();
  await page.getByRole("option", { name: /Me/ }).click();
  await expect(newRow.getByRole("button", { name: /^Assignees of .*: nobody$/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // Priority and due date straight from the row.
  await newRow.getByRole("button", { name: /^Priority of .*: none$/ }).click();
  await page.getByRole("menuitem", { name: "Urgent" }).click();
  await expect(newRow.getByRole("button", { name: /^Priority of .*: Urgent$/ })).toBeVisible();
  await newRow.getByRole("button", { name: /^Due date of .*: none$/ }).click();
  await page.getByRole("button", { name: /^Tomorrow/ }).click();
  await expect(newRow.getByRole("button", { name: /^Due date of .*: (?!none)/ })).toBeVisible();
  await newRow.getByRole("button", { name: /^Due date of / }).click();
  await page.getByLabel("Due date", { exact: true }).last().fill("2031-05-20");
  await expect(newRow.getByRole("button", { name: "Due date of WEB-3: May 20, 2031" })).toBeVisible();
  await newRow.getByRole("button", { name: /^Due date of / }).click();
  await page.getByRole("button", { name: "Clear due date" }).click();
  await expect(newRow.getByRole("button", { name: /^Due date of .*: none$/ })).toBeVisible();

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

  // Save a view for everyone, then protect it.
  await page.getByRole("navigation", { name: "Projects" }).getByRole("link", { name: "Build" }).click();
  await page.getByRole("button", { name: /^View options/ }).click();
  await page.getByRole("group", { name: "Subtasks" }).getByRole("link", { name: "Expanded" }).click();
  await expect(page).toHaveURL(/subtasks=expanded/);
  await page.getByRole("button", { name: "Save view for everyone" }).click();
  await expect(page).toHaveURL(/\/l\/[^?]+$/);
  await expect(page.getByRole("link", { name: "Pick hero video" })).toBeVisible();
  await page.getByRole("button", { name: /^View options/ }).click();
  await page.getByRole("button", { name: /Protect view/ }).click();
  await expect(page.getByRole("button", { name: /^View options.*\(protected\)/ })).toBeVisible();
  await page.keyboard.press("Escape");

  // Right-click a row to archive it; the "⋯" button opens the same menu.
  page.once("dialog", (d) => void d.accept());
  await page
    .getByRole("listitem")
    .filter({ hasText: "Cross-browser check" })
    .locator("div")
    .first()
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Archive" }).click();
  await expect(page.getByRole("link", { name: "Cross-browser check" })).toHaveCount(0);
  page.once("dialog", (d) => {
    expect(d.message()).toContain("permanently");
    void d.accept();
  });
  await page.getByRole("button", { name: "Task actions for WEB-2" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await expect(page.getByRole("link", { name: "Pick hero video" })).toHaveCount(0);

  // Status rules: moving to "Final Review" needs a comment, asked for when the move happens.
  await page.getByRole("link", { name: /List settings/ }).click();
  await page.getByLabel("From status").selectOption({ label: "Any status" });
  await page.getByLabel("To status").selectOption({ label: "Final Review" });
  await page.getByRole("button", { name: "Add rule" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Rule saved" })).toBeVisible();
  await page.getByLabel("Needs a comment: Any status to Final Review").check();
  await expect(page.getByLabel("Needs a comment: Any status to Final Review")).toBeChecked();
  await page.getByRole("link", { name: /Back to Build/ }).click();
  await page.getByRole("button", { name: /^Status of WEB-1:/ }).click();
  await page.getByRole("menuitem", { name: "Final Review" }).click();
  const ask = page.getByRole("dialog", { name: "Add a comment" });
  await expect(ask).toContainText("needs a comment");
  await ask.getByLabel("Comment").fill("On staging now");
  await ask.getByRole("button", { name: "Move to Final Review" }).click();
  await expect(page.getByRole("button", { name: "Status of WEB-1: Final Review" })).toBeVisible();
  await page.goto(page.url().replace(/\/l\/[^/?]+.*$/, "/t/WEB-1"));
  await expect(page.getByText("On staging now")).toBeVisible();

  // QA rounds: fail one with a note, pass the retest; the history keeps both.
  await page.getByLabel("Test environment URL").fill("https://staging.example.test");
  await page.getByRole("button", { name: "Start QA round #1" }).click();
  const round = page.getByRole("region", { name: "QA round 1, in progress" });
  await expect(round).toBeVisible();
  await expect(round.getByRole("button", { name: "Fail" })).toBeDisabled();
  await round.getByLabel("QA notes").fill("Hero image is blurry on retina");
  await round.getByRole("button", { name: "Fail" }).click();
  const qaHistory = page.getByRole("list", { name: "QA history" });
  await expect(qaHistory).toContainText("Round #1");
  await expect(qaHistory).toContainText("Failed");
  await expect(qaHistory).toContainText("Hero image is blurry on retina");
  await page.getByRole("button", { name: "Start QA round #2" }).click();
  await page
    .getByRole("region", { name: "QA round 2, in progress" })
    .getByRole("button", { name: "Pass" })
    .click();
  await expect(qaHistory).toContainText("Round #2");
  await expect(qaHistory).toContainText("Passed");

  // Repeating: weekly; marking it done creates the next one.
  await page.getByRole("button", { name: "Repeat: doesn't repeat" }).click();
  await page
    .getByRole("dialog", { name: "Repeat" })
    .getByRole("button", { name: /^Weekly on / })
    .click();
  await expect(page.getByRole("button", { name: /^Repeat: Every week on / })).toBeVisible();
  await page.getByRole("button", { name: /^Status: / }).click();
  await page.getByRole("menuitem", { name: "Accepted" }).click();
  await expect(page.getByText(/was closed and repeats as WEB-\d+/)).toBeVisible();

  // Automations: comment on every new task (runs right after the change is saved).
  const base = new URL(page.url()).pathname.split("/").slice(0, 3).join("/");
  await page.goto(`${base}/p/WEB`);
  await page.getByRole("link", { name: "Automations" }).click();
  await expect(page.getByRole("heading", { name: "Automations" })).toBeVisible();
  await page.getByLabel("Name").fill("Welcome note");
  await page.getByLabel("Comment").fill("Thanks, we're on it.");
  await page.getByRole("button", { name: "Create automation" }).click();
  const rule = page.getByRole("article", { name: "Welcome note" });
  await expect(rule).toContainText("A task is created: comment.");

  // Per list: the ⚡ icon in the list header opens that list's automations.
  await page.getByRole("navigation", { name: "Projects" }).getByRole("link", { name: "Build" }).click();
  await page.getByRole("link", { name: "Automations" }).click();
  await expect(page.getByRole("heading", { name: "Automations: Build" })).toBeVisible();
  await expect(page.getByText("1 project-wide automation also applies here.")).toBeVisible();
  await page.getByLabel("Name").fill("Live → Make");
  await page.getByLabel("Trigger").selectOption("status_changed");
  await page.getByLabel("Action").selectOption("call_url");
  await page.getByLabel("Webhook address").fill("https://hook.us1.make.com/abc?type=LIVE");
  await page.getByRole("button", { name: "Create automation" }).click();
  await expect(page.getByRole("article", { name: "Live → Make" })).toContainText(
    "call webhook hook.us1.make.com",
  );

  // Make → Eightcore: an incoming address creates a task through the automation too.
  await page.getByRole("link", { name: "Integrations" }).click();
  await expect(page.getByRole("heading", { name: "Integrations" })).toBeVisible();
  await page.getByLabel("New address").fill("Make: support form");
  await page.getByRole("button", { name: "Create address" }).click();
  const address = await page.getByRole("status").locator("code").innerText();
  expect(address).toMatch(/\/api\/hooks\/ecin_/);
  await page.getByText("List ids").click();
  const listId = await page
    .getByRole("row", { name: /WEB · Phase 1 \/ Build/ })
    .locator("td")
    .nth(1)
    .innerText();
  const res = await page.request.post(new URL(address).pathname, {
    data: { action: "create_task", list_id: listId, title: "From the support form", priority: "urgent" },
  });
  expect(res.status()).toBe(201);
  const { task } = (await res.json()) as { task: { ref: string } };
  await expect
    .poll(async () => {
      await page.goto(`${base}/t/${task.ref}`);
      return page.getByText("Thanks, we're on it.").count();
    })
    .toBeGreaterThan(0);
  await expect(page.getByText("From the support form").first()).toBeVisible();

  // Docs: write one (it saves itself), add a sub-page, find it from the search palette.
  await page.goto(`${base}/p/WEB`);
  await page.getByRole("link", { name: "Docs" }).click();
  await expect(page.getByRole("heading", { name: "Docs" })).toBeVisible();
  await page.getByRole("button", { name: "New doc" }).click();
  await expect(page).toHaveURL(/\/docs\/[0-9a-f-]{36}$/);
  await page.getByLabel("Doc title").fill("Launch brief");
  const body = page.getByLabel("Doc content");
  await expect(page.getByRole("toolbar", { name: "Formatting" })).toBeVisible();
  await body.click();
  await page.getByRole("button", { name: "Heading 2" }).click();
  await page.keyboard.type("Goals");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Ship the hero by Friday.");
  await expect(page.getByRole("status").filter({ hasText: /^Saved / })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Doc title")).toHaveValue("Launch brief");
  await expect(page.getByLabel("Doc content").getByRole("heading", { name: "Goals" })).toBeVisible();
  await page.getByRole("button", { name: "Add sub-page" }).click();
  await expect(page.getByRole("navigation", { name: "Breadcrumb" })).toContainText("Launch brief");
  await page.getByLabel("Doc title").fill("Copy deck");
  await expect(page.getByRole("status").filter({ hasText: /^Saved / })).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder(/Search tasks, docs/).fill("hero by friday");
  await page.getByRole("option", { name: /Launch brief/ }).click();
  await expect(page.getByLabel("Doc title")).toHaveValue("Launch brief");
  await expect(page.getByRole("region", { name: "Sub-pages" })).toContainText("Copy deck");
});
