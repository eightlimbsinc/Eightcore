// Times the main pages in a real browser (median of 3 loads) against a running build.
// Usage (after `npm run db:seed`, `npm run perf:seed`, `npm run build`, `npx next start`):
//   node scripts/perf/measure-pages.mjs /w/demo/l/<list id printed by perf:seed>
// Env: BASE_URL (default http://localhost:3000), PERF_EMAIL / PERF_PASSWORD (demo owner),
//      PLAYWRIGHT_CHROMIUM_EXECUTABLE (optional browser path).
import { chromium } from "@playwright/test";

const LIST = process.argv[2];
if (!LIST) throw new Error("Pass the list path, e.g. /w/demo/l/<id>");
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${BASE}/sign-in`);
await page.getByLabel("Email").fill(process.env.PERF_EMAIL ?? "owner@demo.eightcore.local");
await page.getByLabel("Password").fill(process.env.PERF_PASSWORD ?? "eightcore demo password");
await page.getByRole("button", { name: "Sign in" }).click();
await page.waitForURL(/\/w\//);

const workspace = LIST.split("/l/")[0];
const pages = [
  ["list", LIST],
  ["list (subtasks expanded)", `${LIST}?subtasks=expanded`],
  ["board", `${LIST}/board`],
  ["calendar", `${LIST}/calendar`],
  ["all tasks", `${workspace}/tasks`],
  ["search", `${workspace}/tasks?q=checkout`],
  ["dashboard", `${workspace}/dashboard`],
];
for (const [name, url] of pages) {
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const res = await page.goto(`${BASE}${url}`, { waitUntil: "load" });
    const t = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0];
      return { ttfb: n.responseStart, load: n.loadEventEnd, size: n.decodedBodySize };
    });
    runs.push({ ...t, status: res?.status() });
  }
  const m = runs.sort((a, b) => a.load - b.load)[1];
  console.log(
    `${name.padEnd(26)} ${m.status}  server ${Math.round(m.ttfb)}ms  loaded ${Math.round(m.load)}ms  html ${(m.size / 1024).toFixed(0)}KB`,
  );
}
await page.goto(`${BASE}${LIST}`);
const t0 = Date.now();
await page.locator('a[href*="/t/"]').first().click();
await page.getByRole("dialog").waitFor();
console.log(`${"open a task from the list".padEnd(26)} ${Date.now() - t0}ms`);
await browser.close();
