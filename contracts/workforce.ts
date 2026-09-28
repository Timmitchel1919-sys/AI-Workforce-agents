import { Agent } from "./index.js";

export type AgentLifecycleStatus =
  "provisioning" | "idle" | "running" | "suspended" | "errored" | "terminated";

export interface AgentDescriptor extends Agent {
  role: string;
  department: string;
  avatarUrl?: string;
  costPerHour?: number;
}

export interface AgentInstance {
  id: string;
  descriptorId: string;
  status: AgentLifecycleStatus;
  projectId?: string;
  currentTaskId?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface SpecialistTask {
  objective: string;
  context: string[];
  instructions: string;
  acceptanceCriteria: string[];
}

export interface SpecialistResult {
  taskId: string;
  agentId: string;
  summary: string;
  output: Record<string, unknown>;
  createdAt: string;
}

export function validateSpecialistTask(raw: unknown): SpecialistTask {
  if (typeof raw !== "object" || raw === null)
    throw new Error("task must be an object");
  const t = raw as Record<string, unknown>;
  if (typeof t.objective !== "string")
    throw new Error("objective must be a string");
  return {
    objective: t.objective,
    context: Array.isArray(t.context) ? t.context.map(String) : [],
    instructions: typeof t.instructions === "string" ? t.instructions : "",
    acceptanceCriteria: Array.isArray(t.acceptanceCriteria)
      ? t.acceptanceCriteria.map(String)
      : [],
  };
}

export function validateSpecialistResult(
  raw: unknown,
): asserts raw is SpecialistResult {
  if (typeof raw !== "object" || raw === null)
    throw new Error("result must be an object");
  const r = raw as Record<string, unknown>;
  if (typeof r.taskId !== "string") throw new Error("taskId is required");
  if (typeof r.summary !== "string") throw new Error("summary is required");
}

// V1 Specialist Workforce Descriptors
export const V1_SPECIALIST_WORKFORCE: AgentDescriptor[] = [
  {
    id: "pm-v1",
    name: "Project Manager",
    role: "PM",
    department: "Management",
    description: "Oversees project execution and coordinates tasks.",
    capabilities: ["project-management", "coordination"],
    allowedTools: [],
    allowedProjects: ["money-mind"],
    supportedTaskTypes: ["planning", "coordination"],
    permissions: [],
  },
  {
    id: "architect-v1",
    name: "System Architect",
    role: "Architect",
    department: "Engineering",
    description: "Designs system architecture and technical specs.",
    capabilities: ["architecture", "design"],
    allowedTools: [],
    allowedProjects: ["money-mind"],
    supportedTaskTypes: ["design", "architecture"],
    permissions: [],
  },
  {
    id: "tech-selector-v1",
    name: "Tech Selector",
    role: "Tech Selector",
    department: "Engineering",
    description: "Selects appropriate technologies for tasks.",
    capabilities: ["tech-selection"],
    allowedTools: [],
    allowedProjects: ["money-mind"],
    supportedTaskTypes: ["research", "selection"],
    permissions: [],
  },
  {
    id: "software-dev-v1",
    name: "Software Developer",
    role: "Software Dev",
    department: "Engineering",
    description: "Writes general purpose software.",
    capabilities: ["coding", "debugging"],
    allowedTools: [],
    allowedProjects: ["money-mind"],
    supportedTaskTypes: ["implementation", "bugfix"],
    permissions: [],
  },
  {
    id: "frontend-dev-v1",
    name: "Frontend Developer",
    role: "Frontend",
    department: "Engineering",
    description: "Specializes in UI and frontend frameworks.",
    capabilities: ["frontend", "ui-development"],
    allowedTools: [],
    allowedProjects: ["money-mind"],
    supportedTaskTypes: ["frontend-implementation"],
    permissions: [],
  },
  {
    id: "backend-dev-v1",
    name: "Backend Developer",
    role: "Backend",
    department: "Engineering",
    description: "Specializes in API and server development.",
    capabilities: ["backend", "api-development"],
    allowedTools: [],
    allowedProjects: ["money-mind"],
    supportedTaskTypes: ["backend-implementation"],
    permissions: [],
  },
  {
    id: "ui-designer-v1",
    name: "UI Designer",
    role: "UI Designer",
    department: "Design",
    description: "Designs user interfaces.",
    capabilities: ["ui-design"],
    allowedTools: [],
    allowedProjects: ["money-mind"],
    supportedTaskTypes: ["design"],
    permissions: [],
  },
  {
    id: "reviewer-v1",
    name: "Code Reviewer",
    role: "Reviewer",
    department: "Engineering",
    description: "Reviews code for quality and standards.",
    capabilities: ["code-review"],
    allowedTools: [],
    allowedProjects: ["money-mind"],
    supportedTaskTypes: ["review"],
    permissions: [],
  },
  {
    id: "qa-v1",
    name: "QA Engineer",
    role: "QA",
    department: "Quality",
    description: "Tests software to ensure quality.",
    capabilities: ["testing"],
    allowedTools: [],
    allowedProjects: ["money-mind"],
    supportedTaskTypes: ["testing"],
    permissions: [],
  },
  {
    id: "security-v1",
    name: "Security Specialist",
    role: "Security",
    department: "Security",
    description: "Ensures software security and compliance.",
    capabilities: ["security-audit"],
    allowedTools: [],
    allowedProjects: ["money-mind"],
    supportedTaskTypes: ["audit"],
    permissions: [],
  },
  {
    id: "github-v1",
    name: "GitHub Specialist",
    role: "GitHub",
    department: "DevOps",
    description: "Manages repositories and CI/CD.",
    capabilities: ["git", "ci-cd"],
    allowedTools: [],
    allowedProjects: ["money-mind"],
    supportedTaskTypes: ["devops"],
    permissions: [],
  },
  {
    id: "firebase-v1",
    name: "Firebase Specialist",
    role: "Firebase",
    department: "DevOps",
    description: "Manages Firebase deployment and services.",
    capabilities: ["firebase"],
    allowedTools: [],
    allowedProjects: ["money-mind"],
    supportedTaskTypes: ["deployment", "infrastructure"],
    permissions: [],
  },
];
