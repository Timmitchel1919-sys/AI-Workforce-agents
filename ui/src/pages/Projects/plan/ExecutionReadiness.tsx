import { useState } from "react";
import { CheckCircle2, Lock, OctagonAlert, ShieldCheck } from "lucide-react";
import { useAuth } from "../../../auth/useAuth";
import { PreflightError, runPreflight, type PreflightCode, type PreflightResult } from "../../../features/execution";
import type { ExecutionPlanView } from "../../../features/executionPlans";
import { useI18n, type MessageKey } from "../../../i18n";
import { Pill } from "./PlanOverview";

const REASON_LABEL: Record<PreflightCode, MessageKey> = {
  POLICY_DENIED: "execution.reason.POLICY_DENIED",
  AUTHORIZATION_DENIED: "execution.reason.AUTHORIZATION_DENIED",
  APPROVAL_REQUIRED: "execution.reason.APPROVAL_REQUIRED",
  STALE_PLAN: "execution.reason.STALE_PLAN",
  PLAN_NOT_EXECUTABLE: "execution.reason.PLAN_NOT_EXECUTABLE",
  AGENT_NOT_QUALIFIED: "execution.reason.AGENT_NOT_QUALIFIED",
  ENVIRONMENT_UNAVAILABLE: "execution.reason.ENVIRONMENT_UNAVAILABLE",
  WORKSPACE_VIOLATION: "execution.reason.WORKSPACE_VIOLATION",
  TOOL_NOT_ALLOWED: "execution.reason.TOOL_NOT_ALLOWED",
  INVALID_TOOL_INPUT: "execution.reason.INVALID_TOOL_INPUT",
  SANDBOX_UNAVAILABLE: "execution.reason.SANDBOX_UNAVAILABLE",
  RESOURCE_LIMIT: "execution.reason.RESOURCE_LIMIT",
  TIMEOUT: "execution.reason.TIMEOUT",
  CANCELLED: "execution.reason.CANCELLED",
  SANDBOX_FAILURE: "execution.reason.SANDBOX_FAILURE",
  INTERNAL_ERROR: "execution.reason.INTERNAL_ERROR",
};

type StageRow = { id: string; kind: "build" | "test" | "security" | "deployment"; label: string };

function stagesOf(plan: ExecutionPlanView): StageRow[] {
  return [
    ...plan.build.map((s) => ({ id: s.id, kind: "build" as const, label: s.componentId })),
    ...plan.tests.map((s) => ({ id: s.id, kind: "test" as const, label: `${s.componentId} · ${s.type}` })),
    ...plan.security.map((s) => ({ id: s.id, kind: "security" as const, label: s.check })),
    ...plan.deployment.map((s) => ({ id: s.id, kind: "deployment" as const, label: `${s.componentId} · ${s.stage}` })),
  ];
}

type Check = { state: "idle" | "checking" } | { state: "done"; result: PreflightResult } | { state: "error"; failure: string };

/**
 * EO-4.1 execution readiness. A pre-flight asks the Control Plane whether a
 * stage of THIS plan revision could be executed: every gate (authorization,
 * plan revision, approval, policy, agent, environment, tool, sandbox) is
 * re-validated server-side. Nothing is executed and there is no execute
 * control in this phase.
 */
export function ExecutionReadiness({ plan }: { plan: ExecutionPlanView }) {
  const { t } = useI18n();
  const { accessToken, accessDetails } = useAuth();
  const canCheck = accessDetails.capabilities.includes("prepare_execution");
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const stages = stagesOf(plan);

  const check = async (stageId: string) => {
    setChecks((c) => ({ ...c, [stageId]: { state: "checking" } }));
    try {
      const result = await runPreflight(
        { projectId: plan.projectId, planId: plan.planId, planVersion: plan.version, stageId },
        accessToken,
      );
      setChecks((c) => ({ ...c, [stageId]: { state: "done", result } }));
    } catch (error) {
      const failure = error instanceof PreflightError ? error.failure : "unavailable";
      setChecks((c) => ({ ...c, [stageId]: { state: "error", failure } }));
    }
  };

  return (
    <section className="plan-section" aria-labelledby="plan-readiness-title" id="plan-readiness">
      <h3 id="plan-readiness-title">{t("execution.title")}</h3>
      <p className="plan-muted">{t("execution.description")}</p>
      {!canCheck ? (
        <p className="plan-muted exec-note">
          <Lock size={14} aria-hidden /> {t("execution.noPermission")}
        </p>
      ) : null}
      <ul className="plan-rows">
        {stages.map((stage) => {
          const state = checks[stage.id] ?? { state: "idle" };
          return (
            <li key={stage.id} className="plan-row plan-row--stacked" data-stage={stage.id}>
              <div className="plan-row">
                <strong>{t(`execution.stage.${stage.kind}` as MessageKey)}</strong>
                <span className="plan-muted">{stage.label}</span>
                <span className="exec-actions">
                  {canCheck ? (
                    <button
                      type="button"
                      className="ui-button"
                      disabled={state.state === "checking"}
                      onClick={() => void check(stage.id)}
                      aria-label={t("execution.checkStage", { stage: stage.label })}
                    >
                      <ShieldCheck size={14} aria-hidden />
                      {t("execution.check")}
                    </button>
                  ) : null}
                </span>
              </div>
              {state.state === "checking" ? (
                <p className="plan-muted" role="status">
                  {t("execution.checking")}
                </p>
              ) : null}
              {state.state === "error" ? (
                <p className="plan-muted" role="alert">
                  {t(`execution.failure.${state.failure}` as MessageKey)}
                </p>
              ) : null}
              {state.state === "done" ? <PreflightOutcome result={state.result} /> : null}
            </li>
          );
        })}
      </ul>
      <p className="plan-muted exec-unavailable">
        <Lock size={14} aria-hidden /> {t("execution.executeUnavailable")}
      </p>
    </section>
  );
}

function PreflightOutcome({ result }: { result: PreflightResult }) {
  const { t } = useI18n();
  const eligible = result.decision === "ELIGIBLE";
  const codes = [...new Set(result.reasons.map((r) => r.code))];
  return (
    <div className="exec-outcome" role="status">
      <Pill tone={eligible ? "positive" : "negative"} icon={eligible ? CheckCircle2 : OctagonAlert}>
        {t(eligible ? "execution.eligible" : "execution.denied")}
      </Pill>
      {result.policy ? (
        <span className="plan-muted">
          {t("execution.policy", { policy: result.policy.policyId, version: result.policy.version })}
        </span>
      ) : null}
      {codes.length > 0 ? (
        <ul className="exec-reasons">
          {codes.map((code) => (
            <li key={code}>{REASON_LABEL[code] ? t(REASON_LABEL[code]) : code}</li>
          ))}
        </ul>
      ) : null}
      {result.requiredApprovals.length > 0 ? (
        <p className="plan-muted">
          {t("execution.requiredApprovals", {
            approvals: result.requiredApprovals.map((a) => `${a.reason} (${a.state})`).join(", "),
          })}
        </p>
      ) : null}
    </div>
  );
}
