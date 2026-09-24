import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Info, Lock } from "lucide-react";
import { Card, EmptyState, ErrorState, Skeleton, StatusBadge } from "../../components/ui";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import {
  useProjectExecutionPlan,
  type BlockerCode,
  type ExecutionPlanView,
  type PlanStatus,
} from "../../features/executionPlans";
import { formatDateTime, useI18n, type MessageKey } from "../../i18n";
import "./ExecutionPlan.css";

type BadgeStatus = Parameters<typeof StatusBadge>[0]["status"];

const STATUS_BADGE: Record<PlanStatus, BadgeStatus> = {
  draft: "idle",
  blocked: "blocked",
  ready: "online",
  awaiting_approval: "pending",
  approved: "completed",
  superseded: "offline",
};

const STATUS_LABEL: Record<PlanStatus, MessageKey> = {
  draft: "plans.statusDraft",
  blocked: "plans.statusBlocked",
  ready: "plans.statusReady",
  awaiting_approval: "plans.statusAwaitingApproval",
  approved: "plans.statusApproved",
  superseded: "plans.statusSuperseded",
};

const BLOCKER_LABEL: Record<BlockerCode, MessageKey> = {
  MISSING_ENVIRONMENT: "plans.blockerMissingEnvironment",
  MISSING_CAPABILITY: "plans.blockerMissingCapability",
  MISSING_TOOLCHAIN: "plans.blockerMissingToolchain",
  UNSUPPORTED_TECHNOLOGY: "plans.blockerUnsupportedTechnology",
  NO_QUALIFIED_AGENT: "plans.blockerNoQualifiedAgent",
  DEPENDENCY_CONFLICT: "plans.blockerDependencyConflict",
  MISSING_MODEL_CAPABILITY: "plans.blockerMissingModelCapability",
  APPROVAL_REJECTED: "plans.blockerApprovalRejected",
};

function Tag({ tone, children }: { tone: "required" | "available" | "selected" | "missing" | "planned"; children: ReactNode }) {
  return <span className={`plan-tag plan-tag--${tone}`}>{children}</span>;
}

function Header() {
  const { t } = useI18n();
  return (
    <>
      <PageHeader eyebrow={t("common.brand")} title={t("plans.title")} description={t("plans.description")} />
      <Link to="/projects" className="task-detail-header__back-link plan-back">
        <ArrowLeft size={16} aria-hidden />
        <span>{t("plans.backToProjects")}</span>
      </Link>
    </>
  );
}

export default function ExecutionPlanPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { t } = useI18n();
  const { status, data, refetch } = useProjectExecutionPlan(projectId);

  let body: ReactNode;
  if (status === "loading") {
    body = (
      <div className="plan-list" role="status" aria-label={t("plans.loading")}>
        <Skeleton height={96} width="100%" />
        <Skeleton height={240} width="100%" />
      </div>
    );
  } else if (status === "unauthenticated" || status === "forbidden") {
    body = (
      <ErrorState
        icon={<Lock size={28} />}
        title={t(status === "forbidden" ? "plans.forbiddenTitle" : "plans.unauthenticatedTitle")}
        description={t(status === "forbidden" ? "plans.forbiddenDescription" : "plans.unauthenticatedDescription")}
      />
    );
  } else if (status === "not_found") {
    body = (
      <ErrorState
        title={t("plans.notFoundTitle")}
        description={t("plans.notFoundDescription", { id: projectId ?? "" })}
      />
    );
  } else if (status === "error") {
    body = (
      <ErrorState
        title={t("plans.errorTitle")}
        description={t("plans.errorDescription")}
        onRetry={() => void refetch()}
        retryLabel={t("common.retry")}
      />
    );
  } else if (status === "empty" || !data?.plan) {
    body = <EmptyState title={t("plans.emptyTitle")} description={t("plans.emptyDescription")} />;
  } else {
    body = <PlanDetail plan={data.plan} />;
  }

  return (
    <PageContainer>
      <Header />
      {body}
    </PageContainer>
  );
}

function PlanDetail({ plan }: { plan: ExecutionPlanView }) {
  const { t, language } = useI18n();
  return (
    <div className="plan-detail">
      <section className="plan-summary" aria-label={plan.request.title}>
        <div>
          <h2 className="plan-summary__title">{plan.request.title}</h2>
          <p className="plan-summary__meta">
            {t("plans.version", { version: plan.version })}
            {plan.current ? ` · ${t("plans.current")}` : ""} · {formatDateTime(plan.createdAt, language)}
          </p>
        </div>
        <StatusBadge status={STATUS_BADGE[plan.status]}>{t(STATUS_LABEL[plan.status])}</StatusBadge>
      </section>

      <p className="plan-notice" role="note">
        <Info size={16} aria-hidden />
        {t("plans.executionUnavailable")}
      </p>

      <Card title={t("plans.blockers")}>
        {plan.blockers.length === 0 ? (
          <p className="plan-muted">{t("plans.noBlockers")}</p>
        ) : (
          <ul className="plan-rows">
            {plan.blockers.map((b) => (
              <li key={`${b.code}:${b.subjectId}`} className="plan-row">
                <Tag tone="missing">{t(BLOCKER_LABEL[b.code])}</Tag>
                <code>{b.subjectId}</code>
                {b.missing.length > 0 ? (
                  <span className="plan-muted">
                    {t("plans.missing")}: {b.missing.join(", ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="plan-grid">
        <Card title={t("plans.architecture")}>
          <p>{t(plan.architecture.style === "multi_platform" ? "plans.multiPlatform" : "plans.singlePlatform")}</p>
          <p className="plan-muted">{[...plan.architecture.layers, ...plan.architecture.platforms].join(" · ")}</p>
        </Card>

        <Card title={t("plans.technologies")}>
          <ul className="plan-rows">
            {plan.analysis.technologies.map((tech) => (
              <li key={`${tech.componentId}:${tech.technologyId}`} className="plan-row">
                <Tag tone="required">{t("plans.required")}</Tag>
                <code>{tech.technologyId}</code>
                <span className="plan-muted">{tech.componentId}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card title={t("plans.environments")}>
        <ul className="plan-rows">
          {plan.environments.map((env) => {
            const available = env.match.candidates.filter((c) => c.eligible).length;
            return (
              <li key={env.id} className="plan-row plan-row--stacked">
                <div className="plan-row">
                  <strong>{env.componentIds.join(", ")}</strong>
                  {env.status === "satisfied" ? (
                    <Tag tone="selected">
                      {t("plans.selected")}: {env.match.selectedInstanceId}
                    </Tag>
                  ) : (
                    <Tag tone="missing">{t("plans.missing")}</Tag>
                  )}
                  <Tag tone="available">
                    {t("plans.available")}: {available}
                  </Tag>
                  <span className="plan-muted">
                    {t(env.descriptorSupport === "supported" ? "plans.typeSupported" : "plans.typeUnsupported")}
                  </span>
                </div>
                <div className="plan-row">
                  <Tag tone="required">{t("plans.required")}</Tag>
                  <span className="plan-muted">
                    {[
                      ...(env.requirement.os?.os ? [env.requirement.os.os] : []),
                      ...(env.requirement.requiredCapabilities ?? []),
                      ...(env.requirement.toolchains ?? []).flatMap((tc) => [
                        tc.minimum ? `${tc.kind} ≥ ${tc.minimum.major}.${tc.minimum.minor}` : tc.kind,
                        ...(tc.components ?? []).map((c) => `${tc.kind}:${c.name}`),
                      ]),
                    ].join(" · ")}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title={t("plans.agents")}>
        <ul className="plan-rows">
          {plan.agents.map((a) => (
            <li key={a.requirementId} className="plan-row">
              <code>{a.requirementId}</code>
              <Tag tone="required">{a.requiredCapabilities.join(", ")}</Tag>
              {a.agentId ? (
                <Tag tone="selected">
                  {t("plans.selected")}: {a.agentId}
                </Tag>
              ) : (
                <Tag tone="missing">{t("plans.noQualifiedAgent")}</Tag>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <div className="plan-grid">
        <Card title={t("plans.dependencies")}>
          <ol className="plan-ordered">
            {plan.dependencies.order.map((id) => (
              <li key={id}>
                <code>{id}</code>
              </li>
            ))}
          </ol>
        </Card>

        <Card title={t("plans.build")}>
          <ul className="plan-rows">
            {plan.build.map((stage) => (
              <li key={stage.id} className="plan-row">
                <Tag tone="planned">{t("plans.planned")}</Tag>
                <code>{stage.componentId}</code>
                <span className="plan-muted">{stage.expectedArtifact.kind}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={t("plans.tests")}>
          <ul className="plan-rows">
            {plan.tests.map((stage) => (
              <li key={stage.id} className="plan-row">
                <Tag tone="planned">{t("plans.planned")}</Tag>
                <span>{stage.type}</span>
                <span className="plan-muted">{stage.componentId}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={t("plans.security")}>
          <ul className="plan-rows">
            {plan.security.map((stage) => (
              <li key={stage.id} className="plan-row">
                <Tag tone="planned">{t("plans.planned")}</Tag>
                <span>{stage.check}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card title={t("plans.deployment")}>
          {plan.deployment.length === 0 ? (
            <p className="plan-muted">{t("plans.noDeployments")}</p>
          ) : (
            <ul className="plan-rows">
              {plan.deployment.map((d) => (
                <li key={d.id} className="plan-row">
                  <Tag tone="planned">{t("plans.planned")}</Tag>
                  <span>
                    {d.targetType} · {d.stage}
                  </span>
                  {d.rollbackRequired ? <span className="plan-muted">{t("plans.rollback")}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t("plans.approvals")}>
          {plan.approvalRequirements.length === 0 ? (
            <p className="plan-muted">{t("plans.noApprovals")}</p>
          ) : (
            <>
              <ul className="plan-rows">
                {plan.approvalRequirements.map((a) => (
                  <li key={a.id} className="plan-row">
                    <Tag tone="required">{t("plans.required")}</Tag>
                    <span>{a.reason}</span>
                  </li>
                ))}
              </ul>
              <p className="plan-muted">{t("plans.approvalState", { state: plan.approval.state })}</p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
