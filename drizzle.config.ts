import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  casing: "snake_case",
  dbCredentials: {
    url:
      process.env.DATABASE_MIGRATOR_URL ?? "postgres://eightcore_migrator:eightcore@localhost:5432/eightcore",
  },
  strict: true,
  verbose: true,
});
