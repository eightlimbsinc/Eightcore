// Development seed: a demo workspace with one user per role and two projects.
// Run with: npm run db:seed   (refuses to run in production; safe to re-run)
import { loadEnvFiles } from "../load-env";

loadEnvFiles();
if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production");

const { eq } = await import("drizzle-orm");
const { getAuth } = await import("@/server/auth/config");
const { db, closeDb } = await import("@/server/db");
const { authAccounts, users, workspaceMembers, workspaces } = await import("@/server/db/schema");
const { createWorkspace } = await import("@/modules/workspaces/service");
const { createProject, setProjectMember } = await import("@/modules/projects/service");

export const DEMO_PASSWORD = "eightcore demo password";
const DEMO = [
  { role: "owner", name: "Olivia Owner", email: "owner@demo.eightcore.local" },
  { role: "admin", name: "Adrian Admin", email: "admin@demo.eightcore.local" },
  { role: "member", name: "Maya Member", email: "member@demo.eightcore.local" },
  { role: "guest", name: "Gus Guest", email: "guest@demo.eightcore.local" },
] as const;

async function ensureUser(name: string, email: string): Promise<string> {
  const [existing] = await db().select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) return existing.id;
  const ctx = await getAuth().$context;
  const passwordHash = await ctx.password.hash(DEMO_PASSWORD);
  return db().transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({ name, email, emailVerified: true })
      .returning({ id: users.id });
    await tx.insert(authAccounts).values({
      userId: user!.id,
      accountId: user!.id,
      providerId: "credential",
      password: passwordHash,
    });
    return user!.id;
  });
}

const ids = Object.fromEntries(
  await Promise.all(DEMO.map(async (u) => [u.role, await ensureUser(u.name, u.email)] as const)),
) as Record<(typeof DEMO)[number]["role"], string>;

const [existingWorkspace] = await db()
  .select({ id: workspaces.id })
  .from(workspaces)
  .where(eq(workspaces.slug, "demo"));
if (existingWorkspace) {
  console.log("Demo workspace already exists; nothing to do.");
} else {
  const workspace = await createWorkspace(ids.owner, { name: "8limbs Demo", slug: "demo" });
  for (const role of ["admin", "member", "guest"] as const) {
    await db().insert(workspaceMembers).values({ workspaceId: workspace.id, userId: ids[role], role });
  }
  const owner = {
    userId: ids.owner,
    workspaceId: workspace.id,
    workspaceSlug: workspace.slug,
    workspaceRole: "owner",
    actorKind: "user",
  } as const;
  const site = await createProject(owner, {
    name: "Acme website relaunch",
    key: "ACME",
    description: "Marketing site rebuild for Acme Co.: design, build, QA and launch.",
  });
  await createProject(owner, {
    name: "Internal ops",
    key: "OPS",
    description: "Agency operations, hiring and tooling. Private to leadership.",
    visibility: "private",
  });
  await setProjectMember(owner, site.id, { userId: ids.guest, role: "commenter" });
  console.log("Seeded workspace /w/demo.");
}

console.log(`\nDemo accounts (password: "${DEMO_PASSWORD}"):`);
for (const u of DEMO) console.log(`  ${u.role.padEnd(6)} ${u.email}`);
await closeDb();
