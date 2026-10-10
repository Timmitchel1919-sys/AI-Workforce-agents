import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Clock, Lock, ShieldAlert, ShieldCheck, XCircle, type LucideIcon } from "lucide-react";
import { Dialog, EmptyState, ErrorState, Skeleton } from "../../components/ui";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { useAuth } from "../../auth/useAuth";
import {
  GovernanceError,
  useApprovalDecision,
  useApprovalQueue,
  type ApprovalItem,
  type ApprovalStatus,
  type RiskLevel,
} from "../../features/governance";
import { useProjects } from "../../features/executionPlans";
import { formatDateTime, useI18n, type MessageKey } from "../../i18n";
import "./ApprovalsPage.css";

const STATUSES: readonly ApprovalStatus[] = ["requested", "approved", "rejected", "expired"];

const STATUS: Record<ApprovalStatus, { label: MessageKey; icon: LucideIcon; tone: string }> = {
  requested: { label: "approvalQueue.statusRequested", icon: Clock, tone: "warning" },
  approved: { label: "approvalQueue.statusApproved", icon: CheckCircle2, tone: "positive" },
  rejected: { label: "approvalQueue.statusRejected", icon: XCircle, tone: "negative" },
  expired: { label: "approvalQueue.statusExpired", icon: Clock, tone: "neutral" },
};

const RISK: Record<RiskLevel, { label: MessageKey; icon: LucideIcon; tone: string }> = {
  low: { label: "approvalQueue.riskLow", icon: ShieldCheck, tone: "neutral" },
  medium: { label: "approvalQueue.riskMedium", icon: ShieldAlert, tone: "warning" },
  high: { label: "approvalQueue.riskHigh", icon: AlertTriangle, tone: "negative" },
};

function Pill({ tone, icon: Icon, children }: { tone: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <span className={`gov-pill gov-pill--${tone}`}>
      <Icon size={14} aria-hidden />
      <span>{children}</span>
    </span>
  );
}

type Decision = { kind: "approve" | "reject"; item: ApprovalItem };

/**
 * The approval queue. Decisions use the existing approve/reject commands; the
 * Control Plane authorizes (role + project), records and audits them. A plan
 * approval decides exactly the plan revision it names — never a newer one.
 */
export default function ApprovalsPage() {
  const { t } = useI18n();
  const { accessDetails } = useAuth();
  const [status, setStatus] = useState<ApprovalStatus | "">("requested");
  const [projectId, setProjectId] = useState("");
  const { projects } = useProjects();
  const queue = useApprovalQueue({ ...(status ? { status } : {}), ...(projectId ? { projectId } : {}) });
  const [decision, setDecision] = useState<Decision | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const can = (capability: string) => accessDetails.capabilities.includes(capability);

  return (
    <PageContainer>
      <PageHeader eyebrow={t("common.brand")} title={t("approvalQueue.title")} description={t("approvalQueue.description")} />

      <form className="gov-filters" aria-label={t("approvalQueue.filtersLabel")} onSubmit={(e) => e.preventDefault()}>
        <label className="gov-field">
          <span>{t("approvalQueue.filterStatus")}</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as ApprovalStatus | "")}>
            <option value="">{t("approvalQueue.allStatuses")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(STATUS[s].label)}
              </option>
            ))}
          </select>
        </label>
        <label className="gov-field">
          <span>{t("approvalQueue.filterProject")}</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">{t("approvalQueue.allProjects")}</option>
            {projects.map((p) => (
              <option key={p.projectId} value={p.projectId}>
                {p.displayName}
              </option>
            ))}
          </select>
        </label>
      </form>

      {notice ? (
        <p className={`gov-notice gov-notice--${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
          {notice.text}
        </p>
      ) : null}

      {queue.state === "loading" ? (
        <div className="gov-list" role="status" aria-label={t("approvalQueue.loading")}>
          <Skeleton height={96} width="100%" />
          <Skeleton height={96} width="100%" />
        </div>
      ) : queue.state === "forbidden" || queue.state === "unauthenticated" ? (
        <ErrorState
          icon={<Lock size={28} />}
          title={t(queue.state === "forbidden" ? "approvalQueue.forbiddenTitle" : "approvalQueue.unauthenticatedTitle")}
          description={t(queue.state === "forbidden" ? "approvalQueue.forbiddenDescription" : "approvalQueue.unauthenticatedDescription")}
        />
      ) : queue.state === "empty" ? (
        <EmptyState
          title={t("approvalQueue.emptyTitle")}
          description={t(status === "requested" && !projectId ? "approvalQueue.emptyPending" : "approvalQueue.emptyFiltered")}
        />
      ) : queue.state !== "ready" ? (
        <ErrorState
          title={t("approvalQueue.errorTitle")}
          description={t("approvalQueue.errorDescription")}
          onRetry={queue.refetch}
          retryLabel={t("common.retry")}
        />
      ) : (
        <>
          <p className="gov-muted">{t("approvalQueue.showing", { shown: queue.items.length, total: queue.total })}</p>
          <ul className="gov-list">
            {queue.items.map((item) => (
              <ApprovalCard
                key={item.approvalId}
                item={item}
                projectName={projects.find((p) => p.projectId === item.projectId)?.displayName}
                canApprove={can("approve")}
                canReject={can("reject")}
                onDecide={(kind) => setDecision({ kind, item })}
              />
            ))}
          </ul>
          {queue.hasMore ? (
            <button type="button" className="ui-button" onClick={queue.loadMore} disabled={queue.loadingMore}>
              {t("approvalQueue.loadMore")}
            </button>
          ) : null}
        </>
      )}

      {decision ? (
        <DecisionDialog
          decision={decision}
          projectName={projects.find((p) => p.projectId === decision.item.projectId)?.displayName}
          onClose={() => setDecision(null)}
          onDone={(text, tone) => {
            setNotice({ tone, text });
            setDecision(null);
          }}
        />
      ) : null}
    </PageContainer>
  );
}

function planLink(item: ApprovalItem): string | undefined {
  if (!item.executionPlanId || !item.projectId || !item.planVersion) return undefined;
  const planId = item.executionPlanId.split("@v")[0] ?? "";
  return `/projects/${encodeURIComponent(item.projectId)}/execution-plan?plan=${encodeURIComponent(planId)}&version=${item.planVersion}`;
}

function ApprovalCard({
  item,
  projectName,
  canApprove,
  canReject,
  onDecide,
}: {
  item: ApprovalItem;
  projectName?: string;
  canApprove: boolean;
  canReject: boolean;
  onDecide: (kind: "approve" | "reject") => void;
}) {
  const { t, language } = useI18n();
  const status = STATUS[item.status] ?? STATUS.requested;
  const risk = RISK[item.risk] ?? RISK.medium;
  const plan = planLink(item);
  const pending = item.status === "requested";

  return (
    <li className={`gov-card${pending ? " gov-card--pending" : ""}`} data-approval={item.approvalId}>
      <div className="gov-card__head">
        <code className="gov-action">{item.action}</code>
        <Pill tone={status.tone} icon={status.icon}>
          {t(status.label)}
        </Pill>
        <Pill tone={risk.tone} icon={risk.icon}>
          {t(risk.label)}
        </Pill>
      </div>
      <p className="gov-reason">{item.reason}</p>
      <ul className="gov-meta">
        <li>{t("approvalQueue.project", { project: projectName ?? item.projectId ?? t("approvalQueue.none") })}</li>
        <li>
          {t("approvalQueue.requestedBy", {
            actor: item.requestedBy,
            date: formatDateTime(item.requestedAt, language) ?? "",
          })}
        </li>
        {item.expiresAt && pending ? (
          <li>{t("approvalQueue.expiresAt", { date: formatDateTime(item.expiresAt, language) ?? "" })}</li>
        ) : null}
        {item.decidedBy ? (
          <li>
            {t("approvalQueue.decidedBy", {
              actor: item.decidedBy,
              date: formatDateTime(item.decidedAt, language) ?? "",
            })}
          </li>
        ) : null}
        {item.toolId ? <li>{t("approvalQueue.tool", { id: item.toolId })}</li> : null}
        {item.agentId ? <li>{t("approvalQueue.agent", { id: item.agentId })}</li> : null}
      </ul>
      <div className="gov-links">
        {plan ? <Link to={plan}>{t("approvalQueue.planLink", { version: item.planVersion ?? 0 })}</Link> : null}
        {item.taskId ? <Link to={`/tasks/${encodeURIComponent(item.taskId)}`}>{t("approvalQueue.taskLink", { id: item.taskId })}</Link> : null}
        {item.workflowId ? (
          <Link to={`/workflows/${encodeURIComponent(item.workflowId)}`}>{t("approvalQueue.workflowLink", { id: item.workflowId })}</Link>
        ) : null}
      </div>
      {pending && (canApprove || canReject) ? (
        <div className="gov-actions">
          {canApprove ? (
            <button type="button" className="ui-button primary" onClick={() => onDecide("approve")}>
              <CheckCircle2 size={16} aria-hidden /> {t("approvalQueue.approve")}
            </button>
          ) : null}
          {canReject ? (
            <button type="button" className="ui-button danger" onClick={() => onDecide("reject")}>
              <XCircle size={16} aria-hidden /> {t("approvalQueue.reject")}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function DecisionDialog({
  decision,
  projectName,
  onClose,
  onDone,
}: {
  decision: Decision;
  projectName?: string;
  onClose: () => void;
  onDone: (text: string, tone: "ok" | "error") => void;
}) {
  const { t } = useI18n();
  const mutation = useApprovalDecision();
  const [text, setText] = useState("");
  const { item, kind } = decision;
  const rejecting = kind === "reject";

  const submit = () => {
    if (rejecting && !text.trim()) return;
    mutation.mutate(
      rejecting
        ? { decision: "reject", approvalId: item.approvalId, reason: text.trim() }
        : { decision: "approve", approvalId: item.approvalId, ...(text.trim() ? { note: text.trim() } : {}) },
      {
        onSuccess: () => onDone(t("approvalQueue.done"), "ok"),
        onError: (error) => {
          const failure = error instanceof GovernanceError ? error.failure : "unavailable";
          onDone(
            t(
              failure === "conflict"
                ? "approvalQueue.conflict"
                : failure === "forbidden" || failure === "unauthenticated"
                  ? "approvalQueue.forbidden"
                  : failure === "invalid" || failure === "not_found"
                    ? "approvalQueue.invalid"
                    : "approvalQueue.failed",
            ),
            "error",
          );
        },
      },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(rejecting ? "approvalQueue.confirmRejectTitle" : "approvalQueue.confirmApproveTitle")}
      description={t("approvalQueue.confirmBody", {
        action: item.action,
        project: projectName ?? item.projectId ?? t("approvalQueue.none"),
      })}
    >
      <form
        className="gov-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <p className="gov-reason">{item.reason}</p>
        {item.executionPlanId && item.planVersion ? (
          <p className="gov-notice">{t("approvalQueue.planConfirm", { version: item.planVersion })}</p>
        ) : null}
        {!rejecting && item.risk === "high" ? (
          <p className="gov-notice gov-notice--error">
            <AlertTriangle size={16} aria-hidden /> {t("approvalQueue.highRiskWarning")}
          </p>
        ) : null}
        <label className="gov-field">
          <span>{t(rejecting ? "approvalQueue.rejectReason" : "approvalQueue.note")}</span>
          <textarea required={rejecting} maxLength={500} rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        <div className="gov-form__actions">
          <button type="button" className="ui-button" onClick={onClose}>
            {t("approvalQueue.cancel")}
          </button>
          <button
            type="submit"
            className={`ui-button ${rejecting ? "danger" : "primary"}`}
            disabled={mutation.isPending || (rejecting && !text.trim())}
            aria-busy={mutation.isPending}
          >
            {mutation.isPending ? t("approvalQueue.working") : t("approvalQueue.confirm")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
