import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useProjects } from "../../executionPlans";
import { PROJECT_PARAM, resolveProjectId, type ProjectOption } from "../../projectScope/projectScope";

export const ALL_PROJECTS = "all";

export interface Scope {
  /** The scoped project, or undefined for "All projects". */
  projectId: string | undefined;
  projects: readonly ProjectOption[];
  loading: boolean;
  failed: boolean;
  select: (value: string) => void;
  /** `?project=...` carried by every tab/detail link so the scope survives navigation. */
  search: string;
  /** Registered display name for a project id (falls back to the id). */
  nameOf: (projectId: string) => string;
}

/** Scope = `?project=` (a registered project id, or "all"); same rules as the Security Center. */
export function useScope(): Scope {
  const { status, projects } = useProjects();
  const [params, setParams] = useSearchParams();
  const raw = params.get(PROJECT_PARAM);
  const projectId = raw === ALL_PROJECTS ? undefined : (resolveProjectId(raw, projects) ?? undefined);
  const select = useCallback(
    (value: string) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set(PROJECT_PARAM, value);
        return next;
      }, { replace: false });
    },
    [setParams],
  );
  const search = `?${PROJECT_PARAM}=${encodeURIComponent(projectId ?? ALL_PROJECTS)}`;
  const nameOf = useCallback(
    (id: string) => projects.find((p) => p.projectId === id)?.displayName || id,
    [projects],
  );
  return {
    projectId,
    projects,
    loading: status === "loading",
    failed: status === "forbidden" || status === "unauthenticated" || status === "not_found" || status === "conflict" || status === "error",
    select,
    search,
    nameOf,
  };
}
