import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useProjects, type PlanUiState } from "../executionPlans";
import { PROJECT_PARAM, resolveProjectId, type ProjectOption } from "./projectScope";
import type { MessageKey } from "../../i18n";

/**
 * Project-list states that are failures. They must never masquerade as "no
 * projects": a 403 is a permission answer, not an empty account.
 */
const FAILURES: ReadonlySet<PlanUiState> = new Set<PlanUiState>([
  "forbidden",
  "unauthenticated",
  "not_found",
  "conflict",
  "error",
]);

const FAILURE_KEYS: Record<"forbidden" | "unauthenticated" | "other", MessageKey> = {
  forbidden: "projectScope.forbidden",
  unauthenticated: "projectScope.unauthenticated",
  other: "projectScope.loadFailed",
};

/** Operator-facing message key for a failed project-list lookup. */
export function projectScopeFailureKey(status: PlanUiState): MessageKey {
  if (status === "forbidden") return FAILURE_KEYS.forbidden;
  if (status === "unauthenticated") return FAILURE_KEYS.unauthenticated;
  return FAILURE_KEYS.other;
}

export interface ActiveProject {
  /** The resolved project, or null when the operator has none. */
  projectId: string | null;
  projects: readonly ProjectOption[];
  status: PlanUiState;
  /** True when the project list itself failed (permission/server), not merely empty. */
  failed: boolean;
  loading: boolean;
  refetch: () => void;
  select: (projectId: string) => void;
}

/**
 * Resolves the project a page should show from `?project=`, falling back to the
 * first registered project. The URL is the source of truth, so the view is
 * linkable and survives a reload.
 */
export function useActiveProject(): ActiveProject {
  const { status, projects, refetch } = useProjects();
  const [searchParams, setSearchParams] = useSearchParams();

  const projectId = resolveProjectId(searchParams.get(PROJECT_PARAM), projects);

  const select = useCallback(
    (next: string) => {
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

  return {
    projectId,
    projects,
    status,
    failed: FAILURES.has(status),
    loading: status === "loading",
    refetch: () => void refetch(),
    select,
  };
}
