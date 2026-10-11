import { useState } from "react";
import { Button, Textarea } from "../../../components/ui";
import type { ProjectOption } from "../../projectScope/projectScope";
import { useApprovals, useCanApprove, useTrustCommand } from "../hooks/useTrust";
import { useT } from "../lib/useT";
import type { Approval } from "../types";
import { DefList, Empty, ErrorPanel, RiskTag, Skeleton, Tag, TextList, Unavailable } from "./common";

const PENDING = ["PENDING"] as const;
const HISTORY = ["APPROVED", "DENIED", "EXPIRED", "CANCELLED"] as const;

function Text({ value }: { value: string | undefined }) {
  return value ? <span className="sc-text">{value}</span> : <Unavailable />;
}

/** Every field the server sent is shown in full; nothing is hidden or truncated. */
function ApprovalCard({ approval, projects }: { approval: Approval; projects: readonly ProjectOption[] }) {
  const { tt, label, formatTime } = useT();
  const canApprove = useCanApprove();
  const mutation = useTrustCommand();
  const [note, setNote] = useState("");
  const pending = approval.state === "PENDING";
  const project = projects.find((p) => p.projectId === approval.projectId);
  const trimmed = note.trim();
  const send = (command: "security_decide_approval" | "security_cancel_approval", extra: Record<string, unknown>) =>
    mutation.mutate({ command, body: { approvalId: approval.approvalId, ...extra } });
  const decide = (decision: "approve" | "deny") =>
    send("security_decide_approval", { decision, ...(trimmed ? { note: trimmed } : {}) });

  return (
    <li className="sc-row sc-approval" data-approval-id={approval.approvalId} data-state={approval.state} data-risk={approval.risk}>
      <div className="sc-row__head">
        <strong className="sc-row__title">{approval.action} · {approval.resource}</strong>
        <span className="sc-inline"><RiskTag value={approval.risk} /><Tag tone={pending ? "warning" : "neutral"}>{label("approvalState", approval.state)}</Tag></span>
      </div>
      <DefList
        items={[
          { label: tt("approvals.action"), value: approval.action },
          { label: tt("approvals.resource"), value: <span className="sc-text">{approval.resource}</span> },
          { label: tt("approvals.project"), value: project?.displayName ? `${project.displayName} (${approval.projectId})` : approval.projectId },
          { label: tt("approvals.agent"), value: approval.agentId ?? <Unavailable /> },
          { label: tt("approvals.model"), value: approval.modelId ?? <Unavailable /> },
          { label: tt("approvals.risk"), value: label("risk", approval.risk) },
          { label: tt("approvals.environment"), value: approval.environment ? label("environment", approval.environment) : <Unavailable /> },
          { label: tt("approvals.reason"), value: <Text value={approval.reason} /> },
          { label: tt("approvals.expectedImpact"), value: <Text value={approval.expectedImpact} /> },
          { label: tt("approvals.reversibility"), value: <Text value={approval.reversibility} /> },
          { label: tt("approvals.changes"), value: <Text value={approval.changes} /> },
          { label: tt("approvals.proposedCommand"), value: approval.proposedCommand ? <code className="sc-inline-code">{approval.proposedCommand}</code> : <Unavailable /> },
          { label: tt("approvals.policies"), value: <TextList items={approval.policies} /> },
          { label: tt("approvals.requestedBy"), value: approval.requestedBy },
          { label: tt("approvals.requestedAt"), value: formatTime(approval.requestedAt) },
          { label: tt("approvals.expires"), value: approval.expiresAt ? formatTime(approval.expiresAt) : <Unavailable /> },
          ...(approval.executionId ? [{ label: tt("approvals.execution"), value: approval.executionId }] : []),
          ...(approval.taskId ? [{ label: tt("approvals.task"), value: approval.taskId }] : []),
          ...(approval.decision ? [{ label: tt("approvals.decision"), value: approval.decision }] : []),
          ...(approval.decidedBy ? [{ label: tt("approvals.decidedBy"), value: approval.decidedBy }] : []),
          ...(approval.decidedAt ? [{ label: tt("approvals.decidedAt"), value: formatTime(approval.decidedAt) }] : []),
        ]}
      />
      {pending && canApprove ? (
        <div className="sc-stack">
          <Textarea label={tt("approvals.note")} description={approval.risk === "CRITICAL" ? tt("approvals.criticalHint") : tt("approvals.noteHint")} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          {mutation.isError ? <ErrorPanel error={mutation.error} /> : null}
          <div className="sc-actions">
            <Button type="button" variant="primary" loading={mutation.isPending} onClick={() => decide("approve")}>{tt("approvals.approve")}</Button>
            <Button type="button" variant="danger" loading={mutation.isPending} onClick={() => decide("deny")}>{tt("approvals.deny")}</Button>
            <Button type="button" variant="secondary" loading={mutation.isPending} onClick={() => send("security_cancel_approval", {})}>{tt("approvals.cancel")}</Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

function ApprovalList({ states, projectId, projects }: { states: readonly string[]; projectId: string | undefined; projects: readonly ProjectOption[] }) {
  const { tt } = useT();
  const query = useApprovals(states, projectId);
  if (query.isLoading) return <Skeleton label={tt("common.loading")} />;
  if (query.isError || !query.data) return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />;
  if (query.data.length === 0) return <Empty title={tt("approvals.empty")} />;
  return <ul className="sc-rows">{query.data.map((a) => <ApprovalCard key={a.approvalId} approval={a} projects={projects} />)}</ul>;
}

export function ApprovalsTab({ projectId, projects }: { projectId: string | undefined; projects: readonly ProjectOption[] }) {
  const { tt } = useT();
  const canApprove = useCanApprove();
  const [view, setView] = useState<"pending" | "history">("pending");
  return (
    <section className="sc-panel" aria-labelledby="sc-approvals-title">
      <h2 id="sc-approvals-title" className="sc-panel__title">{tt("approvals.title")}</h2>
      {!canApprove ? <p className="sc-muted">{tt("approvals.readOnly")}</p> : null}
      <div className="sc-actions" role="group" aria-label={tt("approvals.views")}>
        <Button type="button" variant={view === "pending" ? "primary" : "secondary"} aria-pressed={view === "pending"} onClick={() => setView("pending")}>{tt("approvals.pending")}</Button>
        <Button type="button" variant={view === "history" ? "primary" : "secondary"} aria-pressed={view === "history"} onClick={() => setView("history")}>{tt("approvals.history")}</Button>
      </div>
      {view === "pending" ? <ApprovalList states={PENDING} projectId={projectId} projects={projects} /> : <ApprovalList states={HISTORY} projectId={projectId} projects={projects} />}
    </section>
  );
}
