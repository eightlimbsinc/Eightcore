import { resolveDownload } from "@/modules/attachments/queries";

export const dynamic = "force-dynamic";

function contentDisposition(kind: "inline" | "attachment", fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Downloads go through here: the session and the task permission are checked on every
 * request. With S3 storage the browser is sent to a link that expires in 5 minutes;
 * locally the bytes are streamed.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; attachmentId: string }> },
) {
  const { slug, attachmentId } = await params;
  const result = await resolveDownload(slug, attachmentId, new URL(request.url).searchParams.has("download"));
  switch (result.kind) {
    case "not_found":
      return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
    case "redirect":
      return new Response(null, {
        status: 302,
        headers: {
          location: result.url,
          "cache-control": "private, no-store",
          "referrer-policy": "no-referrer",
        },
      });
    case "bytes":
      return new Response(result.bytes as BodyInit, {
        headers: {
          "content-type": result.mimeType,
          "content-length": String(result.bytes.byteLength),
          "content-disposition": contentDisposition(result.inline ? "inline" : "attachment", result.fileName),
          "cache-control": "private, no-store",
          "x-content-type-options": "nosniff",
          // Even if a file were rendered, it gets no scripts, no forms, and no access to the app's origin.
          "content-security-policy":
            "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
        },
      });
  }
}
