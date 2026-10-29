"use client";
import { ErrorScreen } from "@/components/app/error-screen";

/** A failing workspace page keeps the sidebar; only the page area shows the error. */
export default function WorkspaceError({ error }: { error: Error & { digest?: string } }) {
  return <ErrorScreen error={error} />;
}
