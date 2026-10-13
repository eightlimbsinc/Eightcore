import path from "node:path";
import { defineConfig } from "vitest/config";
import { TEST_DATABASE_URL } from "./tests/support/test-db-urls.ts";

const alias = {
  "@": path.resolve(import.meta.dirname, "src"),
  // `server-only` throws outside the React Server Components graph; tests run server code directly.
  "server-only": path.resolve(import.meta.dirname, "tests/support/empty-module.ts"),
};

export default defineConfig({
  resolve: { alias },
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "integration",
          environment: "node",
          include: ["tests/integration/**/*.test.ts"],
          globalSetup: ["tests/support/global-setup.ts"],
          setupFiles: ["tests/support/setup-integration.ts"],
          // One database, cleaned between tests: run files serially.
          fileParallelism: false,
          testTimeout: 20_000,
          hookTimeout: 60_000,
          env: {
            NODE_ENV: "test",
            DATABASE_URL: TEST_DATABASE_URL,
            BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123",
            BETTER_AUTH_URL: "http://localhost:3000",
            MAIL_OUTBOX_DIR: ".mail/test",
            SMTP_URL: "",
          },
        },
      },
    ],
  },
});
