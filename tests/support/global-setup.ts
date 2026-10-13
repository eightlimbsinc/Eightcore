import { createTestDatabase } from "../../scripts/db/create-test-db";
import { MIGRATOR_ADMIN_URL, TEST_DATABASE_NAME } from "./test-db-urls";

export default async function setup(): Promise<void> {
  await createTestDatabase(MIGRATOR_ADMIN_URL, TEST_DATABASE_NAME);
}
