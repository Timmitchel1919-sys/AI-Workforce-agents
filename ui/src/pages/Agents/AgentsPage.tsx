import { useMemo, useState } from "react";
import { translateStatus, useI18n } from "../../i18n";
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

/**
 * The filter spans BOTH axes, because an operator looking for "who can I hand
 * this to" is filtering on administrative status, while one looking for "what
 * is busy" is filtering on operational state. A single dropdown cannot do both
 * honestly, so both vocabularies are offered and labelled.
 */
const statusOptions = [
  "all",
  "active",
  "draft",
  "suspended",
  "disabled",
  "retired",
  "available",
  "assigned",
  "busy",
  "waiting",
  "offline",
  "error",
  "provisioning",
] as const;

export default function AgentsPage() {
  const { t } = useI18n();
  const { data, status, refetch } = useAgents();
  const agents = useMemo(() => data?.agents ?? [], [data]);
  const summary = useMemo(
    () =>
      data?.summary ?? {
        total: 0,
        active: 0,
        idle: 0,
        offline: 0,
        specialists: 0,
        acceptingWork: 0,
      },
    [data],
  );

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof statusOptions)[number]>("all");
  const [capabilityFilter, setCapabilityFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [page, setPage] = useState(1);

  const capabilities = useMemo(
    () => Array.from(new Set(agents.flatMap((agent) => agent.capabilities))).sort(),
    [agents],
  );

  // Agents report an allow-list of projects, not a single owning project, so the
  // filter matches membership rather than equality.
  const projects = useMemo(() => {
    const ids = new Set<string>();
    for (const agent of agents) {
      for (const project of agent.allowedProjects) ids.add(project);
      if (agent.currentProjectId) ids.add(agent.currentProjectId);
      for (const project of agent.specialist?.projectPolicy.projects ?? []) ids.add(project);
    }
    return Array.from(ids).sort();
  }, [agents]);

  const filteredAgents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return agents.filter((agent) => {
      const searchable = [
        agent.name,
        agent.description,
        agent.id,
        agent.specialist?.modelPolicy.model,
        agent.specialist?.modelPolicy.provider,
        agent.specialist?.department,
        agent.specialist?.riskCeiling,
        ...agent.capabilities,
      ];

      const matchesQuery =
        normalizedQuery.length === 0 ||
        searchable
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery));

      const matchesStatus =
        statusFilter === "all" ||
        agent.status === statusFilter ||
        agent.specialist?.operationalState === statusFilter;
      const matchesCapability = capabilityFilter === "all" || agent.capabilities.includes(capabilityFilter);
      const matchesProject =
        projectFilter === "all" ||
        agent.allowedProjects.includes(projectFilter) ||
        agent.specialist?.projectPolicy.projects.includes(projectFilter) === true;

      return matchesQuery && matchesStatus && matchesCapability && matchesProject;
    });
  }, [agents, capabilityFilter, projectFilter, query, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredAgents.length / PAGE_SIZE));
  const pagedAgents = filteredAgents.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  if (status === "loading") {
    return (
      <PageContainer>
        <PageHeader
          eyebrow={t("common.brand")}
          title={t("agents.title")}
          description={t("agents.description")}
        />
        <AgentsLoadingState />
      </PageContainer>
    );
  }

  if (status === "error" || status === "unauthorized" || status === "degraded" || status === "notComposed" || status === "notConfigured") {
    // No roster is rendered for any of these. A failure to answer is not an
    // answer, and substituting a sample registry here is what previously made
    // a broken deployment look like a healthy one.
    return (
      <PageContainer>
        <PageHeader
          eyebrow={t("common.brand")}
          title={t("agents.title")}
          description={t("agents.description")}
        />
        <AgentsErrorState state={status} onRetry={refetch} />
      </PageContainer>
    );
  }

  if (status === "empty") {
    return (
      <PageContainer>
        <PageHeader
          eyebrow={t("common.brand")}
          title={t("agents.title")}
          description={t("agents.description")}
        />
        <AgentsEmptyState sampleData={data?.authoritative === false} />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow={t("common.brand")}
        title={t("agents.title")}
        description={t("agents.description")}
      />

      <div className="agents-page">
        <div className="agents-summary" aria-label={t("agents.summary")}>
          <div className="agents-summary__metric">
            <span className="agents-summary__label">{t("agents.total")}</span>
            <strong>{summary.total}</strong>
          </div>
          <div className="agents-summary__metric">
            <span className="agents-summary__label">{t("status.active")}</span>
            <strong>{summary.active}</strong>
          </div>
          <div className="agents-summary__metric">
            <span className="agents-summary__label">{t("status.idle")}</span>
            <strong>{summary.idle}</strong>
          </div>
          <div className="agents-summary__metric">
            <span className="agents-summary__label">{t("status.offline")}</span>
            <strong>{summary.offline}</strong>
          </div>
          <div className="agents-summary__metric">
            <span className="agents-summary__label">{t("agents.specialists")}</span>
            <strong>{summary.specialists}</strong>
          </div>
          <div className="agents-summary__metric">
            <span className="agents-summary__label">{t("agents.acceptingWork")}</span>
            <strong>{summary.acceptingWork}</strong>
          </div>
        </div>

        <p className="agents-qualification-note">{t("agents.qualifiedNoticeDescription")}</p>

        <PageSection>
          <div className="agents-toolbar">
            <div className="agents-toolbar__search">
              <label htmlFor="agent-search">{t("agents.search")}</label>
              <Input
                id="agent-search"
                type="search"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
                placeholder={t("agents.searchPlaceholder")}
                aria-label={t("agents.search")}
              />
            </div>

            <div className="agents-toolbar__filters">
              <Select
                id="status-filter"
                label={t("common.status")}
                value={statusFilter}
                onChange={(event) => {
                  setStatusFilter(event.target.value as (typeof statusOptions)[number]);
                  setPage(1);
                }}
              >
                {statusOptions.map((status) => (
                  <option key={status} value={status}>
                    {status === "all" ? t("common.allStatuses") : translateStatus(t, status)}
                  </option>
                ))}
              </Select>

              <Select
                id="capability-filter"
                label={t("agents.capability")}
                value={capabilityFilter}
                onChange={(event) => {
                  setCapabilityFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">{t("agents.allCapabilities")}</option>
                {capabilities.map((capability) => (
                  <option key={capability} value={capability}>
                    {capability}
                  </option>
                ))}
              </Select>

              <Select
                id="project-filter"
                label={t("common.project")}
                value={projectFilter}
                onChange={(event) => {
                  setProjectFilter(event.target.value);
                  setPage(1);
                }}
              >
                <option value="all">{t("common.allProjects")}</option>
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
          title={t("agents.registry")}
          description={t("agents.registryDescription")}
        >
          {filteredAgents.length === 0 ? (
            <AgentsEmptyState
              reason="filters"
              onClearFilters={() => {
                setQuery("");
                setStatusFilter("all");
                setCapabilityFilter("all");
                setProjectFilter("all");
                setPage(1);
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
