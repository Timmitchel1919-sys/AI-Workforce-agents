import type { AgentListItem, AgentsSnapshot } from "./agentsTypes";

const developmentAgents: AgentListItem[] = [
  {
    id: "research-agent",
    name: "Research Agent",
    description: "Investigates market signals, monitors research topics, and synthesizes findings for planning workflows.",
    status: "active",
    model: "GPT-4.1",
    capabilities: ["Research", "Web Search", "Document Processing"],
    activeTasks: 6,
    health: "healthy",
    projectId: "research-ops",
    updatedAt: "2026-09-10T14:42:00Z",
    recentExecutions: [
      {
        id: "exec-101",
        name: "Market briefing",
        status: "completed",
        startedAt: "2026-09-10T14:10:00Z",
        duration: "14 min",
        task: "Competitive scan",
        result: "Succeeded",
      },
      {
        id: "exec-102",
        name: "Trend review",
        status: "running",
        startedAt: "2026-09-10T14:30:00Z",
        duration: "3 min",
        task: "Topic summarization",
        result: "In progress",
      },
    ],
  },
  {
    id: "finance-agent",
    name: "Finance Agent",
    description: "Tracks spend, reviews budget variance, and highlights operational anomalies for finance reporting.",
    status: "idle",
    model: "Claude 3.7",
    capabilities: ["Data Analysis", "Forecasting", "Reporting"],
    activeTasks: 2,
    health: "healthy",
    projectId: "finance",
    updatedAt: "2026-09-10T13:18:00Z",
  },
  {
    id: "ops-coordinator",
    name: "Ops Coordinator",
    description: "Coordinates execution routing, escalations, and operational status updates across the workforce.",
    status: "active",
    model: "GPT-4o",
    capabilities: ["Workflow Orchestration", "Escalation", "Monitoring"],
    activeTasks: 4,
    health: "degraded",
    projectId: "operations",
    updatedAt: "2026-09-10T12:58:00Z",
  },
  {
    id: "data-pipeline-agent",
    name: "Data Pipeline Agent",
    description: "Maintains extraction, transformation, and delivery flows for workspace data and downstream reporting.",
    status: "offline",
    model: "Llama 3.1",
    capabilities: ["ETL", "Data Quality", "Pipelines"],
    activeTasks: 0,
    health: "unavailable",
    projectId: "data-platform",
    updatedAt: "2026-09-10T11:05:00Z",
  },
];

export function getDevelopmentAgentsFallback(): AgentsSnapshot {
  const summary = {
    total: developmentAgents.length,
    active: developmentAgents.filter((agent) => agent.status === "active").length,
    idle: developmentAgents.filter((agent) => agent.status === "idle").length,
    offline: developmentAgents.filter((agent) => agent.status === "offline").length,
    healthy: developmentAgents.filter((agent) => agent.health === "healthy").length,
  };

  return {
    agents: developmentAgents,
    summary,
  };
}
