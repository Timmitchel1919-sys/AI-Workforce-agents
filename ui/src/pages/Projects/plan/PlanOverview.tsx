import type { ReactNode } from "react";
import { CircleDashed, type LucideIcon } from "lucide-react";
import type { ExecutionPlanView, PlanStatus } from "../../../features/executionPlans";
import { formatDateTime, useI18n } from "../../../i18n";
import { APPROVAL_STATE, PLAN_STATUS, label } from "./planLabels";
import { STATUS_TONE, pipelineStages, type Tone } from "./pipelineStages";

/** Status is conveyed by icon + text + tone — never by color alone. */
export function Pill({ tone, icon: Icon, children }: { tone: Tone; icon: LucideIcon; children: ReactNode }) {
  return (
    <span className={`plan-pill plan-pill--${tone}`}>
      <Icon size={14} aria-hidden />
      <span>{children}</span>
    </span>
  );
}

export function PlanStatusPill({ status }: { status: PlanStatus }) {
  const { t } = useI18n();
  const meta = STATUS_TONE[status] ?? { tone: "neutral" as Tone, icon: CircleDashed };
  return (
    <Pill tone={meta.tone} icon={meta.icon}>
      {PLAN_STATUS[status] ? t(PLAN_STATUS[status]) : status}
    </Pill>
  );
}

function Metric({ label: name, value }: { label: string; value: ReactNode }) {
  return (
    <div className="plan-metric">
      <dt>{name}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** Concise summary — every number is counted from the returned plan itself. */
export function PlanSummary({ plan, projectName }: { plan: ExecutionPlanView; projectName: string }) {
  const { t, language } = useI18n();
  const selected = plan.environments.filter((e) => e.status === "satisfied").length;
  const qualified = plan.agents.filter((a) => a.qualification === "qualified").length;
  const approval =
    plan.approvalRequirements.length === 0 ? t("plans.approvalNone") : t(APPROVAL_STATE[plan.approval.state]);
  return (
    <section className="plan-summary" aria-labelledby="plan-summary-title">
      <div className="plan-summary__head">
        <div>
          <h2 id="plan-summary-title" className="plan-summary__title">
            {plan.request.title}
          </h2>
          <p className="plan-muted">
            {projectName} · {t("plans.version", { version: plan.version })} ·{" "}
            {plan.current ? t("plans.current") : t("plans.historical")}
          </p>
        </div>
        <PlanStatusPill status={plan.status} />
      </div>
      <dl className="plan-metrics" aria-label={t("plans.summaryLabel")}>
        <Metric
          label={t("plans.architecture")}
          value={`${t(plan.architecture.style === "multi_platform" ? "plans.multiPlatform" : "plans.singlePlatform")} · ${plan.architecture.layers
            .map((l) => label.kind(t, l))
            .join(", ")}`}
        />
        <Metric
          label={t("plans.environments")}
          value={t("plans.environmentsValue", { selected, required: plan.environments.length })}
        />
        <Metric
          label={t("plans.agents")}
          value={t("plans.agentsValue", { qualified, required: plan.agents.length })}
        />
        <Metric label={t("plans.blockers")} value={plan.blockers.length} />
        <Metric label={t("plans.approvals")} value={approval} />
        <Metric label={t("plans.created")} value={formatDateTime(plan.createdAt, language)} />
        <Metric label={t("plans.updated")} value={formatDateTime(plan.updatedAt, language)} />
      </dl>
    </section>
  );
}

export function PlanPipeline({ plan }: { plan: ExecutionPlanView }) {
  const { t } = useI18n();
  return (
    <section className="plan-section" aria-labelledby="plan-pipeline-title">
      <h3 id="plan-pipeline-title">{t("plans.pipeline")}</h3>
      <p className="plan-muted">{t("plans.pipelineNote")}</p>
      <ol className="plan-pipeline">
        {pipelineStages(plan).map((stage) => (
          <li key={stage.id} className={`plan-pipeline__stage plan-pipeline__stage--${stage.tone}`} data-stage={stage.id}>
            <span className="plan-pipeline__name">{t(stage.name)}</span>
            <Pill tone={stage.tone} icon={stage.icon}>
              {t(stage.state)}
            </Pill>
          </li>
        ))}
      </ol>
    </section>
  );
}
