/**
 * EO-4.1 execution fixtures: a real ExecutionManager over real EO-3 planning.
 * The only double is a sandbox provider that advertises isolation and throws
 * from every execution method (tests assert it is never called).
 */
import {
  DENY_ALL_NETWORK,
  REQUIRED_LIMIT_KEYS,
  type ExecutionOperationDefinition,
  type ExecutionPolicy,
  type OperatorPrincipal,
  type SandboxProvider,
  type Tool,
} from "../../contracts/index.js";
import {
  BASELINE_DENY_ALL_POLICY,
  ExecutionManager,
  ExecutionOperationRegistry,
  ExecutionPolicyRegistry,
  InMemoryExecutionSessionStore,
  SandboxRegistry,
  ToolRegistry,
} from "../../core/index.js";
import {
  WEB_AGENT,
  WEB_HOST,
  WEB_INSTANCE,
  agent,
  planningFixture,
  webRequest,
} from "./planning.js";

export const ADMIN: OperatorPrincipal = {
  id: "admin-1",
  role: "admin",
  allowedProjects: "*",
};
export const OPERATOR: OperatorPrincipal = {
  id: "op-1",
  role: "operator",
  allowedProjects: ["alpha"],
};
export const VIEWER: OperatorPrincipal = {
  id: "viewer-1",
  role: "viewer",
  allowedProjects: "*",
};
export const BETA_OPERATOR: OperatorPrincipal = {
  id: "op-2",
  role: "operator",
  allowedProjects: ["beta"],
};

export const FAKE_SECRET = "sk-live-abcdefghijklmnop1234";

export function tool(
  id: string,
  allowedAgents: string[],
  allowedProjects = ["alpha"],
): Tool {
  return {
    id,
    name: id,
    description: "test tool (never invoked)",
    version: "1.0.0",
    capabilities: ["build"],
    requiredPermission: { action: "execute" },
    allowedAgents,
    allowedProjects,
    allowedEnvironments: ["local"],
    timeoutMs: 1000,
    limits: {
      maxCallsPerTask: 1,
      maxCallsPerAgent: 1,
      maxDurationMs: 1000,
      maxInputBytes: 1024,
      maxOutputBytes: 1024,
    },
    metadata: {},
    async execute() {
      throw new Error("tool handlers must never run in EO-4.1");
    },
  };
}

export const OPERATIONS: ExecutionOperationDefinition[] = [
  {
    id: "web.build",
    toolId: "wf.web-build",
    stageKind: "build",
    description: "Build the web bundle with a fixed profile.",
    requiredCapabilities: ["build.invoke", "filesystem.write.workspace"],
    risk: "medium",
    input: {
      profile: { kind: "enum", values: ["production", "development"] },
      outDir: { kind: "workspace_path" },
    },
  },
  {
    id: "web.build.release",
    toolId: "wf.web-build",
    stageKind: "build",
    description: "High-risk release build.",
    requiredCapabilities: ["build.invoke"],
    risk: "high",
    input: {},
  },
  {
    id: "web.test.unit",
    toolId: "wf.web-test",
    stageKind: "test",
    description: "Run unit tests.",
    requiredCapabilities: ["test.invoke"],
    risk: "low",
    input: {},
  },
  {
    id: "web.deploy",
    toolId: "wf.web-deploy",
    stageKind: "deployment",
    description: "Deploy the bundle.",
    requiredCapabilities: ["deploy.invoke"],
    risk: "critical",
    input: {},
  },
  {
    id: "web.push",
    toolId: "wf.web-build",
    stageKind: "build",
    description: "Push a branch.",
    requiredCapabilities: ["repository.push"],
    risk: "high",
    input: {},
  },
  {
    id: "web.ghost",
    toolId: "wf.not-registered",
    stageKind: "security",
    description: "Operation whose tool was never registered.",
    requiredCapabilities: ["security.scan.invoke"],
    risk: "low",
    input: {},
  },
];

export const ALPHA_POLICY: ExecutionPolicy = {
  policyId: "alpha-web",
  version: 1,
  description: "Build + unit tests for the alpha web component.",
  rules: [
    {
      id: "web-build",
      operationIds: [
        "web.build",
        "web.build.release",
        "web.test.unit",
        "web.push",
      ],
      capabilities: [
        "build.invoke",
        "filesystem.write.workspace",
        "test.invoke",
        "repository.write",
      ],
      filesystem: [{ access: "write", path: "dist" }],
      requiredEnvironmentCapabilities: ["web_build_capable"],
      secretRefs: ["secret://npm-read-token"],
    },
  ],
  forbiddenCapabilities: [],
  maxRisk: "high",
  approvalRequiredAtOrAbove: "high",
  defaultLimits: {
    sessionTimeoutMs: 600_000,
    operationTimeoutMs: 120_000,
    maxOutputBytes: 65_536,
    maxArtifactBytes: 50_000_000,
    maxToolCalls: 10,
    memoryBytes: 2_000_000_000,
  },
  network: DENY_ALL_NETWORK,
  grantTtlMs: 600_000,
};

/** Advertises isolation so pre-flight can pass; executes nothing. */
export class NonExecutingTestSandbox implements SandboxProvider {
  readonly providerId = "test-double";
  readonly kind = "local_restricted_process" as const;
  readonly capabilities = {
    enforcedLimits: [...REQUIRED_LIMIT_KEYS],
    networkModes: ["deny_all" as const],
    networkIsolation: true,
    filesystemIsolation: true,
    supportsKill: true,
    maxConcurrentInvocations: 4,
    simulated: true,
  };
  calls = 0;
  constructor(private readonly available: Set<string>) {}
  isAvailableFor(id: string) {
    return this.available.has(id);
  }
  private refuse(): never {
    this.calls += 1;
    throw new Error("the test sandbox never executes");
  }
  async prepareWorkspace(): Promise<never> {
    return this.refuse();
  }
  async start(): Promise<never> {
    return this.refuse();
  }
  async invoke(): Promise<never> {
    return this.refuse();
  }
  async terminate(): Promise<never> {
    return this.refuse();
  }
  async collectOutputs(): Promise<never> {
    return this.refuse();
  }
  async cleanup(): Promise<never> {
    return this.refuse();
  }
}

export async function harness(
  options: { sandbox?: boolean; production?: boolean } = {},
) {
  const fixture = planningFixture({
    hosts: [WEB_HOST],
    instances: [WEB_INSTANCE],
    agents: [WEB_AGENT, agent("sec-agent", ["security_review"])],
  });
  const tools = new ToolRegistry(fixture.audit);
  tools.register(tool("wf.web-build", ["web-agent"]));
  tools.register(tool("wf.web-test", ["someone-else"]));
  tools.register(tool("wf.web-deploy", ["web-agent"]));
  const operations = new ExecutionOperationRegistry();
  OPERATIONS.forEach((o) => operations.register(o));
  const policies = new ExecutionPolicyRegistry({
    policyId: "baseline-deny-all",
    version: 1,
  });
  policies.register(BASELINE_DENY_ALL_POLICY);
  policies.register(ALPHA_POLICY);
  policies.bindProject("alpha", "alpha-web", 1);
  const sandboxes = new SandboxRegistry();
  const sandbox = new NonExecutingTestSandbox(new Set(["web-1"]));
  if (options.sandbox !== false) sandboxes.register(sandbox);
  const sessions = new InMemoryExecutionSessionStore();
  let seq = 0;
  const manager = new ExecutionManager({
    planning: fixture.planning,
    approvals: fixture.approvals,
    agents: fixture.agents,
    isAgentEnabled: (id) => !fixture.disabled.has(id),
    environments: fixture.registry,
    tools,
    projects: { has: (id) => id === "alpha" || id === "beta" },
    operations,
    policies,
    sandboxes,
    sessions,
    audit: fixture.audit,
    clock: () => "2026-09-24T12:00:00.000Z",
    idFactory: (prefix) => `${prefix}_${++seq}`,
  });
  const plan = await fixture.planning.createPlan(webRequest("alpha"), {
    id: "op-1",
  });
  const request = (over: Record<string, unknown> = {}) => ({
    projectId: "alpha",
    planId: plan.planId,
    planVersion: plan.version,
    stageId: "build:web",
    operationId: "web.build",
    input: { profile: "production", outDir: "dist" },
    ...over,
  });
  return {
    fixture,
    manager,
    sessions,
    sandbox,
    plan,
    request,
    tools,
    policies,
  };
}
