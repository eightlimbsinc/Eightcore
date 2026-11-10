import type { Metadata } from "next";
import { getPublicFormPage } from "@/modules/forms/queries";
import { PublicForm } from "@/components/forms/public-form";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const form = await getPublicFormPage((await params).token);
  return { title: form?.name ?? "Form", robots: { index: false, follow: false } };
}

/** A list's form, as clients see it: no sign-in, one ticket per response. */
export default async function PublicFormPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const form = await getPublicFormPage(token);
  return (
    <main className="bg-background min-h-screen px-4 py-10">
      <div className="mx-auto grid w-full max-w-2xl gap-6">
        {form ? (
          <PublicForm token={token} form={form} />
        ) : (
          <div className="bg-surface rounded-xl border p-8 text-center">
            <h1 className="text-xl font-semibold">This form isn&apos;t available</h1>
            <p className="text-muted-foreground mt-2 text-[14px]">
              The link may have changed, or the form isn&apos;t taking responses right now.
            </p>
          </div>
        )}
        <p className="text-muted-foreground text-center text-[12px]">Powered by Eightcore</p>
      </div>
    </main>
  );
}
