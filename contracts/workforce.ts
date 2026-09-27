import { Agent } from "./index.js";

export type AgentLifecycleStatus = 
  | "provisioning"
  | "idle"
  | "running"
  | "suspended"
  | "errored"
  | "terminated";

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

// V1 Specialist Workforce Descriptors
export const V1_SPECIALIST_WORKFORCE: AgentDescriptor[] = [
  {
    id: "pm-v1",
    name: "Project Manager",
    role: "PM",
    department: "Management",
    description: "Oversees project execution and coordinates tasks.",
    capabilities: ["project-management", "coordination"],
    allowedTools: ["jira", "confluence"],
    allowedProjects: ["*"],
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
    allowedTools: ["drawio", "confluence"],
    allowedProjects: ["*"],
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
    allowedTools: ["npm", "github"],
    allowedProjects: ["*"],
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
    allowedTools: ["vscode", "github", "npm"],
    allowedProjects: ["*"],
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
    allowedTools: ["vscode", "github", "npm"],
    allowedProjects: ["*"],
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
    allowedTools: ["vscode", "github", "npm"],
    allowedProjects: ["*"],
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
    allowedTools: ["figma"],
    allowedProjects: ["*"],
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
    allowedTools: ["github"],
    allowedProjects: ["*"],
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
    allowedTools: ["jest", "cypress"],
    allowedProjects: ["*"],
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
    allowedTools: ["sonar", "github"],
    allowedProjects: ["*"],
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
    allowedTools: ["github"],
    allowedProjects: ["*"],
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
    allowedTools: ["firebase-cli"],
    allowedProjects: ["*"],
    supportedTaskTypes: ["deployment", "infrastructure"],
    permissions: [],
  }
];
