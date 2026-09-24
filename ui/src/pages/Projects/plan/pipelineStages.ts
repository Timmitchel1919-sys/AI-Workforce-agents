/**
 * Per-stage planning state, read directly from plan fields. Nothing here
 * recomputes the plan status, and no stage is ever "done": stages are
 * recorded, required, planned, satisfied, missing or blocked.
 */
import {
  CheckCircle2,
  CircleDashed,
  Clock,
  FileText,
  History,
  OctagonAlert,
  type LucideIcon,
} from "lucide-react";
import type { ExecutionPlanView, PlanStatus } from "../../../features/executionPlans";
import type { MessageKey } from "../../../i18n";
import { APPROVAL_STATE } from "./planLabels";

export type Tone = "positive" | "negative" | "warning" | "neutral" | "info";

export const STATUS_TONE: Record<PlanStatus, { tone: Tone; icon: LucideIcon }> = {
  draft: { tone: "neutral", icon: FileText },
  blocked: { tone: "negative", icon: OctagonAlert },
  ready: { tone: "positive", icon: CheckCircle2 },
  awaiting_approval: { tone: "warning", icon: Clock },
  approved: { tone: "positive", icon: CheckCircle2 },
  superseded: { tone: "neutral", icon: History },
};


export interface Stage {
  id: string;
  name: MessageKey;
  state: MessageKey;
  tone: Tone;
  icon: LucideIcon;
}

/** Per-stage planning state, read directly from plan fields. Nothing is "done". */
export function pipelineStages(plan: ExecutionPlanView): Stage[] {
  const recorded = { state: "plans.stateRecorded" as MessageKey, tone: "info" as Tone, icon: FileText };
  const required = { state: "plans.stateRequired" as MessageKey, tone: "info" as Tone, icon: CircleDashed };
  const planned = { state: "plans.statePlanned" as MessageKey, tone: "info" as Tone, icon: CircleDashed };
  const none = { state: "plans.stateNone" as MessageKey, tone: "neutral" as Tone, icon: CircleDashed };
  const blocked = (state: MessageKey) => ({ state, tone: "negative" as Tone, icon: OctagonAlert });

  const envMissing = plan.environments.some((e) => e.status === "missing");
  const agentMissing = plan.agents.some((a) => a.qualification === "none_qualified");
  const approvalStage =
    plan.approvalRequirements.length === 0
      ? none
      : plan.approval.state === "approved"
        ? { state: APPROVAL_STATE.approved, tone: "positive" as Tone, icon: CheckCircle2 }
        : plan.approval.state === "rejected"
          ? blocked(APPROVAL_STATE.rejected)
          : { state: APPROVAL_STATE[plan.approval.state], tone: "warning" as Tone, icon: Clock };

  return [
    { id: "request", name: "plans.stageRequest", ...recorded },
    { id: "architecture", name: "plans.stageArchitecture", ...recorded },
    {
      id: "technology",
      name: "plans.stageTechnology",
      ...(plan.analysis.unsupportedTechnologies.length > 0 ? blocked("plans.stateBlocked") : required),
    },
    {
      id: "environment",
      name: "plans.stageEnvironment",
      ...(plan.environments.length === 0
        ? none
        : envMissing
          ? blocked("plans.stateMissing")
          : { state: "plans.stateSatisfied" as MessageKey, tone: "positive" as Tone, icon: CheckCircle2 }),
    },
    {
      id: "agents",
      name: "plans.stageAgents",
      ...(plan.agents.length === 0
        ? none
        : agentMissing
          ? blocked("plans.noQualifiedAgent")
          : { state: "plans.stateQualified" as MessageKey, tone: "positive" as Tone, icon: CheckCircle2 }),
    },
    {
      id: "dependencies",
      name: "plans.stageDependencies",
      ...(plan.dependencies.conflicts.length > 0
        ? blocked("plans.stateConflict")
        : plan.dependencies.items.length > 0
          ? required
          : none),
    },
    { id: "build", name: "plans.stageBuild", ...(plan.build.length > 0 ? planned : none) },
    { id: "test", name: "plans.stageTest", ...(plan.tests.length > 0 ? required : none) },
    { id: "security", name: "plans.stageSecurity", ...(plan.security.length > 0 ? required : none) },
    { id: "deployment", name: "plans.stageDeployment", ...(plan.deployment.length > 0 ? planned : none) },
    { id: "approval", name: "plans.stageApproval", ...approvalStage },
  ];
}

