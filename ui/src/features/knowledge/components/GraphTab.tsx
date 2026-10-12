import { useGraph } from "../hooks/useKnowledge";
import { useT } from "../lib/useT";
import { Empty, ErrorPanel, NeedsProject, Skeleton } from "./common";
import { GraphExplorer } from "./GraphExplorer";

export function GraphTab({ projectId }: { projectId: string | undefined }) {
  const { tt } = useT();
  const query = useGraph(projectId, []);
  if (!projectId) return <NeedsProject />;
  if (query.error) return <ErrorPanel error={query.error} onRetry={() => void query.refetch()} />;
  if (query.isLoading || !query.data) return <Skeleton label={tt("graph.loading")} />;
  if (query.data.nodes.length === 0) return <Empty title={tt("graph.emptyTitle")} body={tt("graph.emptyBody")} />;
  // Keyed by project so a different project starts with a fresh view, selection and filters.
  return (
    <section className="kn-panel" aria-labelledby="kn-graph-heading">
      <h2 id="kn-graph-heading" className="kn-panel__title">{tt("graph.title")}</h2>
      <GraphExplorer key={query.data.projectId} graph={query.data} />
    </section>
  );
}
