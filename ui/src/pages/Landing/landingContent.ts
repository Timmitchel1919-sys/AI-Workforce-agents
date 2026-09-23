import type { MessageKey } from "../../i18n";

/**
 * Static presentation content for the landing page. Copy lives in the locale
 * catalogues (`landing.*`); this file owns structure and implementation status.
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

export const navLinks: ReadonlyArray<{ id: string; labelKey: MessageKey }> = [
  { id: "system", labelKey: "landing.nav.system" },
  { id: "capabilities", labelKey: "landing.nav.capabilities" },
  { id: "architecture", labelKey: "landing.nav.architecture" },
  { id: "security", labelKey: "landing.nav.security" },
];

export const controlPlaneBranches: ReadonlyArray<{ top: MessageKey; bottom: MessageKey }> = [
  { top: "landing.system.branches.architect", bottom: "landing.system.branches.security" },
  { top: "landing.system.branches.develop", bottom: "landing.system.branches.deploy" },
  { top: "landing.system.branches.test", bottom: "landing.system.branches.audit" },
];

export const coreModules: readonly MessageKey[] = [
  "landing.system.modules.projectArchitect",
  "landing.system.modules.technologySelector",
  "landing.system.modules.agentRouter",
  "landing.system.modules.modelRouter",
  "landing.system.modules.environmentRouter",
  "landing.system.modules.buildOrchestrator",
  "landing.system.modules.security",
  "landing.system.modules.aiAuditor",
];

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
  id: string;
  /** Product names are not translated; `nameKey` is used only for generic names. */
  name: string;
  nameKey?: MessageKey;
  descriptionKey: MessageKey;
  icon: EnvironmentIconId;
  status: EnvironmentStatus;
}

/**
 * No real platform probe ships yet, so nothing is `available`. `registered`
 * means a support descriptor exists in the production catalog — it says the
 * workforce *can* support the type, not that any host has it installed.
 */
export const environments: EnvironmentCard[] = [
  { id: "vscode", name: "VS Code", descriptionKey: "landing.env.descriptions.vscode", icon: "code", status: "planned" },
  { id: "visual-studio", name: "Visual Studio", descriptionKey: "landing.env.descriptions.visualStudio", icon: "monitor", status: "planned" },
  { id: "xcode", name: "Xcode", descriptionKey: "landing.env.descriptions.xcode", icon: "hammer", status: "registered" },
  { id: "android-studio", name: "Android Studio", descriptionKey: "landing.env.descriptions.androidStudio", icon: "smartphone", status: "planned" },
  { id: "docker", name: "Docker", descriptionKey: "landing.env.descriptions.docker", icon: "container", status: "registered" },
  { id: "cloud-runners", name: "Cloud Runners", nameKey: "landing.env.names.cloudRunners", descriptionKey: "landing.env.descriptions.cloudRunners", icon: "cloud", status: "planned" },
  { id: "unity", name: "Unity", descriptionKey: "landing.env.descriptions.unity", icon: "box", status: "planned" },
  { id: "unreal", name: "Unreal Engine", descriptionKey: "landing.env.descriptions.unreal", icon: "gamepad", status: "planned" },
];

export type AgentDepartmentId = "cpa" | "dev" | "pm" | "qa" | "res" | "ux" | "sec" | "ops" | "fin" | "aud";

export interface AgentDepartment {
  id: AgentDepartmentId;
  status: AgentStatus;
}

export const agentDepartments: AgentDepartment[] = [
  { id: "cpa", status: "registered" },
  { id: "dev", status: "implemented" },
  { id: "pm", status: "implemented" },
  { id: "qa", status: "implemented" },
  { id: "res", status: "implemented" },
  { id: "ux", status: "planned" },
  { id: "sec", status: "planned" },
  { id: "ops", status: "planned" },
  { id: "fin", status: "planned" },
  { id: "aud", status: "planned" },
];

export const pipelineSteps: readonly MessageKey[] = [
  "landing.pipeline.steps.request",
  "landing.pipeline.steps.analyzer",
  "landing.pipeline.steps.architect",
  "landing.pipeline.steps.selector",
  "landing.pipeline.steps.envRouter",
  "landing.pipeline.steps.qualification",
  "landing.pipeline.steps.modelRouter",
  "landing.pipeline.steps.execution",
  "landing.pipeline.steps.build",
  "landing.pipeline.steps.testSecurity",
  "landing.pipeline.steps.deploy",
];

export const governanceItems = ["approvals", "audit", "permissions", "controls", "cost", "oversight"] as const;

export const securityItems = ["zeroTrust", "leastPrivilege", "isolation", "approvals", "auditability", "secrets"] as const;
