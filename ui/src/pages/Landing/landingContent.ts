/**
 * Static presentation content for the landing page.
 *
 * Nothing here is live telemetry. Statuses reflect the implementation state of
 * the repository and must be updated when that state changes:
 * - environments → `api/production-workforce-config.ts`
 *   (`PRODUCTION_ENVIRONMENT_DESCRIPTORS`) and `docs/environment-discovery.md`
 * - agents → `api/production-workforce-config.ts` (production bindings) and
 *   `agents/` (implemented General Agents)
 */

export type EnvironmentStatus = "available" | "registered" | "planned" | "unavailable";

export type AgentStatus = "registered" | "implemented" | "planned";

export const statusLabels: Record<EnvironmentStatus | AgentStatus, string> = {
  available: "Available",
  registered: "Registered",
  implemented: "Implemented",
  planned: "Planned",
  unavailable: "Unavailable",
};

export const navLinks = [
  { id: "system", label: "System" },
  { id: "capabilities", label: "Capabilities" },
  { id: "architecture", label: "Architecture" },
  { id: "security", label: "Security" },
] as const;

export const controlPlaneBranches = [
  { top: "Architect", bottom: "Security" },
  { top: "Develop", bottom: "Deploy" },
  { top: "Test", bottom: "Audit" },
] as const;

export const coreModules = [
  "Project Architect",
  "Technology Selector",
  "Agent Router",
  "Model Router",
  "Environment Router",
  "Build Orchestrator",
  "Security",
  "AI Auditor",
] as const;

export type EnvironmentIconId =
  | "code"
  | "monitor"
  | "hammer"
  | "smartphone"
  | "container"
  | "cloud"
  | "box"
  | "gamepad";

export interface EnvironmentCard {
  name: string;
  description: string;
  icon: EnvironmentIconId;
  status: EnvironmentStatus;
}

/**
 * No real platform probe ships yet, so nothing is `available`. `registered`
 * means a support descriptor exists in the production catalog — it says the
 * workforce *can* support the type, not that any host has it installed.
 */
export const environments: EnvironmentCard[] = [
  {
    name: "VS Code",
    description: "Editor-driven development and CLI builds on developer workstations.",
    icon: "code",
    status: "planned",
  },
  {
    name: "Visual Studio",
    description: ".NET and C++ solutions, detected through a restricted vswhere probe.",
    icon: "monitor",
    status: "planned",
  },
  {
    name: "Xcode",
    description: "Apple platform builds on dedicated macOS build hosts.",
    icon: "hammer",
    status: "registered",
  },
  {
    name: "Android Studio",
    description: "Android SDK builds and emulator-backed verification.",
    icon: "smartphone",
    status: "planned",
  },
  {
    name: "Docker",
    description: "Isolated container runtimes for reproducible builds and tests.",
    icon: "container",
    status: "registered",
  },
  {
    name: "Cloud Runners",
    description: "Ephemeral cloud hosts with cost-center attribution.",
    icon: "cloud",
    status: "planned",
  },
  {
    name: "Unity",
    description: "Real-time 3D projects and editor-driven build pipelines.",
    icon: "box",
    status: "planned",
  },
  {
    name: "Unreal Engine",
    description: "High-fidelity engine builds on capable GPU hosts.",
    icon: "gamepad",
    status: "planned",
  },
];

export interface AgentDepartment {
  name: string;
  role: string;
  capability: string;
  status: AgentStatus;
  code: string;
}

export const agentDepartments: AgentDepartment[] = [
  {
    name: "Control Plane Analysis",
    role: "Operational analyst",
    capability: "Reads Control Plane state and explains workforce health.",
    status: "registered",
    code: "CPA",
  },
  {
    name: "Software Engineering",
    role: "Developer agent",
    capability: "Plans and produces code changes through governed tools.",
    status: "implemented",
    code: "DEV",
  },
  {
    name: "Project Management",
    role: "Project manager agent",
    capability: "Breaks requests into tasks, dependencies, and handoffs.",
    status: "implemented",
    code: "PM",
  },
  {
    name: "Test & QA",
    role: "QA agent",
    capability: "Designs and evaluates verification for delivered work.",
    status: "implemented",
    code: "QA",
  },
  {
    name: "Research",
    role: "Research agent",
    capability: "Gathers and summarises context before work begins.",
    status: "implemented",
    code: "RES",
  },
  {
    name: "UI / UX",
    role: "Interface agent",
    capability: "Interface structure, accessibility, and design-system use.",
    status: "planned",
    code: "UX",
  },
  {
    name: "Security",
    role: "Security agent",
    capability: "Reviews changes for vulnerabilities and secret exposure.",
    status: "planned",
    code: "SEC",
  },
  {
    name: "Deployment",
    role: "Release agent",
    capability: "Promotes verified builds behind approval gates.",
    status: "planned",
    code: "OPS",
  },
  {
    name: "AI Cost Center",
    role: "Cost governance",
    capability: "Attributes model and compute spend per project.",
    status: "planned",
    code: "FIN",
  },
  {
    name: "AI Auditor",
    role: "Independent review",
    capability: "Audits agent decisions against policy and evidence.",
    status: "planned",
    code: "AUD",
  },
];

export const pipelineSteps = [
  "Project Request",
  "Task Analyzer",
  "Project Architect",
  "Technology Selector",
  "Environment Router",
  "Agent Qualification",
  "Model Router",
  "Execution",
  "Build",
  "Test / Security",
  "Deploy",
] as const;

export const governanceItems = [
  {
    title: "Approval Gates",
    body: "High-impact actions pause until a human operator approves them.",
  },
  {
    title: "Audit Trail",
    body: "Every command is recorded with actor, correlation id, and outcome.",
  },
  {
    title: "Agent Permissions",
    body: "Deny-by-default grants, enforced at the dispatch boundary.",
  },
  {
    title: "Security Controls",
    body: "Restricted, allowlisted execution — no arbitrary shell access.",
  },
  {
    title: "AI Cost Center",
    body: "Cost attribution per project, host, and model (planned).",
  },
  {
    title: "Human Oversight",
    body: "Operators can pause, resume, or cancel work at any time.",
  },
] as const;

export const securityItems = [
  { title: "Zero Trust", body: "No request is trusted by default; every call is authenticated." },
  { title: "Least Privilege", body: "Agents receive only the permissions their task requires." },
  { title: "Agent Isolation", body: "Project-isolated context keeps workloads apart." },
  { title: "Approval Gates", body: "Risky operations require explicit human approval." },
  { title: "Auditability", body: "A structured, append-only audit log for every action." },
  { title: "Secret Protection", body: "Registries never accept credentials; errors are redacted." },
] as const;
