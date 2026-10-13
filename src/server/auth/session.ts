import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getAuth } from "./config";

/** The current session (or null), memoized per request. */
export const getSession = cache(async () => getAuth().api.getSession({ headers: await headers() }));

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getSession>>>["user"];

/** The signed-in user, or a redirect to sign-in. */
export async function requireUser(): Promise<SessionUser> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session.user;
}
