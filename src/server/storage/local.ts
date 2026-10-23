import "server-only";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
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

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}
