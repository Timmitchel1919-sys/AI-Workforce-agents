import { useEffect, useMemo, useState } from "react";
import { Input, Pagination, Select } from "../../components/ui";
import PageContainer from "../../components/layout/PageContainer";
import PageHeader from "../../components/layout/PageHeader";
import PageSection from "../../components/layout/PageSection";
import { useAgents } from "../../features/agents";
import { AgentRegistry } from "./components/AgentRegistry";
import { AgentsEmptyState } from "./components/AgentsEmptyState";
import { AgentsErrorState } from "./components/AgentsErrorState";
import { AgentsLoadingState } from "./components/AgentsLoadingState";
import "./AgentsPage.css";

const PAGE_SIZE = 6;

const statusOptions = [
  "all",
  "active",
  "idle",
  "offline",
  "paused",
  "error",
  "provisioning",
] as const;

function formatMetricLabel(value: number, label: string) {
  return `${value} ${label}`;
}

export default function AgentsPage() {
  const { data, status, refetch } = useAgents();
  const agents = data?.agents ?? [];
  const summary = data?.summary ?? { total: 0, active: 0, idle: 0, offline: 0, healthy: 0 };

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof statusOptions)[number]>("all");
  const [capabilityFilter, setCapabilityFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [page, setPage] = useState(1);

  const capabilities = useMemo(
    () => Array.from(new Set(agents.flatMap((agent) => agent.capabilities))).sort(),
    [agents],
  );

  const projects = useMemo(
    () => Array.from(new Set(agents.map((agent) => agent.projectId).filter(Boolean))).sort(),
    [agents],
  );

  const filteredAgents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return agents.filter((agent) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        [agent.name, agent.description, agent.model, ...(agent.capabilities ?? [])]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery));

      const matchesStatus = statusFilter === "all" || agent.status === statusFilter;
      const matchesCapability = capabilityFilter === "all" || agent.capabilities.includes(capabilityFilter);
      const matchesProject = projectFilter === "all" || agent.projectId === projectFilter;

      return matchesQuery && matchesStatus && matchesCapability && matchesProject;
    });
  }, [agents, capabilityFilter, projectFilter, query, statusFilter]);

  useEffect(() => {
    setPage(1);
  }, [query, statusFilter, capabilityFilter, projectFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredAgents.length / PAGE_SIZE));
  const pagedAgents = filteredAgents.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (status === "loading") {
    return (
      <PageContainer>
        <PageHeader
          eyebrow="AI Workforce"
          title="Agents"
          description="Monitor and manage the agents operating across your workforce."
        />
        <AgentsLoadingState />
      </PageContainer>
    );
  }

  if (status === "error") {
    return (
      <PageContainer>
        <PageHeader
          eyebrow="AI Workforce"
          title="Agents"
          description="Monitor and manage the agents operating across your workforce."
        />
        <AgentsErrorState onRetry={refetch} />
      </PageContainer>
    );
  }

  if (status === "unauthorized") {
    return (
      <PageContainer>
        <PageHeader
          eyebrow="AI Workforce"
          title="Agents"
          description="Monitor and manage the agents operating across your workforce."
        />
        <AgentsErrorState onRetry={refetch} />
      </PageContainer>
    );
  }

  if (status === "empty") {
    return (
      <PageContainer>
        <PageHeader
          eyebrow="AI Workforce"
          title="Agents"
          description="Monitor and manage the agents operating across your workforce."
        />
        <AgentsEmptyState />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="AI Workforce"
        title="Agents"
        description="Monitor and manage the agents operating across your workforce."
      />

      <div className="agents-page">
        <div className="agents-summary" aria-label="Agent summary metrics">
          <div className="agents-summary__metric">
            <span className="agents-summary__label">Total Agents</span>
            <strong>{summary.total}</strong>
          </div>
          <div className="agents-summary__metric">
            <span className="agents-summary__label">Active</span>
            <strong>{summary.active}</strong>
          </div>
          <div className="agents-summary__metric">
            <span className="agents-summary__label">Idle</span>
            <strong>{summary.idle}</strong>
          </div>
          <div className="agents-summary__metric">
            <span className="agents-summary__label">Offline</span>
            <strong>{summary.offline}</strong>
          </div>
          <div className="agents-summary__metric">
            <span className="agents-summary__label">Healthy</span>
            <strong>{summary.healthy}</strong>
          </div>
        </div>

        <PageSection>
          <div className="agents-toolbar">
            <div className="agents-toolbar__search">
              <label htmlFor="agent-search">Search agents</label>
              <Input
                id="agent-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search agents..."
                aria-label="Search agents"
              />
            </div>

            <div className="agents-toolbar__filters">
              <Select
                id="status-filter"
                label="Status"
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value as (typeof statusOptions)[number])}
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status === "all" ? "All statuses" : status}
                  </option>
                ))}
              </Select>

              <Select
                id="capability-filter"
                label="Capability"
                value={capabilityFilter}
                onChange={(event) => setCapabilityFilter(event.target.value)}
              >
                <option value="all">All capabilities</option>
                {capabilities.map((capability) => (
                  <option key={capability} value={capability}>
                    {capability}
                  </option>
                ))}
              </Select>

              <Select
                id="project-filter"
                label="Project"
                value={projectFilter}
                onChange={(event) => setProjectFilter(event.target.value)}
              >
                <option value="all">All projects</option>
                {projects.map((project) => (
                  <option key={project} value={project}>
                    {project}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </PageSection>

        <PageSection
          title="Agent Registry"
          description="Operational status, workload, and availability across the current workforce."
        >
          {filteredAgents.length === 0 ? (
            <AgentsEmptyState
              reason="filters"
              onClearFilters={() => {
                setQuery("");
                setStatusFilter("all");
                setCapabilityFilter("all");
                setProjectFilter("all");
              }}
            />
          ) : (
            <>
              <AgentRegistry agents={pagedAgents} />
              {filteredAgents.length > PAGE_SIZE ? (
                <div className="agents-pagination">
                  <Pagination current={page} total={totalPages} onChange={setPage} />
                </div>
              ) : null}
            </>
          )}
        </PageSection>
      </div>
    </PageContainer>
  );
}

export function AgentSummaryLine({ total, active, idle, offline }: { total: number; active: number; idle: number; offline: number }) {
  return (
    <div className="agents-inline-summary" aria-live="polite">
      {formatMetricLabel(total, "Total")} · {formatMetricLabel(active, "Active")} · {formatMetricLabel(idle, "Idle")} · {formatMetricLabel(offline, "Offline")}
    </div>
  );
}
