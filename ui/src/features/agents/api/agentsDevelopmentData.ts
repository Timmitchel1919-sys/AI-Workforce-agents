/**
 * SAMPLE agent data for local UI work only.
 *
 * This is NOT a fallback. Nothing in the app returns it automatically: the
 * client raises a distinct, visible state instead whenever the Control Plane
 * cannot answer, because "we do not know" and "here are twelve agents" are
 * different facts and only one of them is true.
 *
 * `getSampleAgentsSnapshot()` marks its result `authoritative: false` so a
 * consumer cannot present it as a real roster by accident. These entries are
 * also shaped to match the real `AgentView` — including a legacy flat agent
 * with NO `specialist` block — so the two-render paths are exercised locally.
 */
import type { AgentListItem, AgentsSnapshot } from "./agentsTypes";

const developmentAgents: AgentListItem[] = [
  {
    id: "research-agent",
    name: "Research Agent",
    description:
      "Investigates market signals, monitors research topics, and synthesizes findings for planning workflows.",
    status: "active",
    capabilities: ["research"],
    enabled: true,
    allowedProjects: ["research-ops"],
    lastActivityAt: "2026-09-10T14:30:00Z",
    taskCount: 6,
    completed: 4,
    failed: 1,
    // No `specialist` block: a legacy flat agent with no qualification profile,
    // policies or limitations. Rendered as such, not as "an agent with none".
  },
  {
    id: "backend-dev-v1",
    name: "Backend Engineer",
    description:
      "API implementation, domain services, persistence, authorization, integrations, background processing and backend testing.",
    status: "offline",
    capabilities: ["software.backend"],
    enabled: true,
    allowedProjects: ["money-mind"],
    lastActivityAt: "2026-09-10T11:05:00Z",
    taskCount: 0,
    completed: 0,
    failed: 0,
    specialist: {
      descriptorVersion: 1,
      displayName: "Backend Engineer",
      department: "Engineering",
      description:
        "API implementation, domain services, persistence, authorization, integrations, background processing and backend testing.",
      limitations: [
        "Backend code capability does not grant production deployment authority.",
        "No source-control push authority; a change set is reviewed before it lands.",
        "Cannot approve its own authorization changes.",
      ],
      administrativeStatus: "active",
      // Offline: no instance exists. An agent with no instance is not "idle".
      operationalState: "offline",
      supportedTaskTypes: ["backend_implementation", "implementation"],
      projectPolicy: { mode: "allow_list", projects: ["money-mind"] },
      toolPolicy: {
        maxExecutionCapabilities: [
          "filesystem.read",
          "filesystem.write.workspace",
          "repository.read",
          "repository.write",
        ],
        deniedExecutionCapabilities: ["process.invoke.bounded"],
        allowsUnrestrictedShell: false,
      },
      riskCeiling: "high",
      reviewPolicy: {
        requiresIndependentReview: true,
        minimumReviewers: 1,
        selfReviewAllowed: false,
      },
      modelPolicy: { provider: "openai" },
      instanceCount: 0,
    },
  },
];

export function getDevelopmentAgentsFallback(): AgentsSnapshot {
  const summary = {
    total: developmentAgents.length,
    active: developmentAgents.filter((agent) => agent.status === "active").length,
    idle: developmentAgents.filter((agent) => agent.status === "idle").length,
    offline: developmentAgents.filter((agent) => agent.status === "offline").length,
    specialists: developmentAgents.filter((agent) => agent.specialist).length,
    acceptingWork: developmentAgents.filter((agent) => agent.enabled).length,
  };

  return {
    agents: developmentAgents,
    summary,
    authoritative: false,
    source: "development-sample",
  };
}
