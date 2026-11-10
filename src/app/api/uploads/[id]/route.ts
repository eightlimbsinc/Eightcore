import { receiveLocalUpload } from "@/modules/attachments/direct";

export const dynamic = "force-dynamic";

/**
 * Receives a direct upload when storage can't sign its own upload address (local storage, used in
 * development and tests). With S3 storage (production) the browser uploads to storage instead.
 */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sig = new URL(request.url).searchParams.get("sig") ?? "";
  const status = await receiveLocalUpload(id, sig, () => request.arrayBuffer());
  return new Response(status === 413 ? "Files can be at most 25 MB" : null, { status });
}
