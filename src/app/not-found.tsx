import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6">
      <Logo className="mb-10" />
      <p className="text-accent-foreground font-mono text-[12px]">404</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Nothing here</h1>
      <p className="text-muted-foreground mt-2 mb-6">
        This page doesn’t exist, or you don’t have access to it.
      </p>
      <div>
        <Button asChild variant="outline">
          <Link href="/w">Go to your workspace</Link>
        </Button>
      </div>
    </main>
  );
}
