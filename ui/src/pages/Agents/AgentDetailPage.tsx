import { Link, useParams } from "react-router-dom";
import { PageFrame } from "../../components/layout";
import { Grid, Section, Stack } from "../../components/layout";
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Identifier,
  KeyValue,
  Metric,
  MetricGroup,
  Skeleton,
  StatusBadge,
  ErrorState,
} from "../../components/ui";
import { ChevronLeft } from "../../components/ui/icons";
import { isApiError } from "../../api";
import { useAgent } from "../../features/agents";
import { AgentActions } from "./components/AgentActions";
import { AgentRecentActivity } from "./components/AgentRecentActivity";
import { formatSuccessRate, toAgentListItem } from "./agentsView";
import "./agents.css";

const BACK = (
  <Link to="/agents" className="link ui-inline" style={{ gap: 4 }}>
    <ChevronLeft width={16} height={16} aria-hidden="true" />
    Back to Agents
  </Link>
);

/**
 * Agent detail — identity, status, capabilities, workload, health boundary,
 * recent activity, configuration, and the single governed action. Structured
 * for later expansion. All fields come from the `AgentView` contract; nothing
 * is fabricated where the backend is silent.
 */
export function AgentDetailPage() {
  const { agentId } = useParams();
  const query = useAgent(agentId);

  if (query.isPending) {
    return (
      <PageFrame title="Agent" description="Loading agent…">
        <Stack gap="lg">
          {BACK}
          <Skeleton height="3rem" />
          <Skeleton height="10rem" />
          <Skeleton height="10rem" />
        </Stack>
      </PageFrame>
    );
  }

  if (query.isError) {
    const notFound =
      isApiError(query.error) && query.error.category === "not_found";
    const forbidden =
      isApiError(query.error) && query.error.category === "forbidden";
    return (
      <PageFrame title="Agent" description="Agent detail">
        <Stack gap="lg">
          {BACK}
          <ErrorState
            variant={
              notFound ? "not-found" : forbidden ? "forbidden" : "network"
            }
            title={
              notFound
                ? "Agent not found"
                : forbidden
                  ? "You don't have access to this agent"
                  : "Unable to load this agent"
            }
            detail={
              notFound
                ? `No agent matches the id "${agentId ?? ""}".`
                : forbidden
                  ? "Your operator role is not permitted to view this agent."
                  : "The Control Center could not retrieve this agent."
            }
            action={
              !notFound && !forbidden ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void query.refetch()}
                >
                  Retry
                </Button>
              ) : undefined
            }
          />
        </Stack>
      </PageFrame>
    );
  }

  const agent = toAgentListItem(query.data);

  return (
    <PageFrame
      title={agent.name}
      description={`${agent.role || "Agent"} · workforce agent`}
      actions={
        <AgentActions agent={agent} onChanged={() => void query.refetch()} />
      }
    >
      <Stack gap="lg">
        {BACK}

        <div className="ui-inline" style={{ gap: "var(--space-sm)" }}>
          <StatusBadge status={agent.status} />
          {!agent.enabled ? <Badge tone="warning">Disabled</Badge> : null}
          <Identifier value={agent.id} />
        </div>

        {agent.disabledReason ? (
          <p className="text-caption">
            Disabled reason: {agent.disabledReason}
          </p>
        ) : null}

        <Grid min="280px" gap="lg">
          <Section title="Identity">
            <Card>
              <CardBody>
                <KeyValue
                  rows={[
                    { key: "Name", value: agent.name },
                    { key: "Role", value: agent.role || "—" },
                    { key: "Agent ID", value: <Identifier value={agent.id} /> },
                    {
                      key: "State",
                      value: agent.enabled ? "Enabled" : "Disabled",
                    },
                    {
                      key: "Current project",
                      value: agent.currentProjectId ?? "—",
                    },
                  ]}
                />
              </CardBody>
            </Card>
          </Section>

          <Section title="Current workload">
            <Card>
              <CardBody>
                <Stack gap="md">
                  <MetricGroup>
                    <Metric label="Tasks" value={agent.taskCount} />
                    <Metric label="Completed" value={agent.completed} />
                    <Metric label="Failed" value={agent.failed} />
                    <Metric
                      label="Success rate"
                      value={formatSuccessRate(agent.successRate)}
                    />
                  </MetricGroup>
                  <KeyValue
                    rows={[
                      {
                        key: "Current task",
                        value: agent.currentTaskId ? (
                          <Link
                            to={`/tasks/${encodeURIComponent(
                              agent.currentTaskId,
                            )}`}
                            className="link"
                          >
                            {agent.currentTaskId}
                          </Link>
                        ) : (
                          "None"
                        ),
                      },
                      { key: "Cancelled", value: agent.cancelled },
                    ]}
                  />
                </Stack>
              </CardBody>
            </Card>
          </Section>

          <Section title="Capabilities">
            <Card>
              <CardBody>
                {agent.capabilities.length > 0 ? (
                  <span className="agent-caps">
                    {agent.capabilities.map((c) => (
                      <Badge key={c} tone="neutral">
                        {c}
                      </Badge>
                    ))}
                  </span>
                ) : (
                  <p className="text-muted">
                    No capabilities reported for this agent.
                  </p>
                )}
              </CardBody>
            </Card>
          </Section>

          <Section title="Health">
            <Card>
              <CardBody>
                <p className="text-muted">
                  Health, heartbeat, and availability metrics are not reported
                  by the Control Plane for agents. This section will populate
                  when the backend exposes agent health.
                </p>
              </CardBody>
            </Card>
          </Section>

          <Section title="Configuration">
            <Card>
              <CardBody>
                <KeyValue
                  rows={[
                    { key: "Role", value: agent.role || "—" },
                    {
                      key: "Allowed projects",
                      value:
                        agent.allowedProjects.length > 0
                          ? agent.allowedProjects.join(", ")
                          : "—",
                    },
                    {
                      key: "Assignable",
                      value: agent.enabled ? "Yes" : "No (disabled)",
                    },
                  ]}
                />
              </CardBody>
            </Card>
          </Section>
        </Grid>

        <Section title="Recent activity">
          <Card>
            <CardHeader
              actions={
                <Link to="/audit" className="link">
                  Open Audit Log
                </Link>
              }
            >
              <span className="text-label">
                Latest audit events for this agent
              </span>
            </CardHeader>
            <CardBody>
              <AgentRecentActivity agentId={agent.id} />
            </CardBody>
          </Card>
        </Section>
      </Stack>
    </PageFrame>
  );
}
