import { useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Lock,
  ShieldAlert,
  ShieldCheck,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Dialog, ErrorState, Skeleton } from "../../components/ui";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import { useAuth } from "../../auth/useAuth";
import {
  GovernanceError,
  useApproval,
  useApprovalDecision,
  type ApprovalItem,
  type ApprovalStatus,
  type RiskLevel,
} from "../../features/governance";
import { useProjects } from "../../features/executionPlans";
import { formatDateTime, useI18n, type MessageKey } from "../../i18n";
import "../Approvals/ApprovalsPage.css";

const STATUS: Record<
  ApprovalStatus,
  { label: MessageKey; icon: LucideIcon; tone: string }
> = {
  requested: {
    label: "approvalQueue.statusRequested",
    icon: Clock,
    tone: "warning",
  },
  approved: {
    label: "approvalQueue.statusApproved",
    icon: CheckCircle2,
    tone: "positive",
  },
  rejected: {
    label: "approvalQueue.statusRejected",
    icon: XCircle,
    tone: "negative",
  },
  expired: {
    label: "approvalQueue.statusExpired",
    icon: Clock,
    tone: "neutral",
  },
};

const RISK: Record<
  RiskLevel,
  { label: MessageKey; icon: LucideIcon; tone: string }
> = {
  low: { label: "approvalQueue.riskLow", icon: ShieldCheck, tone: "neutral" },
  medium: {
    label: "approvalQueue.riskMedium",
    icon: ShieldAlert,
    tone: "warning",
  },
  high: {
    label: "approvalQueue.riskHigh",
    icon: AlertTriangle,
    tone: "negative",
  },
};

function Pill({
  tone,
  icon: Icon,
  children,
}: {
  tone: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span className={`gov-pill gov-pill--${tone}`}>
      <Icon size={14} aria-hidden />
      <span>{children}</span>
    </span>
  );
}

function planLink(item: ApprovalItem): string | undefined {
  if (!item.executionPlanId || !item.projectId || !item.planVersion)
    return undefined;
  const planId = item.executionPlanId.split("@v")[0] ?? "";
  return `/projects/${encodeURIComponent(item.projectId)}/execution-plan?plan=${encodeURIComponent(planId)}&version=${item.planVersion}`;
}

/**
 * A single approval with its full governance context. Decisions use the same
 * approve/reject commands as the queue; a high-risk approval requires a written
 * note (explicit confirmation). Approving changes governance state only.
 */
export default function ApprovalDetailPage() {
  const { t, language } = useI18n();
  const { approvalId } = useParams<{ approvalId: string }>();
  const { accessDetails } = useAuth();
  const { projects } = useProjects();
  const { state, item, refetch } = useApproval(approvalId);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [notice, setNotice] = useState<{
    tone: "ok" | "error";
    text: string;
  } | null>(null);
  const can = (capability: string) =>
    accessDetails.capabilities.includes(capability);

  const projectName = item
    ? projects.find((p) => p.projectId === item.projectId)?.displayName
    : undefined;

  return (
    <PageContainer>
      <PageHeader
        eyebrow={t("common.brand")}
        title={t("approvalQueue.detailTitle")}
        description={t("approvalQueue.detailDescription")}
      />

      <p>
        <Link to="/approvals" className="gov-back">
          <ArrowLeft size={16} aria-hidden /> {t("approvalQueue.detailBack")}
        </Link>
      </p>

      {notice ? (
        <p
          className={`gov-notice gov-notice--${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.text}
        </p>
      ) : null}

      {state === "loading" ? (
        <div
          className="gov-list"
          role="status"
          aria-label={t("approvalQueue.detailLoading")}
        >
          <Skeleton height={180} width="100%" />
        </div>
      ) : state === "forbidden" || state === "unauthenticated" ? (
        <ErrorState
          icon={<Lock size={28} />}
          title={t(
            state === "forbidden"
              ? "approvalQueue.forbiddenTitle"
              : "approvalQueue.unauthenticatedTitle",
          )}
          description={t(
            state === "forbidden"
              ? "approvalQueue.forbiddenDescription"
              : "approvalQueue.unauthenticatedDescription",
          )}
        />
      ) : state === "not_found" || !item ? (
        <ErrorState
          title={t("approvalQueue.detailNotFoundTitle")}
          description={t("approvalQueue.detailNotFoundDescription")}
        />
      ) : state !== "ready" ? (
        <ErrorState
          title={t("approvalQueue.errorTitle")}
          description={t("approvalQueue.errorDescription")}
          onRetry={refetch}
          retryLabel={t("common.retry")}
        />
      ) : (
        <ApprovalDetail
          item={item}
          projectName={projectName}
          language={language}
          canApprove={can("approve")}
          canReject={can("reject")}
          onDecide={setDecision}
        />
      )}

      {item && decision ? (
        <DecisionDialog
          item={item}
          projectName={projectName}
          kind={decision}
          onClose={() => setDecision(null)}
          onDone={(text, tone) => {
            setNotice({ tone, text });
            setDecision(null);
            refetch();
          }}
        />
      ) : null}
    </PageContainer>
  );
}

function ApprovalDetail({
  item,
  projectName,
  language,
  canApprove,
  canReject,
  onDecide,
}: {
  item: ApprovalItem;
  projectName?: string;
  language: ReturnType<typeof useI18n>["language"];
  canApprove: boolean;
  canReject: boolean;
  onDecide: (kind: "approve" | "reject") => void;
}) {
  const { t } = useI18n();
  const status = STATUS[item.status] ?? STATUS.requested;
  const risk = RISK[item.risk] ?? RISK.medium;
  const plan = planLink(item);
  const pending = item.status === "requested";
  const row = (label: MessageKey, value: ReactNode) => (
    <>
      <dt>{t(label)}</dt>
      <dd>{value}</dd>
    </>
  );

  return (
    <section
      className={`gov-card gov-card--detail${pending ? " gov-card--pending" : ""}`}
      data-approval={item.approvalId}
    >
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

      <dl className="gov-detail-list">
        {row("approvalQueue.detailFieldId", <code>{item.approvalId}</code>)}
        {row(
          "approvalQueue.project",
          projectName ?? item.projectId ?? t("approvalQueue.none"),
        )}
        {row(
          "approvalQueue.requestedBy",
          `${item.requestedBy} · ${formatDateTime(item.requestedAt, language) ?? ""}`,
        )}
        {item.expiresAt
          ? row(
              "approvalQueue.detailFieldExpires",
              formatDateTime(item.expiresAt, language) ?? "",
            )
          : null}
        {item.decidedBy
          ? row(
              "approvalQueue.decidedBy",
              `${item.decidedBy} · ${formatDateTime(item.decidedAt, language) ?? ""}`,
            )
          : null}
        {item.toolId
          ? row("approvalQueue.tool", <code>{item.toolId}</code>)
          : null}
        {item.agentId
          ? row("approvalQueue.agent", <code>{item.agentId}</code>)
          : null}
      </dl>

      <div className="gov-links">
        {plan ? (
          <Link to={plan}>
            {t("approvalQueue.planLink", { version: item.planVersion ?? 0 })}
          </Link>
        ) : null}
        {item.taskId ? (
          <Link to={`/tasks/${encodeURIComponent(item.taskId)}`}>
            {t("approvalQueue.taskLink", { id: item.taskId })}
          </Link>
        ) : null}
        {item.workflowId ? (
          <Link to={`/workflows/${encodeURIComponent(item.workflowId)}`}>
            {t("approvalQueue.workflowLink", { id: item.workflowId })}
          </Link>
        ) : null}
      </div>

      {pending && (canApprove || canReject) ? (
        <div className="gov-actions">
          {canApprove ? (
            <button
              type="button"
              className="ui-button primary"
              onClick={() => onDecide("approve")}
            >
              <CheckCircle2 size={16} aria-hidden />{" "}
              {t("approvalQueue.approve")}
            </button>
          ) : null}
          {canReject ? (
            <button
              type="button"
              className="ui-button danger"
              onClick={() => onDecide("reject")}
            >
              <XCircle size={16} aria-hidden /> {t("approvalQueue.reject")}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function DecisionDialog({
  item,
  projectName,
  kind,
  onClose,
  onDone,
}: {
  item: ApprovalItem;
  projectName?: string;
  kind: "approve" | "reject";
  onClose: () => void;
  onDone: (text: string, tone: "ok" | "error") => void;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const mutation = useApprovalDecision();
  const [text, setText] = useState("");
  const rejecting = kind === "reject";
  // A high-risk approval requires a written note to make the decision explicit.
  const requiresNote = rejecting || item.risk === "high";

  const submit = () => {
    if (requiresNote && !text.trim()) return;
    mutation.mutate(
      rejecting
        ? {
            decision: "reject",
            approvalId: item.approvalId,
            reason: text.trim(),
          }
        : {
            decision: "approve",
            approvalId: item.approvalId,
            ...(text.trim() ? { note: text.trim() } : {}),
          },
      {
        onSuccess: () => onDone(t("approvalQueue.done"), "ok"),
        onError: (error) => {
          const failure =
            error instanceof GovernanceError ? error.failure : "unavailable";
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
          if (failure === "not_found") navigate("/approvals");
        },
      },
    );
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t(
        rejecting
          ? "approvalQueue.confirmRejectTitle"
          : "approvalQueue.confirmApproveTitle",
      )}
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
        {!rejecting && item.risk === "high" ? (
          <p className="gov-notice gov-notice--error">
            <AlertTriangle size={16} aria-hidden />{" "}
            {t("approvalQueue.highRiskWarning")}
          </p>
        ) : null}
        <label className="gov-field">
          <span>
            {t(rejecting ? "approvalQueue.rejectReason" : "approvalQueue.note")}
          </span>
          <textarea
            required={requiresNote}
            maxLength={500}
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
        <div className="gov-form__actions">
          <button type="button" className="ui-button" onClick={onClose}>
            {t("approvalQueue.cancel")}
          </button>
          <button
            type="submit"
            className={`ui-button ${rejecting ? "danger" : "primary"}`}
            disabled={mutation.isPending || (requiresNote && !text.trim())}
            aria-busy={mutation.isPending}
          >
            {mutation.isPending
              ? t("approvalQueue.working")
              : t("approvalQueue.confirm")}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
