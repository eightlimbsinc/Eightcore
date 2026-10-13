import type { Metadata } from "next";
import { getMembersPage } from "@/modules/workspaces/queries";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { InviteForm, MembersTable, PendingInvitations } from "@/components/app/members-manager";

export const metadata: Metadata = { title: "Members" };

export default async function MembersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, members, invitations, can } = await getMembersPage(slug);
  return (
    <>
      <PageHeader title="Members" description="People in this workspace and what they can do." />
      <div className="grid gap-6 px-8 py-6">
        {can.invite ? (
          <Card>
            <CardHeader>
              <CardTitle>Invite people</CardTitle>
              <CardDescription>
                Invitations are tied to the email address and expire after 7 days. Guests only see projects
                you share with them.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <InviteForm workspaceSlug={slug} canInviteAdmin={can.inviteAdmin} />
              <div className="grid gap-2">
                <h3 className="text-[13px] font-medium">Pending invitations</h3>
                <PendingInvitations workspaceSlug={slug} invitations={invitations} />
              </div>
            </CardContent>
          </Card>
        ) : null}
        <MembersTable workspaceSlug={slug} members={members} can={can} currentUserId={user.id} />
      </div>
    </>
  );
}
