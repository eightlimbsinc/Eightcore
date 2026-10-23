import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assertStorageKey } from "./index";
import { LocalFsStorage } from "./local";
import { S3Storage } from "./s3";

const KEY = "ws/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222";
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("storage keys", () => {
  it("accepts only app-generated keys", () => {
    expect(() => assertStorageKey(KEY)).not.toThrow();
    for (const bad of ["../etc/passwd", "ws/x/y", `${KEY}/..`, `/${KEY}`, "ws/../../a"]) {
      expect(() => assertStorageKey(bad)).toThrow();
    }
  });
});

describe("local storage", () => {
  it("writes, reads and deletes, and never overwrites", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "eightcore-storage-"));
    dirs.push(dir);
    const store = new LocalFsStorage(dir);
    await store.put(KEY, new TextEncoder().encode("hi"));
    expect(new TextDecoder().decode(await store.read(KEY))).toBe("hi");
    await expect(store.put(KEY, new TextEncoder().encode("again"))).rejects.toThrow();
    expect(await store.signedDownloadUrl()).toBeNull();
    await store.delete(KEY);
    await expect(store.read(KEY)).rejects.toThrow();
  });
});

describe("S3 storage", () => {
  it("signs short-lived, path-style download links that force the file name and type", async () => {
    const store = new S3Storage({
      endpoint: "https://example.supabase.co/storage/v1/s3/",
      region: "us-east-1",
      bucket: "eightcore-files",
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "secret",
    });
    const url = new URL(
      await store.signedDownloadUrl(KEY, { fileName: "Q3 report.pdf", contentType: "application/pdf", inline: false }),
    );
    expect(url.origin + url.pathname).toBe(`https://example.supabase.co/storage/v1/s3/eightcore-files/${KEY}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get("response-content-disposition")).toBe(
      "attachment; filename*=UTF-8''Q3%20report.pdf",
    );
    expect(url.searchParams.get("response-content-type")).toBe("application/pdf");
    await expect(
      store.signedDownloadUrl("../other", { fileName: "x", contentType: "text/plain", inline: false }),
    ).rejects.toThrow();
  });
});
