export const queryKeys = {
  all: ["workforce"] as const,

  dashboard: () => [...queryKeys.all, "dashboard"] as const,

  agents: () => [...queryKeys.all, "agents"] as const,

  tasks: () => [...queryKeys.all, "tasks"] as const,

  workflows: () => [...queryKeys.all, "workflows"] as const,

  approvals: () => [...queryKeys.all, "approvals"] as const,

  projects: () => [...queryKeys.all, "projects"] as const,

  audit: () => [...queryKeys.all, "audit"] as const,

  tools: () => [...queryKeys.all, "tools"] as const,

  health: () => [...queryKeys.all, "health"] as const,
};