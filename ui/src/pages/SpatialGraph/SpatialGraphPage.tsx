import { useCallback, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useI18n, type MessageKey } from "../../i18n";
import { useSpatialGraph } from "../../features/spatial-graph/hooks/useSpatialGraph";
import { SpatialGraphWorkspace } from "../../features/spatial-graph/components/SpatialGraphWorkspace";
import { ProjectSelector } from "../../features/spatial-graph/components/ProjectSelector";
import { MODE_PARAM, parseMode, rootNodeFor } from "../../features/spatial-graph/lib/modes";
import { PROJECT_PARAM, resolveProjectId } from "../../features/spatial-graph/lib/projects";
import { Spinner } from "../../components/ui/Spinner";
import { ErrorState } from "../../components/ui/ErrorState";
import { EmptyState } from "../../components/ui/EmptyState";
import type { GraphMode, WorkforceGraphNode } from "../../../../contracts/graph";
import { Network } from "lucide-react";
import { useProjects, type PlanUiState } from "../../features/executionPlans";

import "./SpatialGraphPage.css";

const PROJECT_LIST_FAILURES: ReadonlySet<PlanUiState> = new Set<PlanUiState>([
  "forbidden",
  "unauthenticated",
  "not_found",
  "conflict",
  "error",
]);

function projectListErrorKey(status: PlanUiState): "projectsForbidden" | "projectsUnauthenticated" | "projectsLoadFailed" {
  if (status === "forbidden") return "projectsForbidden";
  if (status === "unauthenticated") return "projectsUnauthenticated";
  return "projectsLoadFailed";
}

export default function SpatialGraphPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { t } = useI18n();
  const { status: projectsStatus, projects, refetch: refetchProjects } = useProjects();
  const [searchParams, setSearchParams] = useSearchParams();

  // The URL is the source of truth for the mode; unknown values fall back to WORKFORCE.
  const mode = parseMode(searchParams.get(MODE_PARAM));
  // rootNodeId only applies to the mode it was chosen for (e.g. a selected agent -> AGENT).
  // It is also scoped to the project it was chosen in, so a node id from project A can never be
  // sent as the root for project B.
  const [root, setRoot] = useState<{ projectId: string; mode: GraphMode; id: string } | null>(null);

  // Project: an explicit route param wins; otherwise the validated ?project= value, else the first project.
  const activeProjectId = projectId || resolveProjectId(searchParams.get(PROJECT_PARAM), projects);
  const rootNodeId =
    root && root.mode === mode && root.projectId === activeProjectId ? root.id : undefined;
  const options = useMemo(() => ({ mode, rootNodeId }), [mode, rootNodeId]);
  const { graph, loading, error } = useSpatialGraph(activeProjectId || "", options);

  const onModeChange = useCallback(
    (next: GraphMode, selected: WorkforceGraphNode | null) => {
      const id = rootNodeFor(next, selected);
      setRoot(id && activeProjectId ? { projectId: activeProjectId, mode: next, id } : null);
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set(MODE_PARAM, next);
          return params;
        },
        { replace: false },
      );
    },
    [setSearchParams, activeProjectId],
  );

  const onProjectChange = useCallback(
    (next: string) => {
      setRoot(null);
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          params.set(PROJECT_PARAM, next);
          return params;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  if (projectsStatus === "loading" || (loading && !graph)) return <Spinner />;
  // A failed project lookup must never masquerade as "no projects": permission,
  // sign-in and server errors are reported as such. A project in the URL can
  // still be graphed, so only block when there is nothing to show.
  if (!projectId && PROJECT_LIST_FAILURES.has(projectsStatus)) {
    const key = projectListErrorKey(projectsStatus);
    return (
      <ErrorState
        title={t(`spatial.${key}` as MessageKey)}
        description={t(`spatial.${key}Desc` as MessageKey)}
        onRetry={projectsStatus === "forbidden" || projectsStatus === "unauthenticated" ? undefined : () => void refetchProjects()}
      />
    );
  }
  if (projectsStatus === "empty" || !activeProjectId)
    return <EmptyState icon={<Network />} title={t("spatial.noProjects")} description={t("spatial.noProjectsDesc")} />;
  if (error) return <ErrorState title={t("spatial.loadFailed")} description={error.message} />;
  if (!graph) return <EmptyState icon={<Network />} title={t("spatial.noGraph")} description={t("spatial.noGraphDesc")} />;

  return (
    <div className="spatial-graph-page">
      <h1 className="visually-hidden">{t("nav.spatialGraph")}</h1>
      <SpatialGraphWorkspace
        key={activeProjectId}
        projectControl={
          projectId ? null : (
            <ProjectSelector projects={projects} value={activeProjectId} onChange={onProjectChange} />
          )
        }
        graph={graph}
        mode={mode}
        busy={loading}
        onModeChange={onModeChange}
      />
    </div>
  );
}
