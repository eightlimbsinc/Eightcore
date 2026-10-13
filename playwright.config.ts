import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;
const appDatabaseUrl = (() => {
  const u = new URL(
    process.env.DATABASE_URL ?? "postgres://eightcore_app:eightcore@localhost:5432/eightcore",
  );
  u.pathname = "/eightcore_e2e";
  return u.toString();
})();

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Optional: point at an already-installed Chromium instead of `npx playwright install`.
        launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined },
      },
    },
  ],
  webServer: {
    // Fresh database every run, then the production build (run `npm run build` first).
    command: `npx tsx scripts/db/create-test-db.ts eightcore_e2e && npx next start -p ${PORT}`,
    url: `${BASE_URL}/sign-in`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      NODE_ENV: "production",
      DATABASE_URL: appDatabaseUrl,
      BETTER_AUTH_URL: BASE_URL,
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "e2e-secret-e2e-secret-e2e-secret-0123456",
      SMTP_URL: "",
      MAIL_OUTBOX_DIR: ".mail/e2e",
      // Production mode refuses to drop mail on disk; allow it only for this local test server.
      EIGHTCORE_ALLOW_FILE_MAIL: "1",
    },
  },
});
