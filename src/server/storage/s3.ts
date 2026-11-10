import "server-only";
import { AwsClient } from "aws4fetch";
import { assertStorageKey, type StorageAdapter } from "./index";

interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

const DOWNLOAD_URL_TTL_SECONDS = 300;

/** Any S3-compatible service (Supabase Storage, SeaweedFS, Garage, R2...), path-style URLs. */
export class S3Storage implements StorageAdapter {
  private readonly client: AwsClient;

  constructor(private readonly config: S3Config) {
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      region: config.region,
      service: "s3",
    });
  }

  private url(key: string): string {
    assertStorageKey(key);
    return `${this.config.endpoint.replace(/\/+$/, "")}/${encodeURIComponent(this.config.bucket)}/${key}`;
  }

  async put(key: string, body: Uint8Array, contentType: string): Promise<void> {
    const res = await this.client.fetch(this.url(key), {
      method: "PUT",
      body: body as BodyInit,
      headers: { "content-type": contentType, "content-length": String(body.byteLength) },
    });
    if (!res.ok) throw new Error(`Storage upload failed (${res.status})`);
  }

  async read(): Promise<null> {
    return null;
  }

  async signedDownloadUrl(key: string, options: { fileName: string; contentType: string; inline: boolean }): Promise<string> {
    const url = new URL(this.url(key));
    url.searchParams.set("X-Amz-Expires", String(DOWNLOAD_URL_TTL_SECONDS));
    const disposition = `${options.inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(options.fileName)}`;
    url.searchParams.set("response-content-disposition", disposition);
    url.searchParams.set("response-content-type", options.contentType);
    const signed = await this.client.sign(url.toString(), { method: "GET", aws: { signQuery: true } });
    return signed.url;
  }

  async signedUploadUrl(key: string, contentType: string): Promise<string> {
    const url = new URL(this.url(key));
    url.searchParams.set("X-Amz-Expires", "900");
    const signed = await this.client.sign(url.toString(), {
      method: "PUT",
      headers: { "content-type": contentType },
      aws: { signQuery: true },
    });
    return signed.url;
  }

  async stat(key: string): Promise<{ size: number; etag: string | null } | null> {
    const res = await this.client.fetch(this.url(key), { method: "HEAD" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Storage check failed (${res.status})`);
    return { size: Number(res.headers.get("content-length") ?? 0), etag: res.headers.get("etag") };
  }

  async readStart(key: string, length: number): Promise<Uint8Array> {
    const res = await this.client.fetch(this.url(key), { headers: { range: `bytes=0-${length - 1}` } });
    if (!res.ok) throw new Error(`Storage read failed (${res.status})`);
    return new Uint8Array(await res.arrayBuffer()).subarray(0, length);
  }

  async delete(key: string): Promise<void> {
    const res = await this.client.fetch(this.url(key), { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`Storage delete failed (${res.status})`);
  }
}
