// Checks that browsers can upload straight to your file storage (needed for files over ~3 MB).
//   npm run storage:check:supabase
// It asks storage the same question a browser asks before uploading (a CORS "preflight"),
// then uploads and deletes a tiny test file through a signed address. Nothing else is touched.
import { loadEnvFiles } from "./load-env";

loadEnvFiles();
process.env.BETTER_AUTH_SECRET ??= "storage-check-placeholder-not-used-for-signing";
// The site uses S3 storage in production; check that one when it's configured here.
if (process.env.S3_ENDPOINT) process.env.STORAGE_DRIVER ??= "s3";
const site = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";

const { storage, storageDriver } = await import("@/server/storage");
if (storageDriver() !== "s3") {
  console.log(
    "No S3 settings found. Add S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY to .env.netlify (the same values as on Netlify), then run this again.",
  );
  process.exit(1);
}
const key = `ws/00000000-0000-4000-8000-000000000000/${crypto.randomUUID()}`;
let url: string;
try {
  url = (await storage().signedUploadUrl(key, "application/octet-stream"))!;
} catch (error) {
  console.log(`${(error as Error).message}.`);
  console.log(
    "Add S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY to .env.netlify (the same values as on Netlify), then run this again.",
  );
  process.exit(1);
}
const origin = new URL(site).origin;

const preflight = await fetch(url, {
  method: "OPTIONS",
  headers: {
    Origin: origin,
    "Access-Control-Request-Method": "PUT",
    "Access-Control-Request-Headers": "content-type",
  },
});
const allowOrigin = preflight.headers.get("access-control-allow-origin");
const allowMethods = preflight.headers.get("access-control-allow-methods") ?? "";
const corsOk =
  preflight.ok && (allowOrigin === "*" || allowOrigin === origin) && /PUT|\*/i.test(allowMethods || "PUT");
console.log(
  `Browser permission (CORS) from ${origin}: ${corsOk ? "OK" : "NOT ALLOWED"} (status ${preflight.status}, allow-origin ${allowOrigin ?? "none"})`,
);

const put = await fetch(url, {
  method: "PUT",
  headers: { "content-type": "application/octet-stream", Origin: origin },
  body: "eightcore storage check",
});
console.log(`Signed upload: ${put.ok ? "OK" : `FAILED (${put.status} ${(await put.text()).slice(0, 200)})`}`);
if (put.ok) {
  const stat = await storage().stat(key);
  console.log(`Stored and readable: ${stat?.size === 23 ? "OK" : "NO"}`);
  await storage().delete(key);
}
console.log(
  corsOk && put.ok
    ? "\nAll good: files up to 25 MB can be uploaded straight to storage."
    : "\nSend this output to Claude.",
);
