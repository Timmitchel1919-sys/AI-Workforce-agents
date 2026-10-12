import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../../components/ui";
import { useCandidates, useCanManage, useKnowledgeCommand, useMemories, useOverview } from "../hooks/useKnowledge";
import { groupByType } from "../lib/logic";
import { useT } from "../lib/useT";
import { EMPTY_FILTERS, type CommandResult, type ProjectRunSummary } from "../types";
import { ContextPreview } from "./ContextPreview";
import { Empty, ErrorPanel, NeedsProject, Notice, Skeleton } from "./common";
import { MemoryRow } from "./MemoryRow";
import { HealthCards } from "./OverviewTab";

const ACTIVE_FILTERS = { ...EMPTY_FILTERS, status: "ACTIVE" };

function RunSummary({ result }: { result: CommandResult }) {
  const { tt } = useT();
  const d = result.details as unknown as Partial<ProjectRunSummary>;
  const unavailable = Array.isArray(d.unavailable) ? d.unavailable : [];
  return (
    <Notice tone="success" title={tt("projectKnowledge.resultTitle")}>
      <ul className="kn-list" data-testid="project-run-summary">
        <li>{tt("projectKnowledge.resultSource", { source: String(d.source ?? "-") })}</li>
        <li>{tt("projectKnowledge.resultCounts", { topics: d.topics ?? 0, documents: d.documents ?? 0, unchanged: d.unchanged ?? 0 })}</li>
        <li>{tt("projectKnowledge.resultStale", { stale: d.staleMarked ?? 0, conflicts: d.conflicts ?? 0 })}</li>
        {d.truncated ? <li>{tt("projectKnowledge.resultTruncated")}</li> : null}
        {unavailable.length > 0 ? <li>{tt("projectKnowledge.resultUnavailable", { list: unavailable.join(", ") })}</li> : null}
      </ul>
    </Notice>
  );
}

export function ProjectTab({ projectId, search }: { projectId: string | undefined; search: string }) {
  const { tt } = useT();
  const canManage = useCanManage();
  const overview = useOverview(projectId);
  const candidates = useCandidates(projectId);
  const active = useMemories(projectId, ACTIVE_FILTERS);
  const run = useKnowledgeCommand();
  const decide = useKnowledgeCommand();

  if (!projectId) return <NeedsProject />;
  const groups = groupByType(active.data?.memories ?? []);

  return (
    <div className="kn-stack">
      <section className="kn-panel" aria-labelledby="kn-pk-health">
        <h2 id="kn-pk-health" className="kn-panel__title">{tt("projectKnowledge.healthTitle")}</h2>
        {overview.error ? <ErrorPanel error={overview.error} onRetry={() => void overview.refetch()} /> : null}
        {overview.isLoading ? <Skeleton label={tt("overview.loading")} /> : null}
        {overview.data ? <HealthCards health={overview.data.health} /> : null}
        {canManage ? (
          <div className="kn-actions">
            <Button type="button" variant="primary" loading={run.isPending} onClick={() => run.mutate({ command: "knowledge_discover_project", body: { projectId } })}>
              {tt("projectKnowledge.discover")}
            </Button>
            <Button type="button" variant="secondary" loading={run.isPending} onClick={() => run.mutate({ command: "knowledge_refresh_project", body: { projectId } })}>
              {tt("projectKnowledge.refresh")}
            </Button>
          </div>
        ) : <p className="kn-muted">{tt("common.readOnly")}</p>}
        {run.error ? <ErrorPanel error={run.error} /> : null}
        {run.data ? <RunSummary result={run.data} /> : null}
      </section>

      <section className="kn-panel" aria-labelledby="kn-pk-candidates">
        <h2 id="kn-pk-candidates" className="kn-panel__title">{tt("projectKnowledge.candidatesTitle")}</h2>
        <p className="kn-muted">{tt("projectKnowledge.candidatesHelp")}</p>
        {candidates.error ? <ErrorPanel error={candidates.error} onRetry={() => void candidates.refetch()} /> : null}
        {decide.error ? <ErrorPanel error={decide.error} /> : null}
        {candidates.isLoading ? <Skeleton label={tt("common.loading")} /> : null}
        {candidates.data && candidates.data.length === 0 ? <Empty title={tt("projectKnowledge.candidatesEmpty")} /> : null}
        {candidates.data && candidates.data.length > 0 ? (
          <ul className="kn-rows" aria-label={tt("projectKnowledge.candidatesTitle")}>
            {candidates.data.map((memory) => (
              <MemoryRow
                key={memory.memoryId}
                memory={memory}
                search={search}
                actions={canManage ? (
                  <>
                    <Button type="button" variant="primary" size="small" disabled={decide.isPending} onClick={() => decide.mutate({ command: "knowledge_confirm_memory", body: { memoryId: memory.memoryId } })}>
                      {tt("actions.confirm")}
                    </Button>
                    <Button type="button" variant="secondary" size="small" disabled={decide.isPending} onClick={() => decide.mutate({ command: "knowledge_archive_memory", body: { memoryId: memory.memoryId } })}>
                      {tt("actions.archive")}
                    </Button>
                  </>
                ) : null}
              />
            ))}
          </ul>
        ) : null}
      </section>

      <section className="kn-panel" aria-labelledby="kn-pk-key">
        <h2 id="kn-pk-key" className="kn-panel__title">{tt("projectKnowledge.keyTitle")}</h2>
        {active.error ? <ErrorPanel error={active.error} onRetry={() => void active.refetch()} /> : null}
        {active.isLoading ? <Skeleton label={tt("common.loading")} /> : null}
        {active.data && groups.length === 0 ? <Empty title={tt("projectKnowledge.keyEmpty")} body={tt("projectKnowledge.keyEmptyBody")} /> : null}
        {groups.map(([type, memories]) => (
          <GroupBlock key={type} type={type} count={memories.length}>
            <ul className="kn-rows">
              {memories.map((memory) => <MemoryRow key={memory.memoryId} memory={memory} search={search} />)}
            </ul>
          </GroupBlock>
        ))}
        <p className="kn-muted"><Link className="kn-link" to={`/knowledge/memories${search}`}>{tt("projectKnowledge.allMemories")}</Link></p>
      </section>

      <ContextPreview projectId={projectId} />
    </div>
  );
}

function GroupBlock({ type, count, children }: { type: string; count: number; children: ReactNode }) {
  const { label } = useT();
  return (
    <section className="kn-sub" aria-label={label("type", type)}>
      <h3 className="kn-sub__title">{label("type", type)} ({count})</h3>
      {children}
    </section>
  );
}
