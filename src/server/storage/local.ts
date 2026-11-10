import "server-only";
import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertStorageKey, type StorageAdapter } from "./index";

/** Files in a local folder (outside public/, so Next.js never serves them directly). */
export class LocalFsStorage implements StorageAdapter {
  private readonly root: string;

  constructor(dir: string) {
    this.root = path.resolve(dir);
  }

  private pathFor(key: string): string {
    assertStorageKey(key);
    const full = path.resolve(this.root, key);
    if (!full.startsWith(this.root + path.sep)) throw new Error("Invalid storage key");
    return full;
  }

  async put(key: string, body: Uint8Array): Promise<void> {
    const file = this.pathFor(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body, { flag: "wx" });
  }

  async read(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.pathFor(key)));
  }

  async signedDownloadUrl(): Promise<null> {
    return null;
  }

  async signedUploadUrl(): Promise<null> {
    return null;
  }

  async stat(key: string): Promise<{ size: number; etag: null } | null> {
    try {
      return { size: (await stat(this.pathFor(key))).size, etag: null };
    } catch {
      return null;
    }
  }

  async readStart(key: string, length: number): Promise<Uint8Array> {
    const handle = await open(this.pathFor(key), "r");
    try {
      const buf = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buf, 0, length, 0);
      return new Uint8Array(buf.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}
