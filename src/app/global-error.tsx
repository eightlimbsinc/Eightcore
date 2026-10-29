"use client";
import "./globals.css";
import { ErrorScreen } from "@/components/app/error-screen";

/** Last resort, when even the root layout fails. */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body>
        <ErrorScreen error={error} />
      </body>
    </html>
  );
}
