import { Link, useParams } from "react-router-dom";
import { formatDateTime, translateStatus, useI18n } from "../../i18n";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import PageSection from "../../components/layout/PageSection";
import { Badge } from "../../components/ui";
import { EmptyState } from "../../components/states/EmptyState";
import { ErrorState } from "../../components/states/ErrorState";
import { useAgents } from "../../features/agents";
import { AgentsLoadingState } from "./components/AgentsLoadingState";
import { AgentsErrorState } from "./components/AgentsErrorState";
import { AxisBadges, LabelledValue, PolicyBadgeList } from "./components/agentPresentation";
import { mapOperationalStateToBadge } from "./components/agentStatus";
import { StatusBadge } from "../../components/ui";

export default function AgentDetailPage() {
  const { t, language } = useI18n();
  const formatTimestamp = (value?: string) => formatDateTime(value, language) ?? t("common.notReported");
  const { agentId } = useParams();
  const { data, status, refetch } = useAgents();

  if (status === "loading") {
    return (
      <PageContainer>
        <PageHeader
          eyebrow={t("common.brand")}
          title={t("agents.detailTitle")}
          description={t("agents.detailDescription")}
        />
        <AgentsLoadingState />
      </PageContainer>
    );
  }

  // "Not composed" and "not configured" are not "agent not found": they mean
  // this view cannot be answered at all, so they are not reported as a missing
  // agent, which would imply a lookup had actually happened.
  if (status !== "ready" && status !== "empty") {
    if (status === "notComposed" || status === "notConfigured") {
      return (
        <PageContainer>
          <PageHeader
            eyebrow={t("common.brand")}
            title={t("agents.detailTitle")}
            description={t("agents.detailDescription")}
          />
          <AgentsErrorState state={status} onRetry={refetch} />
        </PageContainer>
      );
    }
    return (
      <PageContainer>
        <PageHeader
          eyebrow={t("common.brand")}
          title={t("agents.detailTitle")}
          description={t("agents.detailDescription")}
        />
        <ErrorState
          title={status === "unauthorized" ? t("agents.accessRestricted") : t("agents.errorTitle")}
          description={
            status === "unauthorized"
              ? t("agents.accessRestrictedDescription")
              : status === "degraded"
                ? t("agents.degradedDescription")
                : t("agents.detailErrorDescription")
          }
          onRetry={refetch}
        />
      </PageContainer>
    );
  }

  const agent = data?.agents.find((candidate) => candidate.id === agentId);

  if (!agent) {
    return (
      <PageContainer>
        <PageHeader
          eyebrow={t("common.brand")}
          title={t("agents.detailTitle")}
          description={t("agents.detailDescription")}
          breadcrumbs={[{ label: t("agents.title"), href: "/agents" }, { label: t("agents.notFound"), current: true }]}
        />
        <EmptyState
          title={t("agents.notFoundTitle")}
          description={t("agents.notFoundDescription")}
          primaryAction={<Link to="/agents">{t("agents.backToAgents")}</Link>}
        />
      </PageContainer>
    );
  }

  const specialist = agent.specialist;
  const operationalState = specialist ? specialist.operationalState : agent.status;

  return (
    <PageContainer>
      <PageHeader
        eyebrow={t("common.brand")}
        title={specialist?.displayName ?? agent.name}
        description={agent.description ?? t("agents.noDescription")}
        breadcrumbs={[{ label: t("agents.title"), href: "/agents" }, { label: agent.name, current: true }]}
      />

      <div className="agent-detail-page">
        <PageSection title={t("agents.identity")} description={t("agents.identityDescription")}>
          <div className="agent-detail-identity">
            <div className="agent-detail-identify">
              {/* Both axes, always. A single badge here would let a suspended
                  agent or an instance-less agent read as available. */}
              {specialist ? (
                <AxisBadges agent={agent} t={t} />
              ) : (
                <StatusBadge status={mapOperationalStateToBadge(operationalState)}>
                  {translateStatus(t, operationalState)}
                </StatusBadge>
              )}
              <p className="agent-detail-id">{t("agents.agentId", { id: agent.id })}</p>
            </div>
            <div className="agent-detail-metadata">
              <LabelledValue label={t("agents.department")}>
                {specialist?.department ?? t("common.unavailable")}
              </LabelledValue>
              <LabelledValue label={t("agents.instances")}>
                {specialist
                  ? specialist.instanceCount > 0
                    ? t("agents.instanceCountLabel", { count: specialist.instanceCount })
                    : t("agents.noInstances")
                  : t("common.unavailable")}
              </LabelledValue>
              <LabelledValue label={t("common.updated")}>{formatTimestamp(agent.lastActivityAt)}</LabelledValue>
            </div>
          </div>

          <div className="agent-axis-explanations">
            <p>
              <strong>{t("agents.administrativeStatus")}:</strong>{" "}
              {specialist ? t("agents.administrativeStatusDescription") : t("agents.legacyAgentDescription")}
            </p>
            <p>
              <strong>{t("agents.operationalStatus")}:</strong> {t("agents.operationalStatusDescription")}
            </p>
          </div>
        </PageSection>

        <PageSection title={t("agents.capabilities")} description={t("agents.capabilitiesDescription")}>
          <div className="agent-detail-tags">
            <PolicyBadgeList
              values={agent.capabilities}
              variant="info"
              emptyLabel={t("agents.noCapabilities")}
            />
          </div>
          {specialist && specialist.supportedTaskTypes.length > 0 ? (
            <div className="agent-detail-tags">
              <span className="agent-detail-label">{t("agents.supportedTaskTypes")}</span>
              <PolicyBadgeList
                values={specialist.supportedTaskTypes}
                variant="neutral"
                emptyLabel={t("agents.noCapabilities")}
              />
            </div>
          ) : null}
        </PageSection>

        <div className="agent-detail-grid">
          <PageSection title={t("agents.currentAssignment")} description={t("agents.qualifiedNoticeDescription")}>
            {specialist?.currentAssignmentId ? (
              <dl className="agent-detail-config">
                <div>
                  <dt>{t("agents.currentAssignment")}</dt>
                  <dd>{specialist.currentAssignmentId}</dd>
                </div>
                <div>
                  <dt>{t("agents.currentTask")}</dt>
                  <dd>{specialist.currentTaskId ?? t("common.unavailable")}</dd>
                </div>
              </dl>
            ) : (
              <p className="agent-detail-muted">{t("agents.noAssignment")}</p>
            )}
            <p className="agent-detail-caveat">{t("agents.qualifiedNoticeDescription")}</p>
          </PageSection>

          <PageSection title={t("agents.workload")} description={t("agents.workloadDescription")}>
            <div className="agent-detail-stat-block">
              <strong>{agent.taskCount}</strong>
              <span>{t("agents.colTasks")}</span>
            </div>
            <div className="agent-detail-stat-block">
              <strong>{agent.completed}</strong>
              <span>{t("status.completed")}</span>
            </div>
            <div className="agent-detail-stat-block">
              <strong>{agent.failed}</strong>
              <span>{t("status.failed")}</span>
            </div>
          </PageSection>
        </div>

        {specialist ? (
          <>
            <PageSection title={t("agents.limitations")} description={t("agents.limitationsDescription")}>
              {specialist.limitations.length > 0 ? (
                <ul className="agent-detail-limitations">
                  {specialist.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
              ) : (
                <p className="agent-detail-caveat">{t("agents.noLimitationsReported")}</p>
              )}
            </PageSection>

            <PageSection title={t("agents.policies")} description={t("agents.policiesDescription")}>
              <dl className="agent-detail-config">
                <div>
                  <dt>{t("agents.descriptorVersion")}</dt>
                  <dd>{specialist.descriptorVersion}</dd>
                </div>
                <div>
                  <dt>{t("agents.riskCeiling")}</dt>
                  <dd>
                    {specialist.riskCeiling === "unknown"
                      ? t("agents.riskCeilingUnknown")
                      : specialist.riskCeiling}
                  </dd>
                </div>
                <div>
                  <dt>{t("agents.modelPolicy")}</dt>
                  <dd>
                    {specialist.modelPolicy.model
                      ? `${specialist.modelPolicy.provider} · ${specialist.modelPolicy.model}`
                      : specialist.modelPolicy.provider === "unscoped"
                        ? t("agents.modelUnscoped")
                        : t("agents.providerOnly")}
                  </dd>
                </div>
                <div>
                  <dt>{t("agents.reviewPolicy")}</dt>
                  <dd>
                    {specialist.reviewPolicy.requiresIndependentReview
                      ? t("agents.independentReviewRequired")
                      : t("agents.selfReviewAllowed")}
                    {" · "}
                    {specialist.reviewPolicy.selfReviewAllowed
                      ? t("agents.selfReviewAllowed")
                      : t("agents.neverSelfReview")}
                    {" · "}
                    {t("agents.minimumReviewers", { count: specialist.reviewPolicy.minimumReviewers })}
                  </dd>
                </div>
                <div>
                  <dt>{t("agents.toolPolicy")}</dt>
                  <dd>
                    <div className="agent-detail-policy">
                      <span className="agent-detail-label">{t("agents.allowedCapabilities")}</span>
                      <PolicyBadgeList
                        values={specialist.toolPolicy.maxExecutionCapabilities}
                        variant="success"
                        emptyLabel={t("agents.noDeniedCapabilities")}
                      />
                    </div>
                    <div className="agent-detail-policy">
                      <span className="agent-detail-label">{t("agents.deniedCapabilities")}</span>
                      <PolicyBadgeList
                        values={specialist.toolPolicy.deniedExecutionCapabilities}
                        variant="danger"
                        emptyLabel={t("agents.noDeniedCapabilities")}
                      />
                    </div>
                    <div className="agent-detail-policy">
                      <span className="agent-detail-label">
                        {t("agents.unrestrictedShell")}:{" "}
                        {specialist.toolPolicy.allowsUnrestrictedShell
                          ? t("status.online")
                          : t("agents.unrestrictedShellDenied")}
                      </span>
                    </div>
                  </dd>
                </div>
                <div>
                  <dt>{t("agents.projectPolicy")}</dt>
                  <dd>
                    <div className="agent-detail-policy">
                      <span className="agent-detail-label">{t("agents.projectAllowList")}</span>
                      <PolicyBadgeList
                        values={specialist.projectPolicy.projects}
                        variant="info"
                        emptyLabel={t("agents.noProjectScope")}
                      />
                    </div>
                  </dd>
                </div>
              </dl>
            </PageSection>
          </>
        ) : (
          <PageSection title={t("agents.legacyAgentTitle")} description={t("agents.legacyAgentDescription")}>
            <div className="agent-detail-tags">
              <Badge variant="warning">{t("agents.legacyAgentTitle")}</Badge>
            </div>
            <p className="agent-detail-caveat">{t("agents.legacyAgentDescription")}</p>
          </PageSection>
        )}

        <PageSection title={t("agents.actions")} description={t("agents.actionsDescription")}>
          <p className="agent-detail-actions">{t("agents.actionsNote")}</p>
        </PageSection>
      </div>
    </PageContainer>
  );
}
