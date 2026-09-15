import { describe, expect, it } from "vitest";
import type { ProjectView } from "../../../api/contracts";
import {
  collectAdapterStatuses,
  collectProjectStatuses,
  EMPTY_PROJECT_FILTERS,
  filterProjects,
  filtersActive,
  sortProjects,
  summarizeProjects,
} from "../projectsView";

const projects: ProjectView[] = [
  {
    projectId: "money-mind",
    displayName: "Money Mind",
    status: "available",
    adapterStatus: "healthy",
    capabilities: [],
    connectedAgents: ["research-agent"],
    activeWorkflows: 2,
    recentTaskIds: [],
    recentActivity: [],
  },
  {
    projectId: "aims",
    displayName: "AIMS",
    status: "degraded",
    adapterStatus: "degraded",
    capabilities: [],
    connectedAgents: [],
    activeWorkflows: 0,
    recentTaskIds: [],
    recentActivity: [],
  },
  {
    projectId: "mastery",
    displayName: "Mastery",
    status: "unavailable",
    adapterStatus: "unavailable",
    capabilities: [],
    connectedAgents: [],
    activeWorkflows: 0,
    recentTaskIds: [],
    recentActivity: [],
  },
];

describe("project registry view model", () => {
  it("filters only authoritative ProjectView identity and status fields", () => {
    expect(
      filterProjects(projects, {
        ...EMPTY_PROJECT_FILTERS,
        search: "money",
      }).map((project) => project.projectId),
    ).toEqual(["money-mind"]);
    expect(
      filterProjects(projects, {
        ...EMPTY_PROJECT_FILTERS,
        status: "degraded",
        adapterStatus: "degraded",
      }).map((project) => project.projectId),
    ).toEqual(["aims"]);
  });
  it("derives summary and filter options from the loaded registry without mutation", () => {
    expect(collectProjectStatuses(projects)).toEqual([
      "available",
      "degraded",
      "unavailable",
    ]);
    expect(collectAdapterStatuses(projects)).toEqual([
      "degraded",
      "healthy",
      "unavailable",
    ]);
    expect(summarizeProjects(projects)).toEqual({
      total: 3,
      available: 1,
      degraded: 1,
      unavailable: 1,
    });
    expect(sortProjects(projects).map((project) => project.projectId)).toEqual([
      "aims",
      "mastery",
      "money-mind",
    ]);
    expect(projects[0]?.projectId).toBe("money-mind");
  });
  it("identifies active filters", () => {
    expect(filtersActive(EMPTY_PROJECT_FILTERS)).toBe(false);
    expect(
      filtersActive({ ...EMPTY_PROJECT_FILTERS, adapterStatus: "healthy" }),
    ).toBe(true);
  });
});
