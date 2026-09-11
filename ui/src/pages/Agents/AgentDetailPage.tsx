import { Link, useParams } from "react-router-dom";
import { PageFrame } from "../../components/layout";
import { Section, Stack } from "../../components/layout";
import {
  Button,
  Card,
  CardBody,
  Skeleton,
  ErrorState,
} from "../../components/ui";
import { ChevronLeft } from "../../components/ui/icons";
import { isApiError } from "../../api";
import { useAgent } from "../../features/agents";
import {
  AgentActions,
  AgentAuditSummary,
  AgentCapabilities,
  AgentConfigurationCard,
  AgentDetailHeader,
  AgentExecutions,
  AgentGovernanceCard,
  AgentHealthCard,
  AgentWorkloadCard,
} from "./components";
import { toAgentListItem } from "./agentsView";
import "./agents.css";

const BACK = (
  <Link to="/agents" className="link ui-inline" style={{ gap: 4 }}>
    <ChevronLeft width={16} height={16} aria-hidden="true" />
    Back to Agents
  </Link>
);

/**
 * Agent detail — an observational workspace (UI-5B). Two-column on desktop
 * (main: overview / capabilities / executions — supporting: health /
 * workload / configuration), single column on mobile. Every field comes from
 * the `AgentView` contract; nothing is fabricated where the backend is
 * silent, and the only action offered (enable/disable) is one the Control
 * Plane already governs end-to-end.
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
                  ? "Access restricted"
                  : "Unable to load this agent"
            }
            detail={
              notFound
                ? "The requested agent does not exist or is no longer available."
                : forbidden
                  ? "You do not have permission to view this agent."
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
        <AgentDetailHeader agent={agent} />

        <div className="agent-detail-grid">
          <Stack gap="lg" className="agent-detail-grid__main">
            <Section title="Capabilities">
              <Card>
                <CardBody>
                  <AgentCapabilities capabilities={agent.capabilities} />
                </CardBody>
              </Card>
            </Section>

            <Section title="Recent executions">
              <Card>
                <CardBody>
                  <AgentExecutions
                    agentId={agent.id}
                    currentTaskId={agent.currentTaskId}
                  />
                </CardBody>
              </Card>
            </Section>

            <Section title="Governance activity">
              <Card>
                <CardBody>
                  <AgentAuditSummary agentId={agent.id} />
                </CardBody>
              </Card>
            </Section>
          </Stack>

          <Stack gap="lg" className="agent-detail-grid__aside">
            <Section title="Health">
              <Card>
                <CardBody>
                  <AgentHealthCard />
                </CardBody>
              </Card>
            </Section>

            <Section title="Workload">
              <Card>
                <CardBody>
                  <AgentWorkloadCard agent={agent} />
                </CardBody>
              </Card>
            </Section>

            <Section title="Governance">
              <Card>
                <CardBody>
                  <AgentGovernanceCard agent={agent} />
                </CardBody>
              </Card>
            </Section>

            <Section title="Configuration">
              <Card>
                <CardBody>
                  <AgentConfigurationCard agent={agent} />
                </CardBody>
              </Card>
            </Section>
          </Stack>
        </div>
      </Stack>
    </PageFrame>
  );
}
