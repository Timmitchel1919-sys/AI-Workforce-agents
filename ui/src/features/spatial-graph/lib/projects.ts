export const PROJECT_PARAM = "project";

export interface ProjectOption {
  projectId: string;
  displayName: string;
}

/**
 * The URL value is only trusted when it names a real registered project; anything else
 * (unknown, stale, hand-edited) resolves to the first project, or null when there are none.
 */
export function resolveProjectId(param: string | null | undefined, projects: readonly ProjectOption[]): string | null {
  if (projects.length === 0) return null;
  if (param && projects.some((p) => p.projectId === param)) return param;
  return projects[0].projectId;
}
