"use client";
import { useActionState, useState } from "react";
import { CheckCircle2, CircleDashed, FlaskConical, XCircle } from "lucide-react";
import { addQaEvidenceAction, concludeQaAction, startQaAction } from "@/modules/qa/actions";
import { AttachmentList, type AttachmentItem } from "@/components/tasks/task-side-panels";
import { cn } from "@/lib/utils";

export interface QaRoundView {
  id: string;
  cycleNumber: number;
  result: "pending" | "pass" | "fail";
  environmentUrl: string;
  buildRef: string;
  summary: string;
  startedAt: string;
  concludedAt: string | null;
  startedByName: string;
  concludedByName: string | null;
  evidence: AttachmentItem[];
}

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" });
const input = "border-input bg-surface h-8 rounded-md border px-2 text-[13px]";
const button =
  "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] font-medium disabled:opacity-60 [&_svg]:size-4";

function ResultBadge({ result }: { result: QaRoundView["result"] }) {
  const meta = {
    pending: { label: "In QA", icon: CircleDashed, tone: "text-accent-foreground bg-accent-soft" },
    pass: { label: "Passed", icon: CheckCircle2, tone: "text-success bg-success/10" },
    fail: { label: "Failed", icon: XCircle, tone: "text-destructive bg-destructive-soft" },
  }[result];
  const Icon = meta.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-semibold",
        meta.tone,
      )}
    >
      <Icon className="size-3.5" aria-hidden /> {meta.label}
    </span>
  );
}

/**
 * The task's QA rounds: the open one (pass or fail it, with notes and evidence), a way to start
 * the next one, and the history of concluded rounds (locked).
 */
export function QaPanel({
  workspaceSlug,
  taskId,
  rounds,
  canConduct,
  maxMb,
}: {
  workspaceSlug: string;
  taskId: string;
  rounds: QaRoundView[];
  canConduct: boolean;
  maxMb: number;
}) {
  const open = rounds.find((r) => r.result === "pending");
  const history = rounds.filter((r) => r.result !== "pending");
  return (
    <div className="grid gap-3">
      {open ? (
        <OpenRound
          workspaceSlug={workspaceSlug}
          taskId={taskId}
          round={open}
          canConduct={canConduct}
          maxMb={maxMb}
        />
      ) : canConduct ? (
        <StartRound workspaceSlug={workspaceSlug} taskId={taskId} next={(rounds[0]?.cycleNumber ?? 0) + 1} />
      ) : rounds.length === 0 ? (
        <p className="text-muted-foreground text-[13px]">No QA rounds yet.</p>
      ) : null}
      {history.length ? (
        <ol className="grid gap-2" aria-label="QA history">
          {history.map((r) => (
            <li key={r.id} className="grid gap-1 rounded-md border px-3 py-2 text-[13px]">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">Round #{r.cycleNumber}</span>
                <ResultBadge result={r.result} />
                <span className="text-muted-foreground text-[12px]">
                  {r.concludedByName} · {r.concludedAt ? dateTime.format(new Date(r.concludedAt)) : ""}
                </span>
              </div>
              {r.environmentUrl || r.buildRef ? (
                <p className="text-muted-foreground text-[12px]">
                  {r.environmentUrl ? (
                    <a
                      href={r.environmentUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="underline"
                    >
                      {r.environmentUrl}
                    </a>
                  ) : null}
                  {r.environmentUrl && r.buildRef ? " · " : ""}
                  {r.buildRef ? `Build ${r.buildRef}` : ""}
                </p>
              ) : null}
              {r.summary ? <p className="whitespace-pre-wrap">{r.summary}</p> : null}
              <AttachmentList workspaceSlug={workspaceSlug} files={r.evidence} />
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function StartRound({
  workspaceSlug,
  taskId,
  next,
}: {
  workspaceSlug: string;
  taskId: string;
  next: number;
}) {
  const [state, action, pending] = useActionState(startQaAction.bind(null, workspaceSlug, taskId), undefined);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input
        name="environmentUrl"
        placeholder="Where to test (URL, optional)"
        aria-label="Test environment URL"
        className={cn(input, "min-w-56 flex-1")}
      />
      <input
        name="buildRef"
        placeholder="Build or version"
        aria-label="Build or version"
        className={cn(input, "w-36")}
      />
      <button type="submit" disabled={pending} className={cn(button, "bg-primary text-primary-foreground")}>
        <FlaskConical aria-hidden /> Start QA round #{next}
      </button>
      {state && !state.ok ? (
        <span role="alert" className="text-destructive text-[12px]">
          {state.message}
        </span>
      ) : null}
    </form>
  );
}

function OpenRound({
  workspaceSlug,
  taskId,
  round,
  canConduct,
  maxMb,
}: {
  workspaceSlug: string;
  taskId: string;
  round: QaRoundView;
  canConduct: boolean;
  maxMb: number;
}) {
  const [state, action, pending] = useActionState(
    concludeQaAction.bind(null, workspaceSlug, taskId, round.id),
    undefined,
  );
  const [evidenceState, addEvidence, adding] = useActionState(
    addQaEvidenceAction.bind(null, workspaceSlug, round.id),
    undefined,
  );
  const [summary, setSummary] = useState("");
  return (
    <section
      aria-label={`QA round ${round.cycleNumber}, in progress`}
      className="border-accent/50 bg-accent-soft/20 grid gap-2 rounded-lg border p-3 text-[13px]"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Round #{round.cycleNumber}</span>
        <ResultBadge result="pending" />
        <span className="text-muted-foreground text-[12px]">
          started by {round.startedByName} · {dateTime.format(new Date(round.startedAt))}
        </span>
      </div>
      {round.environmentUrl || round.buildRef ? (
        <p className="text-muted-foreground text-[12px]">
          {round.environmentUrl ? (
            <a href={round.environmentUrl} target="_blank" rel="noreferrer noopener" className="underline">
              {round.environmentUrl}
            </a>
          ) : null}
          {round.environmentUrl && round.buildRef ? " · " : ""}
          {round.buildRef ? `Build ${round.buildRef}` : ""}
        </p>
      ) : null}
      <AttachmentList workspaceSlug={workspaceSlug} files={round.evidence} />
      {canConduct ? (
        <>
          <form action={addEvidence} className="flex flex-wrap items-center gap-2">
            <input
              type="file"
              name="evidence"
              multiple
              aria-label={`Add evidence (up to ${maxMb} MB each)`}
              className="text-[12px] file:mr-2 file:rounded-md file:border file:bg-transparent file:px-2 file:py-1"
            />
            <button type="submit" disabled={adding} className={cn(button, "border")}>
              Add evidence
            </button>
            {evidenceState ? (
              <span
                role="status"
                className={cn("text-[12px]", evidenceState.ok ? "text-success" : "text-destructive")}
              >
                {evidenceState.message}
              </span>
            ) : null}
          </form>
          <form action={action} className="grid gap-2">
            <textarea
              name="summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={3}
              maxLength={10_000}
              aria-label="QA notes"
              placeholder="What did you test? For a fail, what's wrong and how to reproduce it."
              className="border-input bg-surface rounded-md border p-2 text-[13px]"
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="submit"
                name="result"
                value="pass"
                disabled={pending}
                className={cn(button, "bg-success text-white")}
              >
                <CheckCircle2 aria-hidden /> Pass
              </button>
              <button
                type="submit"
                name="result"
                value="fail"
                disabled={pending || !summary.trim()}
                title={summary.trim() ? undefined : "Add notes saying what failed"}
                className={cn(button, "bg-destructive text-white")}
              >
                <XCircle aria-hidden /> Fail
              </button>
              {state && !state.ok ? (
                <span role="alert" className="text-destructive text-[12px]">
                  {state.fieldErrors?.summary ?? state.message}
                </span>
              ) : (
                <span className="text-muted-foreground text-[12px]">
                  A concluded round can&apos;t be changed.
                </span>
              )}
            </div>
          </form>
        </>
      ) : null}
    </section>
  );
}
