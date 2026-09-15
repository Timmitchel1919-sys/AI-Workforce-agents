import type { ProjectView } from "../../api/contracts";

export interface ProjectFilters {
  search: string;
  status: string;
  adapterStatus: string;
}
export const EMPTY_PROJECT_FILTERS: ProjectFilters = {
  search: "",
  status: "",
  adapterStatus: "",
};
export interface ProjectSummaryData {
  total: number;
  available: number;
  degraded: number;
  unavailable: number;
}

export function filterProjects(
  projects: readonly ProjectView[],
  filters: ProjectFilters,
): ProjectView[] {
  const search = filters.search.trim().toLocaleLowerCase();
  return projects.filter((project) => {
    const matchesSearch =
      !search ||
      [project.projectId, project.displayName].some((value) =>
        value.toLocaleLowerCase().includes(search),
      );
    return (
      matchesSearch &&
      (!filters.status || project.status === filters.status) &&
      (!filters.adapterStatus ||
        project.adapterStatus === filters.adapterStatus)
    );
  });
}
export function filtersActive(filters: ProjectFilters): boolean {
  return Boolean(filters.search || filters.status || filters.adapterStatus);
}
export function collectProjectStatuses(
  projects: readonly ProjectView[],
): string[] {
  return [...new Set(projects.map((project) => project.status))].sort();
}
export function collectAdapterStatuses(
  projects: readonly ProjectView[],
): string[] {
  return [...new Set(projects.map((project) => project.adapterStatus))].sort();
}
export function summarizeProjects(
  projects: readonly ProjectView[],
): ProjectSummaryData {
  const count = (status: string) =>
    projects.filter((project) => project.status === status).length;
  return {
    total: projects.length,
    available: count("available"),
    degraded: count("degraded"),
    unavailable: count("unavailable"),
  };
}
export function sortProjects(projects: readonly ProjectView[]): ProjectView[] {
  return [...projects].sort(
    (a, b) =>
      a.displayName.localeCompare(b.displayName) ||
      a.projectId.localeCompare(b.projectId),
  );
}
