import type {
  OnboardingCapabilitiesView,
  OnboardingSession,
  OnboardingSessionSummary,
  ProjectAnalysis,
  ProvisioningPlan,
} from "../types";

const f = (value: string) => ({ value, evidence: `evidence for ${value}`, confidence: "high" as const });

export const CAPABILITIES: OnboardingCapabilitiesView = {
  canCreate: true,
  providers: [{ provider: "github", available: true, note: "GitHub via server-side integration." }],
  kinds: [
    { kind: "create_new", available: true, note: "" },
    { kind: "import_existing", available: true, note: "" },
    { kind: "import_local", available: false, note: "A browser cannot read local folders; needs a future Desktop Agent." },
  ],
  gaps: [{ key: "repository_creation", note: "Repository creation is not available yet." }],
};

export const ANALYSIS: ProjectAnalysis = {
  basis: "repository",
  generatedAt: "2026-01-01T00:00:00Z",
  repository: { commit: "abc123", defaultBranch: "main", visibility: "public" },
  applicationKinds: [],
  languages: [f("TypeScript")],
  frameworks: [f("React")],
  packageManagers: [f("npm")],
  buildSystems: [f("vite")],
  structure: {
    frontend: [], backend: [], api: [], database: [], authentication: [], storage: [],
    functions: [], infrastructure: [], tests: [], deployment: [], documentation: [], ci: [],
  },
  dependencies: { manifests: ["package.json"], notes: [] },
  commands: [{ purpose: "test", command: "npm test", evidence: "package.json scripts.test" }],
  testFrameworks: [f("vitest")],
  coverageConfigured: "unknown",
  deployment: [f("Firebase Hosting")],
  envVars: [{ name: "VITE_API_KEY", classification: "public_client", evidence: ".env.example" }],
  security: [],
  documentation: [{ path: "README.md", kind: "readme" }],
  findings: [{ code: "F1", severity: "warning", message: "No lint config found", evidence: "no eslint file" }],
  unavailable: ["Coverage could not be determined"],
  truncated: false,
};

export const PLAN: ProvisioningPlan = {
  planVersion: 2,
  planHash: "deadbeefcafe0123456789",
  generatedAt: "2026-01-01T00:00:00Z",
  basis: "repository",
  identity: { projectId: "acme-app", name: "Acme App", code: "ACME", priority: "normal", owner: "u1" },
  source: { provider: "github", repositoryUrl: "https://github.com/acme/app" },
  repository: { commit: "abc123", defaultBranch: "main" },
  technology: {
    origin: "detected", languages: [f("TypeScript")], frameworks: [f("React")], dataStorage: [], authentication: [],
    packageManagers: [f("npm")], buildSystems: [f("vite")], testSystems: [f("vitest")], deploymentTargets: [], overrides: [],
  },
  architecture: { summary: "Single page app", components: [], findings: [] },
  environments: [
    { environmentType: "node", purpose: "Build", requirements: [], supported: true, availability: "no_qualified_instance", provisioningNeed: "Register one" },
  ],
  workforce: [{ role: "Developer", availability: "roadmap", qualified: false, reason: "Not implemented" }],
  autonomy: { level: 2, requested: ["repository.read"], granted: ["repository.read"], approvalRequired: ["merge"], note: "Preset intersected" },
  integrations: [{ provider: "GitHub", purpose: "Source", state: "needs_authorization", note: "Authorize" }],
  secrets: [{ name: "STRIPE_SECRET", classification: "server_secret", status: "reference_required" }],
  git: {
    agentBranchPattern: "agent/<task-id>", testsRequired: true, reviewRequired: true, securityCheckRequired: true,
    autoCommit: false, autoPush: false, pullRequestRequired: true, mergePolicy: "manual", allowDirectDefaultBranchWrites: false,
  },
  pipeline: [
    { stage: "install", status: "resolved", command: "npm ci" },
    { stage: "build", status: "unresolved" },
  ],
  deployment: { targets: [], visibilitySlaMinutes: 5, slaNote: "Objective only.", existingDeploymentPreserved: true },
  cost: { warningThresholdPercent: 80, hardStop: false, currency: "USD", enforcement: "not_enforced", enforcementNote: "Recorded, not enforced." },
  governance: { auditBaseline: ["commit"], approvals: ["plan"], securityFindings: 0 },
  knowledge: [],
  steps: [{ key: "registry_entry", title: "Registry entry", external: false, mandatory: true, description: "Register", executable: true }],
  blockers: [],
  warnings: [{ code: "W1", message: "Deployment unspecified" }],
};

export function makeSession(over: Partial<OnboardingSession> = {}): OnboardingSession {
  return {
    id: "ob1",
    projectId: "acme-app",
    requestedBy: "u1",
    mode: "guided",
    kind: "import_existing",
    status: "draft",
    draft: {
      identity: { name: "", code: "", priority: "normal", owner: "u1" },
      source: { provider: "github" },
      overrides: [],
      autonomyLevel: 2,
    },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    revision: 1,
    ...over,
  };
}

export const REVIEW_SESSION = makeSession({
  status: "review_required",
  analysis: ANALYSIS,
  plan: PLAN,
  revision: 5,
  draft: {
    identity: { name: "Acme App", code: "ACME", priority: "normal", owner: "u1" },
    source: { provider: "github", repositoryUrl: "https://github.com/acme/app" },
    overrides: [],
    autonomyLevel: 2,
  },
});

export function summary(over: Partial<OnboardingSessionSummary> = {}): OnboardingSessionSummary {
  return {
    id: "ob1", projectId: "acme-app", name: "Acme App", code: "ACME", mode: "guided", kind: "import_existing",
    status: "draft", requestedBy: "u1", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", revision: 1, ...over,
  };
}
