import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/app/theme-toggle";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <main className="flex flex-col px-6 py-6 sm:px-10">
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="Eightcore home">
            <Logo />
          </Link>
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-12">{children}</div>
      </main>
      <aside className="relative hidden overflow-hidden bg-[#17171a] text-[#eeeae3] lg:flex lg:flex-col lg:justify-end lg:p-14">
        <div
          aria-hidden
          className="absolute inset-0 [background-image:linear-gradient(#c9a96e_1px,transparent_1px),linear-gradient(90deg,#c9a96e_1px,transparent_1px)] [background-size:44px_44px] opacity-[0.07]"
        />
        <div className="relative max-w-md">
          <p className="mb-4 text-[11px] font-medium tracking-[0.2em] text-[#c9a96e] uppercase">Eightcore</p>
          <p className="text-3xl leading-tight font-semibold tracking-tight">
            The operating system for modern agency operations.
          </p>
          <p className="mt-4 text-[15px] text-[#a19c93]">
            Plan, build, test and ship client work in one place your team owns.
          </p>
        </div>
      </aside>
    </div>
  );
}
