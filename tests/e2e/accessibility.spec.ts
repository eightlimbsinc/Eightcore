// Accessibility audit: every main page, light and dark, against WCAG 2.1 A/AA (axe-core).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { linkFromLatestMail } from "./mail";

const owner = { name: "Ally Audit", email: "ally@e2e.example.test", password: "ally passphrase 123" };

test.describe.configure({ mode: "serial" });
// A separate visitor IP for this spec (see AUTH_IP_HEADERS in playwright.config.ts).
test.use({ extraHTTPHeaders: { "x-e2e-client-ip": "203.0.113.4" } });

async function audit(page: Page, name: string) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  return violations.map(
    (v) =>
      `${name}: [${v.impact}] ${v.id} — ${v.help}\n` +
      v.nodes
        .slice(0, 4)
        .map((n) => `    ${n.target.join(" ")}  ${n.failureSummary?.split("\n").slice(1, 2).join("")}`)
        .join("\n"),
  );
}

test("main pages pass an automated WCAG 2.1 AA audit in light and dark mode", async ({ page }) => {
  test.setTimeout(180_000);
  const problems: string[] = [];
  problems.push(...(await page.goto("/sign-in").then(() => audit(page, "sign-in"))));

  // A workspace with a project, a list, a task with a comment and a tag.
  await page.goto("/sign-up");
  await page.getByLabel("Full name").fill(owner.name);
  await page.getByLabel("Work email").fill(owner.email);
  await page.getByLabel("Password").fill(owner.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await page.goto(await linkFromLatestMail(owner.email, "Verify"));
  await page.getByLabel("Workspace name").fill("Ally Agency");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.getByRole("link", { name: "New project" }).first().click();
  await page.getByLabel("Project name").fill("Access");
  await page.getByLabel("Key").fill("ACC");
  await page.getByRole("button", { name: "Create project" }).click();
  await page.getByLabel("List name").fill("Audit");
  await page.getByRole("button", { name: "Create list" }).click();
  await expect(page.getByRole("heading", { name: "Audit" })).toBeVisible();
  const listUrl = page.url();
  for (const title of ["Check contrast", "Label the forms"]) {
    await page.getByRole("button", { name: "Add task", exact: true }).click();
    await page.getByLabel("New task title").fill(title);
    await page.getByLabel("New task title").press("Enter");
    await expect(page.getByRole("link", { name: title })).toBeVisible();
  }
  const workspace = new URL(listUrl).pathname.split("/l/")[0]!;
  await page.goto(`${workspace}/t/ACC-1`);
  await page.getByLabel("New comment").fill("Looks good");
  await page.getByRole("button", { name: "Comment", exact: true }).click();
  await expect(page.getByText("Looks good")).toBeVisible();

  const pages: [string, string][] = [
    ["home", workspace],
    ["dashboard", `${workspace}/dashboard`],
    ["all tasks", `${workspace}/tasks`],
    ["inbox", `${workspace}/inbox`],
    ["members", `${workspace}/members`],
    ["project", `${workspace}/p/ACC`],
    ["list", listUrl],
    ["board", `${listUrl}/board`],
    ["calendar", `${listUrl}/calendar`],
    ["list settings", `${listUrl}/statuses`],
    ["task", `${workspace}/t/ACC-1`],
  ];
  for (const theme of ["Light", "Dark"]) {
    await page.goto(workspace);
    await page.getByRole("radio", { name: theme }).click();
    for (const [name, url] of pages) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      problems.push(...(await audit(page, `${name} (${theme.toLowerCase()})`)));
    }
  }
  // The add-task window and the command palette (dialogs).
  await page.goto(listUrl);
  await page.getByRole("button", { name: "Add task", exact: true }).click();
  problems.push(...(await audit(page, "add task window (dark)")));
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+k");
  problems.push(...(await audit(page, "command palette (dark)")));

  if (problems.length) console.log(problems.join("\n"));
  expect(problems, problems.join("\n")).toEqual([]);
});
