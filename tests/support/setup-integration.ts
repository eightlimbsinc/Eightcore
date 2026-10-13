import { afterAll, beforeEach } from "vitest";
import { closeDb } from "@/server/db";
import { closeAdminPool, truncateAll } from "./db";

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeDb();
  await closeAdminPool();
});
