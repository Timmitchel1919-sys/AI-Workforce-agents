import { Button } from "../../../components/ui";
import type { OnboardingSession } from "../types";
import { canProvision, shortHash } from "../lib/steps";
import { useT } from "../lib/useT";
import { FindingRows } from "./AnalysisView";
import { DefList, Notice, Section, Tag, Unavailable } from "./common";
import {
  ArchitectureView,
  AutonomyView,
  CostView,
  DeploymentView,
  EnvironmentsView,
  GitView,
  GovernanceView,
  IntegrationsView,
  PipelineView,
  SecretsView,
  TechnologyView,
  WorkforceView,
} from "./PlanViews";

interface Props {
  session: OnboardingSession;
  /** True when an edit was made and the plan has not been regenerated yet. */
  planStale: boolean;
  pending: boolean;
  onBack: () => void;
  onRegenerate: () => void;
  onApprove: () => void;
  onProvision: () => void;
}

/** One consolidated review. Approve and Provision are separate, deliberate actions. */
export function ReviewStep({ session, planStale, pending, onBack, onRegenerate, onApprove, onProvision }: Props) {
  const { tt } = useT();
  const plan = session.plan;
  if (!plan) {
    return (
      <div className="ob-stack">
        <Notice tone="warning">{tt("review.noPlan")}</Notice>
        <div className="ob-actions">
          <Button type="button" onClick={onBack}>{tt("common.back")}</Button>
          <Button type="button" variant="primary" loading={pending} onClick={onRegenerate}>{tt("plan.generate")}</Button>
        </div>
      </div>
    );
  }
  const identity = plan.identity;
  const blocked = plan.blockers.length > 0;
  const approved = session.status === "approved";
  const canApprove = session.status === "review_required" && !blocked && !planStale;
  const repository = plan.repository;
  return (
    <div className="ob-stack" data-testid="review-step">
      <DefList
        items={[
          { label: tt("review.planVersion"), value: String(plan.planVersion) },
          { label: tt("review.planHash"), value: <code className="ob-code" title={plan.planHash}>{shortHash(plan.planHash)}</code> },
          { label: tt("review.generatedAt"), value: plan.generatedAt },
        ]}
      />

      {planStale ? (
        <Notice tone="warning">
          {tt("review.planStale")}{" "}
          <Button type="button" size="small" loading={pending} onClick={onRegenerate}>{tt("plan.regenerate")}</Button>
        </Notice>
      ) : null}

      <Section id="rv-findings" title={tt("review.findings")}>
        {plan.blockers.length === 0 ? (
          <p><Tag tone="success">{tt("review.noBlockers")}</Tag></p>
        ) : (
          <ul className="ob-list" data-testid="plan-blockers">
            {plan.blockers.map((b) => (
              <li key={b.code} className="ob-list__item"><Tag tone="danger">{tt("severity.blocker")}</Tag> {b.message}</li>
            ))}
          </ul>
        )}
        {plan.warnings.length > 0 ? (
          <ul className="ob-list" data-testid="plan-warnings">
            {plan.warnings.map((w) => (
              <li key={w.code} className="ob-list__item"><Tag tone="warning">{tt("severity.warning")}</Tag> {w.message}</li>
            ))}
          </ul>
        ) : null}
        {blocked ? <Notice tone="warning">{tt("review.blockedNote")}</Notice> : null}
      </Section>

      <Section id="rv-source" title={tt("review.source")}>
        <DefList
          items={[
            { label: tt("identity.name"), value: `${identity.name} (${identity.code})` },
            { label: tt("review.projectId"), value: <code className="ob-code">{identity.projectId}</code> },
            { label: tt("identity.owner"), value: identity.owner },
            { label: tt("identity.priority"), value: tt(`priority.${identity.priority}`) },
            { label: tt("identity.objective"), value: identity.objective ?? <Unavailable /> },
            { label: tt("source.repositoryUrl"), value: plan.source.repositoryUrl ?? repository.repositoryUrl ?? <Unavailable /> },
            { label: tt("analysis.branch"), value: repository.branch ?? repository.defaultBranch ?? <Unavailable /> },
            { label: tt("analysis.commit"), value: repository.commit ?? <Unavailable /> },
          ]}
        />
      </Section>
      <Section id="rv-tech" title={tt("review.technology")}><TechnologyView plan={plan} /></Section>
      <Section id="rv-arch" title={tt("review.architecture")}><ArchitectureView plan={plan} /></Section>
      <Section id="rv-env" title={tt("review.environments")}><EnvironmentsView plan={plan} /></Section>
      <Section id="rv-work" title={tt("review.workforce")}><WorkforceView plan={plan} /></Section>
      <Section id="rv-perm" title={tt("review.permissions")}><AutonomyView plan={plan} /></Section>
      <Section id="rv-int" title={tt("review.integrations")}><IntegrationsView plan={plan} /></Section>
      <Section id="rv-sec" title={tt("review.secrets")}><SecretsView plan={plan} /></Section>
      <Section id="rv-git" title={tt("review.git")}><GitView plan={plan} /></Section>
      <Section id="rv-pipe" title={tt("review.buildTest")}><PipelineView plan={plan} /></Section>
      <Section id="rv-dep" title={tt("review.deployment")}><DeploymentView plan={plan} /></Section>
      <Section id="rv-cost" title={tt("review.cost")}><CostView plan={plan} /></Section>
      <Section id="rv-gov" title={tt("review.governance")}>
        <GovernanceView plan={plan} />
        {session.analysis ? <FindingRows findings={session.analysis.findings} /> : null}
      </Section>

      <Section id="rv-steps" title={tt("review.plannedSteps")} description={tt("review.plannedStepsNote")}>
        <ol className="ob-list">
          {plan.steps.map((s) => (
            <li key={s.key} className="ob-list__item">
              <span className="ob-strong">{s.title}</span>{" "}
              <Tag tone={s.executable ? "info" : "warning"}>{s.executable ? tt("review.executable") : tt("review.pendingRequirement")}</Tag>{" "}
              {s.mandatory ? <Tag>{tt("review.mandatory")}</Tag> : null}
              <div className="ob-muted">{s.description}</div>
            </li>
          ))}
        </ol>
      </Section>

      {approved && session.approval ? (
        <Notice>{tt("review.approvedBy", { who: session.approval.approvedBy, hash: shortHash(session.approval.planHash) })}</Notice>
      ) : null}

      <div className="ob-actions ob-actions--sticky">
        <Button type="button" onClick={onBack} disabled={pending}>{tt("common.back")}</Button>
        {!approved ? (
          <Button type="button" variant="primary" disabled={!canApprove || pending} loading={pending} onClick={onApprove}>
            {tt("review.approve")}
          </Button>
        ) : null}
        <Button type="button" variant="primary" disabled={!canProvision(session) || pending} loading={pending && approved} onClick={onProvision}>
          {tt("review.provision")}
        </Button>
      </div>
      {!approved ? <p className="ob-muted">{tt("review.provisionHint")}</p> : null}
    </div>
  );
}
