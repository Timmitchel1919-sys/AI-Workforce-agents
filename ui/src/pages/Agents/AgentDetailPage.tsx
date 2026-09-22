import { Link, useParams } from "react-router-dom";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import PageSection from "../../components/layout/PageSection";
import { Badge, StatusBadge } from "../../components/ui";
import { EmptyState } from "../../components/states/EmptyState";
import { ErrorState } from "../../components/states/ErrorState";
import { useAgents } from "../../features/agents";
import { AgentsLoadingState } from "./components/AgentsLoadingState";

function formatTimestamp(value?: string) {
  if (!value) {
    return "Not reported";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

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
  const { agentId } = useParams();
  const { data, status, refetch } = useAgents();

  if (status === "loading") {
    return (
      <PageContainer>
        <PageHeader
          eyebrow="AI Workforce"
          title="Agent detail"
          description="Inspect status, execution activity, and configuration details for the selected agent."
        />
        <AgentsLoadingState />
      </PageContainer>
    );
  }

  if (status === "error" || status === "unauthorized" || status === "degraded") {
    return (
      <PageContainer>
        <PageHeader
          eyebrow="AI Workforce"
          title="Agent detail"
          description="Inspect status, execution activity, and configuration details for the selected agent."
        />
        <ErrorState
          title={status === "unauthorized" ? "Access restricted" : "Unable to load agents"}
          description={
            status === "unauthorized"
              ? "You do not have permission to inspect the current agent registry."
              : "The agent detail view could not be loaded from the Control Plane."
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
          eyebrow="AI Workforce"
          title="Agent detail"
          description="Inspect status, execution activity, and configuration details for the selected agent."
          breadcrumbs={[{ label: "Agents", href: "/agents" }, { label: "Not found", current: true }]}
        />
        <EmptyState
          title="Agent not found"
          description="The requested agent is not available in the current registry view."
          primaryAction={<Link to="/agents">Back to agents</Link>}
        />
      </PageContainer>
    );
  }

  const capabilities = agent.capabilities.length > 0 ? agent.capabilities : ["No capabilities reported"];
  const healthLabel = agent.health ?? "Unavailable";
  const executions = agent.recentExecutions ?? [];

  return (
    <PageContainer>
      <PageHeader
        eyebrow="AI Workforce"
        title={agent.name}
        description={agent.description ?? "No description is available for this agent."}
        breadcrumbs={[{ label: "Agents", href: "/agents" }, { label: agent.name, current: true }]}
      />

      <div className="agent-detail-page">
        <PageSection title="Agent identity" description="Core operational identity and availability information.">
          <div className="agent-detail-identity">
            <div className="agent-detail-identify">
              <StatusBadge status={mapAgentStatusForBadge(agent.status)}>{agent.status}</StatusBadge>
              <p className="agent-detail-id">Agent ID: {agent.id}</p>
            </div>
            <div className="agent-detail-metadata">
              <div>
                <span className="agent-detail-label">Model</span>
                <strong>{agent.model ?? "Unavailable"}</strong>
              </div>
              <div>
                <span className="agent-detail-label">Project</span>
                <strong>{agent.projectId ?? "Unassigned"}</strong>
              </div>
              <div>
                <span className="agent-detail-label">Updated</span>
                <strong>{formatTimestamp(agent.updatedAt)}</strong>
              </div>
            </div>
          </div>
        </PageSection>

        <div className="agent-detail-grid">
          <PageSection title="Capabilities" description="The capabilities currently assigned to this agent.">
            <div className="agent-detail-tags">
              {capabilities.map((capability) => (
                <Badge key={capability} variant="info">
                  {capability}
                </Badge>
              ))}
            </div>
          </PageSection>

          <PageSection title="Current workload" description="Active execution information for this agent.">
            <div className="agent-detail-stat-block">
              <strong>{agent.activeTasks ?? 0}</strong>
              <span>active tasks</span>
            </div>
          </PageSection>

          <PageSection title="Health" description="Current health and service availability state.">
            <div className="agent-detail-stat-block">
              <strong>{healthLabel}</strong>
              <span>last heartbeat unavailable</span>
            </div>
          </PageSection>

          <PageSection title="Configuration summary" description="Current configuration details available from the Control Plane.">
            <dl className="agent-detail-config">
              <div>
                <dt>Status</dt>
                <dd>{agent.status}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{agent.model ?? "Unavailable"}</dd>
              </div>
              <div>
                <dt>Project</dt>
                <dd>{agent.projectId ?? "Unassigned"}</dd>
              </div>
              <div>
                <dt>Updated</dt>
                <dd>{formatTimestamp(agent.updatedAt)}</dd>
              </div>
            </dl>
          </PageSection>
        </div>

        <PageSection title="Recent executions" description="The most recent activity associated with the selected agent.">
          {executions.length === 0 ? (
            <EmptyState
              title="No execution history yet"
              description="Execution history is not available for this agent yet."
            />
          ) : (
            <ul className="agent-detail-executions">
              {executions.map((execution) => (
                <li key={execution.id} className="agent-detail-execution-item">
                  <div>
                    <strong>{execution.name}</strong>
                    <span>{execution.task ?? "No task label"}</span>
                  </div>
                  <div>
                    <Badge variant={execution.status === "completed" ? "success" : execution.status === "failed" ? "danger" : "neutral"}>
                      {execution.status}
                    </Badge>
                  </div>
                  <div>
                    <span>{execution.startedAt ? formatTimestamp(execution.startedAt) : "Start time unavailable"}</span>
                    <small>{execution.duration ?? "Duration unavailable"}</small>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </PageSection>

        <PageSection title="Available actions" description="No destructive operations are provided in this UI layer.">
          <p className="agent-detail-actions">This module is intentionally read-only and may be expanded when the Control Plane exposes safe operational actions.</p>
        </PageSection>
      </div>
    </PageContainer>
  );
}
