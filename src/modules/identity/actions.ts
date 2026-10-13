"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAuth } from "@/server/auth/config";
import { requireUser } from "@/server/auth/session";
import { recordAudit } from "@/modules/activity/service";
import { db } from "@/server/db";

/** Revokes every session for the current user, this one included. */
export async function signOutEverywhereAction(): Promise<void> {
  const user = await requireUser();
  await getAuth().api.revokeSessions({ headers: await headers() });
  await recordAudit(db(), { event: "auth.sessions_revoked", actorId: user.id });
  redirect("/sign-in?signedOut=everywhere");
}
