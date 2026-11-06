import type { Metadata } from "next";
import { getIntegrationsPage } from "@/modules/webhooks/queries";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DeliveryLog, IncomingHooks, OutgoingWebhooks } from "@/components/integrations/integrations-manager";

export const metadata: Metadata = { title: "Integrations" };

const createExample = (listId: string) => `{
  "action": "create_task",
  "list_id": "${listId}",
  "title": "Website form: new enquiry",
  "description": "Optional text",
  "priority": "high",
  "due_date": "2026-12-01",
  "status": "To do",
  "assignees": ["sam@8limbsinc.net"]
}`;
const updateExample = `{
  "action": "update_task",
  "task": "WEB-12",
  "status": "In review",
  "priority": "urgent",
  "comment": "Client approved in Make"
}`;

export default async function IntegrationsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { endpoints, deliveries, inbound, projects, lists, events, hookBase } =
    await getIntegrationsPage(slug);
  return (
    <>
      <PageHeader
        title="Integrations"
        description="Connect Eightcore to Make (or any tool that speaks webhooks). Only workspace owners and admins see this page."
      />
      <div className="grid gap-6 px-8 py-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card className="content-start">
          <CardHeader>
            <CardTitle>Eightcore → Make</CardTitle>
            <CardDescription>
              In Make, start a scenario with Webhooks › Custom webhook, copy its address and add it here. We
              send JSON with the event, the task (reference, title, link, status, priority, due date,
              assignees) and what changed. Failed sends are retried for about 9 hours.
            </CardDescription>
          </CardHeader>
          <CardContent className="min-w-0">
            <OutgoingWebhooks
              workspaceSlug={slug}
              endpoints={endpoints}
              events={events}
              projects={projects}
            />
          </CardContent>
        </Card>
        <Card className="content-start">
          <CardHeader>
            <CardTitle>Make → Eightcore</CardTitle>
            <CardDescription>
              Create an address, then in Make use HTTP › Make a request: method POST, body type JSON, to that
              address. Requests act with the permissions of the person who created the address.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid min-w-0 gap-4">
            <IncomingHooks workspaceSlug={slug} hooks={inbound} hookBase={hookBase} />
            <details className="text-[13px]">
              <summary className="cursor-pointer font-medium">What to send</summary>
              <div className="mt-2 grid gap-2">
                <p>Create a task (only list_id and title are required):</p>
                <pre className="bg-surface-muted overflow-x-auto rounded-md p-3 font-mono text-[12px]">
                  {createExample(lists[0]?.id ?? "<list id>")}
                </pre>
                <p>Change a task by its reference (send only what changes; a comment can go alone):</p>
                <pre className="bg-surface-muted overflow-x-auto rounded-md p-3 font-mono text-[12px]">
                  {updateExample}
                </pre>
                <p className="text-muted-foreground">
                  Status is the status name in that list. Assignees are workspace members&apos; emails. The
                  answer is JSON with the task&apos;s ref and url, or an error explaining what&apos;s wrong.
                </p>
              </div>
            </details>
            <details className="text-[13px]">
              <summary className="cursor-pointer font-medium">List ids</summary>
              <table className="mt-2 w-full text-[12px]">
                <tbody>
                  {lists.map((l) => (
                    <tr key={l.id} className="border-t">
                      <td className="py-1 pr-2">{l.name}</td>
                      <td className="text-muted-foreground py-1 font-mono break-all select-all">{l.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </CardContent>
        </Card>
        <Card className="content-start xl:col-span-2">
          <CardHeader>
            <CardTitle>Recent sends</CardTitle>
            <CardDescription>The last 30 webhook deliveries.</CardDescription>
          </CardHeader>
          <CardContent className="min-w-0">
            <DeliveryLog workspaceSlug={slug} deliveries={deliveries} />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
