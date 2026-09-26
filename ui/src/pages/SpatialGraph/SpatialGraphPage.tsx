import { useCallback, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useI18n } from "../../i18n";
import { useSpatialGraph } from "../../features/spatial-graph/hooks/useSpatialGraph";
import { SpatialGraphWorkspace } from "../../features/spatial-graph/components/SpatialGraphWorkspace";
import { MODE_PARAM, parseMode, rootNodeFor } from "../../features/spatial-graph/lib/modes";
import PageHeader from "../../components/layout/PageHeader";
import { Spinner } from "../../components/ui/Spinner";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";
import type { GraphMode, WorkforceGraphNode } from "../../../../contracts/graph";
import { Network } from "lucide-react";
import { useProjects } from "../../features/executionPlans";

import "./SpatialGraphPage.css";

export default function SpatialGraphPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { t } = useI18n();
  const { status: projectsStatus, projects } = useProjects();
  const [searchParams, setSearchParams] = useSearchParams();

  // The URL is the source of truth for the mode; unknown values fall back to WORKFORCE.
  const mode = parseMode(searchParams.get(MODE_PARAM));
  // rootNodeId only applies to the mode it was chosen for (e.g. a selected agent -> AGENT).
  const [root, setRoot] = useState<{ mode: GraphMode; id: string } | null>(null);
  const rootNodeId = root && root.mode === mode ? root.id : undefined;

  const activeProjectId = projectId || (projects.length > 0 ? projects[0].projectId : null);
  const options = useMemo(() => ({ mode, rootNodeId }), [mode, rootNodeId]);
  const { graph, loading, error } = useSpatialGraph(activeProjectId || "", options);

  const onModeChange = useCallback(
    (next: GraphMode, selected: WorkforceGraphNode | null) => {
      const id = rootNodeFor(next, selected);
      setRoot(id ? { mode: next, id } : null);
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set(MODE_PARAM, next);
          return params;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  if (projectsStatus === "loading" || (loading && !graph)) return <Spinner />;
  if (projectsStatus === "empty" || !activeProjectId)
    return <EmptyState icon={<Network />} title={t("spatial.noProjects")} description={t("spatial.noProjectsDesc")} />;
  if (error) return <ErrorState title={t("spatial.loadFailed")} description={error.message} />;
  if (!graph) return <EmptyState icon={<Network />} title={t("spatial.noGraph")} description={t("spatial.noGraphDesc")} />;

  return (
    <div className="spatial-graph-page">
      <PageHeader title={t("nav.spatialGraph")} description={t("spatial.description")} />
      <SpatialGraphWorkspace
        key={graph.projectId}
        graph={graph}
        mode={mode}
        busy={loading}
        onModeChange={onModeChange}
      />
    </div>
  );
}
