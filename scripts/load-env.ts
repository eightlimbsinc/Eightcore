// Loads .env.local / .env for CLI scripts (Next.js does this itself for the app).
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function loadEnvFiles(): void {
  for (const file of [".env.local", ".env"]) {
    if (existsSync(file)) process.loadEnvFile(file);
  }
}

/** True when the module is the script being run (works with Windows paths too). */
export function isMainModule(moduleUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && pathToFileURL(path.resolve(entry)).href === moduleUrl;
}
