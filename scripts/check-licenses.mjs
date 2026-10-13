// Fails if any installed package uses a licence outside the allowlist (docs/COST_AND_LICENSES.md §8).
// Reads package-lock.json plus each package's own package.json; no network access needed.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const PERMISSIVE = new Set([
  "MIT",
  "MIT-0",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "CC0-1.0",
  "Unlicense",
  "BlueOak-1.0.0",
  "Python-2.0",
  "CC-BY-4.0",
  "OFL-1.1",
  "SIL OPEN FONT LICENSE",
]);
// Weak copyleft: acceptable unmodified (e.g. MPL-2.0 file-level), reviewed case by case.
const REVIEWED_WEAK_COPYLEFT = new Set(["MPL-2.0", "LGPL-3.0-or-later"]);
// Packages whose licence metadata is missing or non-SPDX but was checked by hand.
const MANUALLY_VERIFIED = {
  // e.g. "some-package": "MIT (LICENSE file; package.json omits the field)",
};

function licenseOf(pkgPath) {
  const file = path.join(pkgPath, "package.json");
  if (!existsSync(file)) return undefined;
  const pkg = JSON.parse(readFileSync(file, "utf8"));
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(" OR ");
  return undefined;
}

function acceptable(expr) {
  const cleaned = expr.replace(/[()]/g, "").trim();
  // "A OR B": any acceptable alternative is enough. "A AND B": all must be acceptable.
  if (/ OR /.test(cleaned)) return cleaned.split(/ OR /).some((part) => acceptable(part));
  if (/ AND /.test(cleaned)) return cleaned.split(/ AND /).every((part) => acceptable(part));
  return PERMISSIVE.has(cleaned) || REVIEWED_WEAK_COPYLEFT.has(cleaned);
}

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const problems = [];
const seen = new Map();
for (const [location, meta] of Object.entries(lock.packages ?? {})) {
  if (!location.startsWith("node_modules/")) continue;
  const name = location.slice(location.lastIndexOf("node_modules/") + "node_modules/".length);
  if (MANUALLY_VERIFIED[name]) continue;
  const license = meta.license ?? licenseOf(location);
  if (!license) {
    if (!existsSync(location)) continue; // optional platform package not installed here
    problems.push(`${name}@${meta.version}: no licence declared`);
    continue;
  }
  seen.set(license, (seen.get(license) ?? 0) + 1);
  if (!acceptable(license)) problems.push(`${name}@${meta.version}: ${license}${meta.dev ? " (dev)" : ""}`);
}

const summary = [...seen.entries()]
  .sort((a, b) => b[1] - a[1])
  .map(([l, n]) => `${l}: ${n}`)
  .join(", ");
console.log(`Licences found — ${summary}`);
if (problems.length) {
  console.error(`\n${problems.length} package(s) need review:\n  ${problems.join("\n  ")}`);
  console.error(
    "\nAdd a reviewed exception to scripts/check-licenses.mjs and docs/COST_AND_LICENSES.md, or remove the dependency.",
  );
  process.exit(1);
}
console.log("All licences are on the allowlist.");
