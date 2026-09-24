import { useState } from "react";
import { CheckCircle2, RefreshCw, Send, XCircle } from "lucide-react";
import { Dialog } from "../../../components/ui";
import {
  PlanClientError,
  usePlanCommand,
  type ExecutionPlanView,
  type PlanCommand,
} from "../../../features/executionPlans";
import { useI18n, type MessageKey } from "../../../i18n";
import { label } from "./planLabels";

type Action = "replan" | "submit" | "approve" | "reject";

const TITLE: Record<Action, MessageKey> = {
  replan: "plans.replan",
  submit: "plans.submit",
  approve: "plans.approve",
  reject: "plans.reject",
};

export interface ActionNotice {
  tone: "ok" | "error";
  text: string;
}

/**
 * Governance actions on the CURRENT revision only. Each command names the
 * exact version the operator reviewed (`expectedVersion`) or the approval of
 * that exact version, so a superseded revision can never be acted on by
 * accident. Buttons are shown per capability (UX); the backend decides.
 * There is deliberately no execute / deploy action.
 */
export function PlanActions({
  plan,
  projectName,
  capabilities,
  onNotice,
}: {
  plan: ExecutionPlanView;
  projectName: string;
  capabilities: readonly string[];
  onNotice: (notice: ActionNotice) => void;
}) {
  const { t } = useI18n();
  const mutation = usePlanCommand(plan.projectId);
  const [pending, setPending] = useState<Action | null>(null);
  const [reason, setReason] = useState("");

  if (!plan.current || plan.status === "superseded") return null;

  const can = (capability: string) => capabilities.includes(capability);
  const awaiting = plan.status === "awaiting_approval" && plan.approval.state === "requested" && plan.approval.approvalId;
  const available: Action[] = [
    ...(can("replan_execution_plan") ? (["replan"] as const) : []),
    ...(can("submit_execution_plan") && plan.status === "ready" && plan.approvalRequirements.length > 0
      ? (["submit"] as const)
      : []),
    ...(can("approve") && awaiting ? (["approve"] as const) : []),
    ...(can("reject") && awaiting ? (["reject"] as const) : []),
  ];
  if (available.length === 0) return null;

  const stages =
    plan.approvalRequirements
      .map((a) => `${label.approvalReason(t, a.reason)} (${a.subjectIds.join(", ")})`)
      .join("; ") || t("plans.none");
  const body: Record<Action, string> = {
    replan: t("plans.replanBody", { version: plan.version }),
    submit: t("plans.submitBody", { version: plan.version, project: projectName, stages }),
    approve: t("plans.approveBody", { version: plan.version, project: projectName, stages }),
    reject: t("plans.rejectBody", { version: plan.version, project: projectName }),
  };

  const command = (action: Action): PlanCommand =>
    action === "replan"
      ? { kind: "replan", planId: plan.planId, expectedVersion: plan.version }
      : action === "submit"
        ? { kind: "submit", planId: plan.planId, expectedVersion: plan.version }
        : action === "approve"
          ? { kind: "approve", approvalId: plan.approval.approvalId ?? "" }
          : { kind: "reject", approvalId: plan.approval.approvalId ?? "", reason: reason.trim() };

  const run = (action: Action) => {
    mutation.mutate(command(action), {
      onSuccess: () => {
        setPending(null);
        setReason("");
        onNotice({ tone: "ok", text: t("plans.actionDone") });
      },
      onError: (error) => {
        const code = error instanceof PlanClientError ? error.code : "NETWORK";
        setPending(null);
        onNotice({
          tone: "error",
          text: t(
            code === "CONFLICT"
              ? "plans.actionConflict"
              : code === "FORBIDDEN" || code === "UNAUTHENTICATED"
                ? "plans.actionForbidden"
                : code === "INVALID" || code === "NOT_FOUND"
                  ? "plans.actionInvalid"
                  : "plans.actionFailed",
          ),
        });
      },
    });
  };

  const ICON = { replan: RefreshCw, submit: Send, approve: CheckCircle2, reject: XCircle } as const;

  return (
    <div className="plan-actions" role="group" aria-label={t("plans.actions")}>
      {available.map((action) => {
        const Icon = ICON[action];
        return (
          <button
            key={action}
            type="button"
            className={`ui-button${action === "approve" ? " primary" : ""}${action === "reject" ? " danger" : ""}`}
            onClick={() => setPending(action)}
            disabled={mutation.isPending}
          >
            <Icon size={16} aria-hidden /> {t(TITLE[action])}
          </button>
        );
      })}

      {pending ? (
        <Dialog open onClose={() => setPending(null)} title={t(TITLE[pending])} description={t("plans.version", { version: plan.version })}>
          <form
            className="plan-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (pending === "reject" && !reason.trim()) return;
              run(pending);
            }}
          >
            <p>{body[pending]}</p>
            {pending === "reject" ? (
              <label className="plan-field">
                <span>{t("plans.rejectReason")}</span>
                <textarea required maxLength={500} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
              </label>
            ) : null}
            <div className="plan-form__actions">
              <button type="button" className="ui-button" onClick={() => setPending(null)}>
                {t("plans.cancel")}
              </button>
              <button
                type="submit"
                className={`ui-button ${pending === "reject" ? "danger" : "primary"}`}
                disabled={mutation.isPending || (pending === "reject" && !reason.trim())}
                aria-busy={mutation.isPending}
              >
                {mutation.isPending ? t("plans.working") : t("plans.confirm")}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}
