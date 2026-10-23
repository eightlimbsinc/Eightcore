// Connection options for CLI scripts: like the app's, plus DATABASE_SSL_CA_FILE (a path).
import { readFileSync } from "node:fs";
import { connectionOptionsFromEnv, type ConnectionOptions } from "../../src/server/db/connection";

export function scriptConnectionOptions(
  env: Record<string, string | undefined> = process.env,
): ConnectionOptions {
  const options = connectionOptionsFromEnv(env);
  if (!options.caPem && env.DATABASE_SSL_CA_FILE)
    options.caPem = readFileSync(env.DATABASE_SSL_CA_FILE, "utf8");
  return options;
}
