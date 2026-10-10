/**
 * EO-3.1 planning TEST FIXTURES. Deterministic, in-memory, never used by
 * production code. Every host, environment instance, agent and model profile
 * below exists only inside the test process.
 */
import {
  AgentRegistry,
  ApprovalSystem,
  AuditLog,
  EnvironmentRegistry,
  ExecutionPlanningService,
  ModelCapabilityRegistry,
  parseVersion,
  type Agent,
  type CapabilityId,
  type EnvironmentDescriptor,
  type EnvironmentInstance,
  type HostInstance,
  type ModelCapabilityProfile,
  type OsName,
  type ToolchainDescriptor,
  type ToolchainKind,
  type TrustLevel,
  type VersionInfo,
} from "../../core/index.js";

export const FIXED_TIME = "2026-09-23T12:00:00.000Z";

export function ver(value: string): VersionInfo {
  const parsed = parseVersion(value);
  if (!parsed) throw new Error(`bad fixture version ${value}`);
  return { major: parsed.major, minor: parsed.minor, patch: parsed.patch };
}

export const DESCRIPTORS: readonly EnvironmentDescriptor[] = [
  {
    id: "web-build",
    name: "Web build",
    description: "Node web build",
    environmentType: "web_build",
    supportedToolchains: [{ kind: "node" }],
    requiredCapabilities: [],
    declaredCapabilities: ["web_build_capable", "command_execution_available"],
  },
  {
    id: "xcode",
    name: "Xcode",
    description: "Xcode build host",
    environmentType: "xcode",
    supportedToolchains: [{ kind: "swift_xcode" }],
    requiredCapabilities: [],
    declaredCapabilities: ["mobile_build_capable"],
    minimumOs: { os: "macos" },
  },
  {
    id: "android-studio",
    name: "Android Studio",
    description: "Android build",
    environmentType: "android_studio",
    supportedToolchains: [{ kind: "jdk_gradle" }, { kind: "android_sdk" }],
    requiredCapabilities: [],
    declaredCapabilities: ["mobile_build_capable"],
  },
  {
    id: "desktop-build",
    name: "Desktop build",
    description: "Desktop build",
    environmentType: "desktop_build",
    supportedToolchains: [{ kind: "dotnet" }],
    requiredCapabilities: [],
    declaredCapabilities: [
      "desktop_build_capable",
      "command_execution_available",
    ],
  },
  {
    id: "docker",
    name: "Docker",
    description: "Container runtime",
    environmentType: "docker",
    supportedToolchains: [],
    requiredCapabilities: [],
    declaredCapabilities: ["container_runtime_available"],
  },
  {
    id: "unity",
    name: "Unity",
    description: "Unity editor",
    environmentType: "unity",
    supportedToolchains: [{ kind: "unity" }],
    requiredCapabilities: [],
    declaredCapabilities: ["game_build_capable"],
  },
  {
    id: "unreal",
    name: "Unreal",
    description: "Unreal engine",
    environmentType: "unreal_engine",
    supportedToolchains: [{ kind: "unreal" }, { kind: "cpp_compiler" }],
    requiredCapabilities: [],
    declaredCapabilities: ["game_build_capable"],
  },
];

export function host(
  hostId: string,
  os: OsName,
  overrides: Partial<HostInstance> = {},
): HostInstance {
  return {
    id: hostId,
    hostId,
    name: hostId,
    hostType: "dedicated_runner",
    os: { os, architecture: os === "macos" ? "arm64" : "x64" },
    trustLevel: "verified",
    availability: "available",
    capabilities: [],
    fingerprint: `fp-${hostId}`,
    ...overrides,
  };
}

export function toolchain(
  kind: ToolchainKind,
  version?: string,
  components: Record<string, string> = {},
): ToolchainDescriptor {
  return {
    kind,
    name: kind,
    ...(version ? { version: ver(version) } : {}),
    ...(Object.keys(components).length > 0
      ? {
          componentVersions: Object.fromEntries(
            Object.entries(components).map(([k, v]) => [k, ver(v)]),
          ),
        }
      : {}),
  };
}

export function instance(
  id: string,
  descriptorId: string,
  hostId: string,
  options: {
    capabilities?: readonly (CapabilityId | [CapabilityId, boolean])[];
    toolchains?: readonly ToolchainDescriptor[];
    trustLevel?: TrustLevel;
    version?: string;
    availability?: EnvironmentInstance["availability"];
  } = {},
): EnvironmentInstance {
  const descriptor = DESCRIPTORS.find((d) => d.id === descriptorId);
  if (!descriptor)
    throw new Error(`unknown fixture descriptor ${descriptorId}`);
  return {
    id,
    descriptorId,
    hostId,
    environmentType: descriptor.environmentType,
    name: id,
    availability: options.availability ?? "available",
    capabilities: (options.capabilities ?? []).map((c) =>
      Array.isArray(c)
        ? { capability: c[0], available: c[1] }
        : { capability: c, available: true },
    ),
    toolchains: options.toolchains ?? [],
    trustLevel: options.trustLevel ?? "detected",
    ...(options.version ? { version: ver(options.version) } : {}),
    fingerprint: `fp-${id}`,
  };
}

export function agent(
  id: string,
  capabilities: readonly string[],
  overrides: Partial<Agent> = {},
): Agent {
  return {
    id,
    name: `Agent ${id}`,
    description: `${id} fixture agent`,
    capabilities,
    allowedTools: [],
    allowedProjects: [],
    supportedTaskTypes: ["build"],
    permissions: [],
    modelPolicy: { provider: "openai" },
    ...overrides,
  };
}

export const MODEL_PROFILES: readonly ModelCapabilityProfile[] = [
  {
    id: "openai-general",
    providerId: "openai",
    capabilities: ["reasoning", "coding", "structured_output"],
  },
];

export interface PlanningFixture {
  planning: ExecutionPlanningService;
  registry: EnvironmentRegistry;
  agents: AgentRegistry;
  audit: AuditLog;
  approvals: ApprovalSystem;
  disabled: Set<string>;
}

export function planningFixture(
  options: {
    hosts?: readonly HostInstance[];
    instances?: readonly EnvironmentInstance[];
    agents?: readonly Agent[];
    models?: readonly ModelCapabilityProfile[];
    projects?: readonly string[];
    audit?: AuditLog;
    approvals?: ApprovalSystem;
  } = {},
): PlanningFixture {
  const registry = new EnvironmentRegistry({ clock: () => FIXED_TIME });
  DESCRIPTORS.forEach((d) => registry.registerDescriptor(d));
  (options.hosts ?? []).forEach((h) => registry.upsertHost(h));
  (options.instances ?? []).forEach((i) => registry.upsertInstance(i));
  const agents = new AgentRegistry();
  (options.agents ?? []).forEach((a) => agents.register(a));
  const audit = options.audit ?? new AuditLog();
  const approvals = options.approvals ?? new ApprovalSystem();
  const disabled = new Set<string>();
  const projects = options.projects ?? ["alpha", "beta"];
  let sequence = 0;
  const planning = new ExecutionPlanningService({
    environments: registry,
    agents,
    audit,
    approvals,
    models: new ModelCapabilityRegistry(options.models ?? MODEL_PROFILES),
    isAgentEnabled: (id) => !disabled.has(id),
    projectExists: (id) => projects.includes(id),
    clock: () => FIXED_TIME,
    idFactory: () => `plan_${++sequence}`,
  });
  return { planning, registry, agents, audit, approvals, disabled };
}

/** A React + TypeScript web request for project `projectId`. */
export function webRequest(projectId = "alpha"): Record<string, unknown> {
  return {
    projectId,
    title: "Customer portal",
    components: [
      {
        id: "web",
        kind: "web_frontend",
        platforms: ["web"],
        technologies: ["react_typescript"],
      },
    ],
  };
}

export function iosRequest(projectId = "alpha"): Record<string, unknown> {
  return {
    projectId,
    title: "Native iOS app",
    components: [
      {
        id: "ios-app",
        kind: "mobile_app",
        platforms: ["ios"],
        technologies: ["swiftui"],
      },
    ],
  };
}

export const WEB_HOST = host("linux-1", "linux");
export const WEB_INSTANCE = instance("web-1", "web-build", "linux-1", {
  capabilities: ["web_build_capable", "command_execution_available"],
  toolchains: [toolchain("node", "20.11.1", { npm: "10.2.0" })],
});
export const MAC_HOST = host("mac-1", "macos");
export const XCODE_INSTANCE = instance("xcode-1", "xcode", "mac-1", {
  capabilities: ["mobile_build_capable"],
  toolchains: [toolchain("swift_xcode", "16.0", { ios_sdk: "18.0" })],
  version: "16.0",
});
export const WEB_AGENT = agent("web-agent", ["web_development"]);
export const IOS_AGENT = agent("ios-agent", ["ios_development"]);
