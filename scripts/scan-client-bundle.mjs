// After `next build`: fails if anything secret-looking reached the browser bundles.
// Checks server-only env var *names* and the actual secret *values* from the environment.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";

for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);

const CLIENT_DIR = ".next/static";
if (!existsSync(CLIENT_DIR)) {
  console.error(`${CLIENT_DIR} not found. Run "npm run build" first.`);
  process.exit(1);
}

const SECRET_NAMES = [
  "DATABASE_URL",
  "DATABASE_MIGRATOR_URL",
  "BETTER_AUTH_SECRET",
  "EIGHTCORE_ENCRYPTION_KEY",
  "SMTP_URL",
];
const needles = [
  ...SECRET_NAMES.map((name) => ({ label: `env var name ${name}`, value: name })),
  { label: "postgres connection string", value: "postgres://" },
  { label: "postgresql connection string", value: "postgresql://" },
  ...SECRET_NAMES.filter((n) => (process.env[n] ?? "").length >= 8).map((n) => ({
    label: `value of ${n}`,
    value: process.env[n],
  })),
];

// Known-safe references: code that *reads* a variable at runtime (empty in the browser),
// never its value. Each entry must explain why it is safe.
const ALLOWED_CONTEXTS = [
  // better-auth's shared env helper: `get BETTER_AUTH_SECRET(){return l("BETTER_AUTH_SECRET")}`.
  /get BETTER_AUTH_SECRET\(\)\{return [a-zA-Z_$]+\("BETTER_AUTH_SECRET"\)\}/g,
];

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.(js|mjs|css|json|html|txt|map)$/.test(entry)) yield full;
  }
}

const findings = [];
let scanned = 0;
for (const file of files(CLIENT_DIR)) {
  scanned++;
  let content = readFileSync(file, "utf8");
  for (const pattern of ALLOWED_CONTEXTS) content = content.replace(pattern, "");
  for (const needle of needles) if (content.includes(needle.value)) findings.push(`${file}: ${needle.label}`);
}

if (findings.length) {
  console.error(`Secrets or server config found in client bundles:\n  ${findings.join("\n  ")}`);
  process.exit(1);
}
console.log(`Scanned ${scanned} client files: no secrets or server-only config found.`);
