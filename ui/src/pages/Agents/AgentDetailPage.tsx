import { Link, useParams } from "react-router-dom";
import { formatDateTime, translateStatus, useI18n } from "../../i18n";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import PageSection from "../../components/layout/PageSection";
import { Badge, StatusBadge } from "../../components/ui";
import { EmptyState } from "../../components/states/EmptyState";
import { ErrorState } from "../../components/states/ErrorState";
import { useAgents } from "../../features/agents";
import { AgentsLoadingState } from "./components/AgentsLoadingState";

function mapAgentStatusForBadge(status: string) {
  switch (status) {
    case "active":
      return "active";
    case "idle":
      return "idle";
    case "paused":
      return "paused";
    case "offline":
      return "offline";
    case "error":
      return "blocked";
    case "provisioning":
      return "pending";
    default:
      return "offline";
  }
}

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
          backTo="/agents"
          backLabel={t("agents.backToAgents")}
        />
        <AgentsLoadingState />
      </PageContainer>
    );
  }

  if (status === "error" || status === "unauthorized" || status === "degraded") {
    return (
      <PageContainer>
        <PageHeader
          eyebrow={t("common.brand")}
          title={t("agents.detailTitle")}
          description={t("agents.detailDescription")}
          backTo="/agents"
          backLabel={t("agents.backToAgents")}
        />
        <ErrorState
          title={status === "unauthorized" ? t("agents.accessRestricted") : t("agents.errorTitle")}
          description={
            status === "unauthorized"
              ? t("agents.accessRestrictedDescription")
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
          backTo="/agents"
          backLabel={t("agents.backToAgents")}
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

  const capabilities = agent.capabilities.length > 0 ? agent.capabilities : [t("agents.noCapabilities")];
  const healthLabel = agent.health ?? t("common.unavailable");
  const executions = agent.recentExecutions ?? [];

  return (
    <PageContainer>
      <PageHeader
        eyebrow={t("common.brand")}
        title={agent.name}
        description={agent.description ?? t("agents.noDescription")}
        backTo="/agents"
        backLabel={t("agents.backToAgents")}
        breadcrumbs={[{ label: t("agents.title"), href: "/agents" }, { label: agent.name, current: true }]}
      />

      <div className="agent-detail-page">
        <PageSection title={t("agents.identity")} description={t("agents.identityDescription")}>
          <div className="agent-detail-identity">
            <div className="agent-detail-identify">
              <StatusBadge status={mapAgentStatusForBadge(agent.status)}>{translateStatus(t, agent.status)}</StatusBadge>
              <p className="agent-detail-id">{t("agents.agentId", { id: agent.id })}</p>
            </div>
            <div className="agent-detail-metadata">
              <div>
                <span className="agent-detail-label">{t("agents.model")}</span>
                <strong>{agent.model ?? t("common.unavailable")}</strong>
              </div>
              <div>
                <span className="agent-detail-label">{t("common.project")}</span>
                <strong>{agent.projectId ?? t("common.unassigned")}</strong>
              </div>
              <div>
                <span className="agent-detail-label">{t("common.updated")}</span>
                <strong>{formatTimestamp(agent.updatedAt)}</strong>
              </div>
            </div>
          </div>
        </PageSection>

        <div className="agent-detail-grid">
          <PageSection title={t("agents.capabilities")} description={t("agents.capabilitiesDescription")}>
            <div className="agent-detail-tags">
              {capabilities.map((capability) => (
                <Badge key={capability} variant="info">
                  {capability}
                </Badge>
              ))}
            </div>
          </PageSection>

          <PageSection title={t("agents.workload")} description={t("agents.workloadDescription")}>
            <div className="agent-detail-stat-block">
              <strong>{agent.activeTasks ?? 0}</strong>
              <span>{t("agents.activeTasks")}</span>
            </div>
          </PageSection>

          <PageSection title={t("agents.health")} description={t("agents.healthDescription")}>
            <div className="agent-detail-stat-block">
              <strong>{healthLabel}</strong>
              <span>{t("agents.heartbeatUnavailable")}</span>
            </div>
          </PageSection>

          <PageSection title={t("agents.configuration")} description={t("agents.configurationDescription")}>
            <dl className="agent-detail-config">
              <div>
                <dt>{t("common.status")}</dt>
                <dd>{translateStatus(t, agent.status)}</dd>
              </div>
              <div>
                <dt>{t("agents.model")}</dt>
                <dd>{agent.model ?? t("common.unavailable")}</dd>
              </div>
              <div>
                <dt>{t("common.project")}</dt>
                <dd>{agent.projectId ?? t("common.unassigned")}</dd>
              </div>
              <div>
                <dt>{t("common.updated")}</dt>
                <dd>{formatTimestamp(agent.updatedAt)}</dd>
              </div>
            </dl>
          </PageSection>
        </div>

        <PageSection title={t("agents.executions")} description={t("agents.executionsDescription")}>
          {executions.length === 0 ? (
            <EmptyState
              title={t("agents.noExecutionsTitle")}
              description={t("agents.noExecutionsDescription")}
            />
          ) : (
            <ul className="agent-detail-executions">
              {executions.map((execution) => (
                <li key={execution.id} className="agent-detail-execution-item">
                  <div>
                    <strong>{execution.name}</strong>
                    <span>{execution.task ?? t("agents.noTaskLabel")}</span>
                  </div>
                  <div>
                    <Badge variant={execution.status === "completed" ? "success" : execution.status === "failed" ? "danger" : "neutral"}>
                      {translateStatus(t, execution.status)}
                    </Badge>
                  </div>
                  <div>
                    <span>{execution.startedAt ? formatTimestamp(execution.startedAt) : t("agents.startUnavailable")}</span>
                    <small>{execution.duration ?? t("agents.durationUnavailable")}</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </PageSection>

        <PageSection title={t("agents.actions")} description={t("agents.actionsDescription")}>
          <p className="agent-detail-actions">{t("agents.actionsNote")}</p>
        </PageSection>
      </div>
    </PageContainer>
  );
}
