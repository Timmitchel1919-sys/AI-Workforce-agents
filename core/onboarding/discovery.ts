/**
 * Project discovery (PROJECT-2) — pure, read-only, evidence-based.
 *
 * `analyzeRepositoryEvidence` turns already-fetched repository evidence (a
 * file listing plus the contents of a small allow-list of manifests) into a
 * `ProjectAnalysis`. It performs no I/O and can never modify source. Nothing
 * is inferred from a project name: every finding carries the evidence that
 * supports it, and anything that cannot be determined is reported in
 * `unavailable` instead of being guessed.
 *
 * Secret safety: environment variables are captured as NAMES only. A value
 * read from an example env file is dropped at parse time.
 */
import type {
  AnalysisSeverity,
  ArchitectureFinding,
  CommandFinding,
  DocumentationRef,
  EnvVarClass,
  EnvVarFinding,
  EvidenceConfidence,
  Finding,
  ProjectAnalysis,
  ProjectStructure,
  RepositoryBaseline,
  SourceProvider,
} from "../../contracts/onboarding.js";

export interface RepositoryEvidence {
  provider: SourceProvider;
  url: string;
  visibility: "public" | "private" | "unknown";
  defaultBranch: string;
  branch: string;
  commit?: string;
  /** Repository-relative file paths (forward slashes). */
  paths: readonly string[];
  /** True when the provider truncated the listing. */
  truncated: boolean;
  /** Contents of the allow-listed files that were actually fetched. */
  files: Readonly<Record<string, string>>;
}

/** Files whose CONTENT the reader may fetch. Everything else is path-only. */
export const EVIDENCE_CONTENT_ALLOWLIST: readonly RegExp[] = [
  /^package\.json$/,
  /^[^/]+\/package\.json$/,
  /^tsconfig\.json$/,
  /^firebase\.json$/,
  /^firestore\.rules$/,
  /^storage\.rules$/,
  /^vercel\.json$/,
  /^requirements\.txt$/,
  /^pyproject\.toml$/,
  /^go\.mod$/,
  /^Cargo\.toml$/,
  /^pom\.xml$/,
  /^build\.gradle(?:\.kts)?$/,
  /^[^/]+\.csproj$/,
  /^\.env\.(?:example|sample|template)$/,
  /^\.github\/workflows\/[^/]+\.ya?ml$/,
  /^README(?:\.md)?$/i,
  /^Dockerfile$/,
];

export function isContentAllowlisted(path: string): boolean {
  return EVIDENCE_CONTENT_ALLOWLIST.some((pattern) => pattern.test(path));
}

const IGNORED_SEGMENTS = new Set([
  "node_modules",
  "dist",
  "build",
  "vendor",
  ".git",
  "__pycache__",
  "coverage",
  ".next",
  "Pods",
  "bin",
  "obj",
]);

function isIgnored(path: string): boolean {
  return path.split("/").some((segment) => IGNORED_SEGMENTS.has(segment));
}

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  mts: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  cs: "C#",
  cpp: "C++",
  cc: "C++",
  hpp: "C++",
  java: "Java",
  kt: "Kotlin",
  swift: "Swift",
  m: "Objective-C",
  mm: "Objective-C",
  go: "Go",
  rs: "Rust",
  rb: "Ruby",
  php: "PHP",
};

function finding(
  value: string,
  evidence: string,
  confidence: EvidenceConfidence = "high",
): Finding {
  return { value, evidence, confidence };
}

function pushUnique(list: Finding[], item: Finding): void {
  if (!list.some((existing) => existing.value === item.value)) list.push(item);
}

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  workspaces?: unknown;
}

function parsePackageJson(text: string | undefined): PackageJson | undefined {
  if (text === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as PackageJson;
    }
  } catch {
    /* malformed manifest: reported as unavailable by the caller */
  }
  return undefined;
}

function depNames(pkg: PackageJson | undefined): Set<string> {
  return new Set([
    ...Object.keys(pkg?.dependencies ?? {}),
    ...Object.keys(pkg?.devDependencies ?? {}),
  ]);
}

/** Classify an environment variable NAME. The value is never seen here. */
export function classifyEnvVar(name: string): EnvVarClass {
  if (/^(VITE_|NEXT_PUBLIC_|REACT_APP_|PUBLIC_|EXPO_PUBLIC_)/.test(name)) {
    return "public_client";
  }
  if (/(SECRET|PASSWORD|PRIVATE|TOKEN|CREDENTIAL|SERVICE_ACCOUNT)/.test(name)) {
    return "server_secret";
  }
  if (/(DATABASE_URL|DB_URL|CONNECTION_STRING|API_KEY|ACCESS_KEY)/.test(name)) {
    return "server_secret";
  }
  return "unclassified";
}

/** NAMES from `.env.example`-style text. Values and comments are discarded. */
export function parseEnvVarNames(text: string): string[] {
  const names = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]{0,99})\s*=/.exec(line);
    if (match) names.add(match[1]!);
  }
  return [...names].sort();
}

function emptyStructure(): ProjectStructure {
  return {
    frontend: [],
    backend: [],
    api: [],
    database: [],
    authentication: [],
    storage: [],
    functions: [],
    infrastructure: [],
    tests: [],
    deployment: [],
    documentation: [],
    ci: [],
  };
}

const FRAMEWORK_BY_DEPENDENCY: ReadonlyArray<
  readonly [string, string, keyof ProjectStructure | undefined]
> = [
  ["react", "React", "frontend"],
  ["vue", "Vue", "frontend"],
  ["svelte", "Svelte", "frontend"],
  ["@angular/core", "Angular", "frontend"],
  ["next", "Next.js", "frontend"],
  ["vite", "Vite", undefined],
  ["express", "Express", "backend"],
  ["fastify", "Fastify", "backend"],
  ["@nestjs/core", "NestJS", "backend"],
  ["firebase", "Firebase SDK", undefined],
  ["firebase-admin", "Firebase Admin SDK", "backend"],
  ["firebase-functions", "Firebase Functions", "functions"],
  ["tailwindcss", "Tailwind CSS", undefined],
  ["electron", "Electron", undefined],
];

const TEST_BY_DEPENDENCY: ReadonlyArray<readonly [string, string]> = [
  ["vitest", "Vitest"],
  ["jest", "Jest"],
  ["mocha", "Mocha"],
  ["@playwright/test", "Playwright"],
  ["cypress", "Cypress"],
  ["@testing-library/react", "Testing Library"],
];

const DATABASE_BY_DEPENDENCY: ReadonlyArray<readonly [string, string]> = [
  ["prisma", "Prisma"],
  ["@prisma/client", "Prisma"],
  ["mongoose", "MongoDB (mongoose)"],
  ["pg", "PostgreSQL (pg)"],
  ["mysql2", "MySQL (mysql2)"],
  ["typeorm", "TypeORM"],
  ["drizzle-orm", "Drizzle ORM"],
];

export function analyzeRepositoryEvidence(
  evidence: RepositoryEvidence,
  generatedAt: string,
): ProjectAnalysis {
  const paths = evidence.paths.filter((path) => !isIgnored(path));
  const pathSet = new Set(evidence.paths);
  const has = (path: string): boolean => pathSet.has(path);
  const hasMatch = (pattern: RegExp): string | undefined =>
    paths.find((path) => pattern.test(path));

  const structure = emptyStructure();
  const languages: Finding[] = [];
  const frameworks: Finding[] = [];
  const packageManagers: Finding[] = [];
  const buildSystems: Finding[] = [];
  const testFrameworks: Finding[] = [];
  const deployment: Finding[] = [];
  const applicationKinds: Finding[] = [];
  const commands: CommandFinding[] = [];
  const security: ArchitectureFinding[] = [];
  const findings: ArchitectureFinding[] = [];
  const unavailable: string[] = [];
  const dependencyNotes: string[] = [];
  const manifests: string[] = [];
  let runtimeCount: number | undefined;
  let devCount: number | undefined;
  let coverage: boolean | "unknown" = "unknown";

  const note = (
    list: ArchitectureFinding[],
    severity: AnalysisSeverity,
    code: string,
    message: string,
    proof?: string,
  ): void => {
    list.push({
      code,
      severity,
      message,
      ...(proof ? { evidence: proof } : {}),
    });
  };

  /* ---- languages, by real source-file counts ---- */
  const counts = new Map<string, number>();
  for (const path of paths) {
    const extension = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase();
    const language = extension ? LANGUAGE_BY_EXTENSION[extension] : undefined;
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  for (const [language, count] of [...counts].sort((a, b) => b[1] - a[1])) {
    pushUnique(
      languages,
      finding(
        language,
        `${count} ${language} source file(s)`,
        count >= 3 ? "high" : "medium",
      ),
    );
  }
  if (has("tsconfig.json") && !counts.has("TypeScript")) {
    pushUnique(languages, finding("TypeScript", "tsconfig.json", "medium"));
  }

  /* ---- package.json (root) ---- */
  const rootPackageText = evidence.files["package.json"];
  const pkg = parsePackageJson(rootPackageText);
  // First-level workspaces (ui/, functions/, ...) contribute dependency
  // evidence too; commands still come only from the root manifest.
  const nestedPackages: Array<{ path: string; pkg: PackageJson }> = [];
  for (const [path, text] of Object.entries(evidence.files)) {
    if (!/^[^/]+\/package\.json$/.test(path)) continue;
    const parsed = parsePackageJson(text);
    if (parsed) {
      nestedPackages.push({ path, pkg: parsed });
      manifests.push(path);
    }
  }
  if (has("package.json")) manifests.push("package.json");
  if (has("package.json") && rootPackageText !== undefined && !pkg) {
    unavailable.push("package.json could not be parsed");
  }
  const deps = depNames(pkg);
  for (const nested of nestedPackages) {
    const nestedDeps = depNames(nested.pkg);
    for (const [dep, name, area] of FRAMEWORK_BY_DEPENDENCY) {
      if (!nestedDeps.has(dep)) continue;
      const proof = `${nested.path} dependency "${dep}"`;
      pushUnique(frameworks, finding(name, proof));
      if (area) pushUnique(structure[area], finding(name, proof));
    }
    for (const [dep, name] of TEST_BY_DEPENDENCY) {
      if (nestedDeps.has(dep))
        pushUnique(
          testFrameworks,
          finding(name, `${nested.path} dependency "${dep}"`),
        );
    }
    for (const [dep, name] of DATABASE_BY_DEPENDENCY) {
      if (nestedDeps.has(dep))
        pushUnique(
          structure.database,
          finding(name, `${nested.path} dependency "${dep}"`),
        );
    }
    if (
      nestedDeps.has("react") ||
      nestedDeps.has("vue") ||
      nestedDeps.has("svelte") ||
      nestedDeps.has("@angular/core") ||
      nestedDeps.has("next")
    ) {
      pushUnique(
        applicationKinds,
        finding(
          "Web application",
          `${nested.path} frontend framework dependency`,
          "medium",
        ),
      );
    }
    if (nestedDeps.has("typescript"))
      pushUnique(
        languages,
        finding(
          "TypeScript",
          `${nested.path} dependency "typescript"`,
          "medium",
        ),
      );
  }
  if (pkg) {
    runtimeCount = Object.keys(pkg.dependencies ?? {}).length;
    devCount = Object.keys(pkg.devDependencies ?? {}).length;
    for (const [dep, name, area] of FRAMEWORK_BY_DEPENDENCY) {
      if (!deps.has(dep)) continue;
      pushUnique(frameworks, finding(name, `package.json dependency "${dep}"`));
      if (area) {
        pushUnique(
          structure[area],
          finding(name, `package.json dependency "${dep}"`),
        );
      }
    }
    for (const [dep, name] of TEST_BY_DEPENDENCY) {
      if (deps.has(dep)) {
        pushUnique(
          testFrameworks,
          finding(name, `package.json dependency "${dep}"`),
        );
      }
    }
    for (const [dep, name] of DATABASE_BY_DEPENDENCY) {
      if (deps.has(dep)) {
        pushUnique(
          structure.database,
          finding(name, `package.json dependency "${dep}"`),
        );
      }
    }
    if (deps.has("firebase") || deps.has("firebase-admin")) {
      pushUnique(
        structure.authentication,
        finding(
          "Firebase SDK present (Authentication use not confirmed)",
          "package.json dependency on firebase",
          "low",
        ),
      );
    }
    for (const dep of ["next-auth", "passport", "@auth0/auth0-react"]) {
      if (deps.has(dep)) {
        pushUnique(
          structure.authentication,
          finding(dep, `package.json dependency "${dep}"`),
        );
      }
    }
    if (deps.has("typescript")) {
      pushUnique(
        languages,
        finding("TypeScript", 'package.json dependency "typescript"', "medium"),
      );
    }
    if (
      typeof pkg.scripts?.["test"] === "string" &&
      /node\s+--test/.test(pkg.scripts["test"])
    ) {
      pushUnique(
        testFrameworks,
        finding("Node test runner", 'package.json script "test"'),
      );
    }
    if (
      deps.has("c8") ||
      deps.has("nyc") ||
      deps.has("@vitest/coverage-v8") ||
      Object.keys(pkg.scripts ?? {}).some((key) => /coverage/.test(key)) ||
      Object.values(pkg.scripts ?? {}).some((value) => /--coverage/.test(value))
    ) {
      coverage = true;
    }
    if (
      deps.has("react") ||
      deps.has("vue") ||
      deps.has("svelte") ||
      deps.has("@angular/core") ||
      deps.has("next")
    ) {
      pushUnique(
        applicationKinds,
        finding("Web application", "frontend framework dependency", "medium"),
      );
    } else if (
      deps.has("express") ||
      deps.has("fastify") ||
      deps.has("@nestjs/core")
    ) {
      pushUnique(
        applicationKinds,
        finding("Backend service", "server framework dependency", "medium"),
      );
    }
  }

  /* ---- package managers ---- */
  if (has("package-lock.json"))
    pushUnique(packageManagers, finding("npm", "package-lock.json"));
  if (has("pnpm-lock.yaml"))
    pushUnique(packageManagers, finding("pnpm", "pnpm-lock.yaml"));
  if (has("yarn.lock"))
    pushUnique(packageManagers, finding("yarn", "yarn.lock"));
  if (has("package.json") && packageManagers.length === 0) {
    pushUnique(
      packageManagers,
      finding("npm", "package.json (no lockfile)", "low"),
    );
    note(
      findings,
      "warning",
      "no-lockfile",
      "package.json has no lockfile; builds are not reproducible.",
      "package.json",
    );
  }
  if (has("requirements.txt")) {
    manifests.push("requirements.txt");
    pushUnique(packageManagers, finding("pip", "requirements.txt"));
  }
  const pyproject = evidence.files["pyproject.toml"];
  if (has("pyproject.toml")) {
    manifests.push("pyproject.toml");
    pushUnique(
      packageManagers,
      pyproject !== undefined && /\[tool\.poetry\]/.test(pyproject)
        ? finding("Poetry", "pyproject.toml [tool.poetry]")
        : finding("pip", "pyproject.toml", "medium"),
    );
  }
  const gradle = hasMatch(/^build\.gradle(?:\.kts)?$/);
  if (gradle) {
    manifests.push(gradle);
    pushUnique(packageManagers, finding("Gradle", gradle));
    pushUnique(buildSystems, finding("Gradle", gradle));
  }
  if (has("pom.xml")) {
    manifests.push("pom.xml");
    pushUnique(packageManagers, finding("Maven", "pom.xml"));
    pushUnique(buildSystems, finding("Maven", "pom.xml"));
    if (/spring-boot/.test(evidence.files["pom.xml"] ?? "")) {
      pushUnique(
        frameworks,
        finding("Spring", "pom.xml references spring-boot"),
      );
      pushUnique(
        structure.backend,
        finding("Spring", "pom.xml references spring-boot"),
      );
    }
  }
  const csproj = hasMatch(/\.csproj$/);
  if (csproj) {
    manifests.push(csproj);
    pushUnique(packageManagers, finding("NuGet", csproj));
    pushUnique(buildSystems, finding(".NET SDK", csproj));
    pushUnique(frameworks, finding(".NET", csproj));
    pushUnique(languages, finding("C#", csproj, "medium"));
  }
  if (has("CMakeLists.txt")) {
    manifests.push("CMakeLists.txt");
    pushUnique(buildSystems, finding("CMake", "CMakeLists.txt"));
  }
  const xcode = hasMatch(/\.xcodeproj\//) ?? hasMatch(/\.xcworkspace\//);
  if (xcode) {
    pushUnique(buildSystems, finding("Xcode build", xcode));
    pushUnique(packageManagers, finding("Xcode build", xcode, "medium"));
  }
  if (has("go.mod")) {
    manifests.push("go.mod");
    pushUnique(packageManagers, finding("Go modules", "go.mod"));
    pushUnique(buildSystems, finding("Go toolchain", "go.mod"));
  }
  if (has("Cargo.toml")) {
    manifests.push("Cargo.toml");
    pushUnique(packageManagers, finding("Cargo", "Cargo.toml"));
    pushUnique(buildSystems, finding("Cargo", "Cargo.toml"));
  }
  if (has("ProjectSettings/ProjectVersion.txt")) {
    pushUnique(
      frameworks,
      finding("Unity", "ProjectSettings/ProjectVersion.txt"),
    );
    pushUnique(
      buildSystems,
      finding("Unity tooling", "ProjectSettings/ProjectVersion.txt"),
    );
  }
  const uproject = hasMatch(/\.uproject$/);
  if (uproject) {
    pushUnique(frameworks, finding("Unreal Engine", uproject));
    pushUnique(buildSystems, finding("Unreal tooling", uproject));
  }
  if (has("vite.config.ts") || has("vite.config.js")) {
    pushUnique(
      buildSystems,
      finding(
        "Vite",
        has("vite.config.ts") ? "vite.config.ts" : "vite.config.js",
      ),
    );
  }
  if (pkg && deps.has("typescript") && has("tsconfig.json")) {
    pushUnique(
      buildSystems,
      finding("TypeScript compiler", "tsconfig.json + typescript dependency"),
    );
  }
  if (
    deps.has("fastapi") ||
    /fastapi|django|flask/i.test(evidence.files["requirements.txt"] ?? "")
  ) {
    const match = /(fastapi|django|flask)/i.exec(
      evidence.files["requirements.txt"] ?? "",
    );
    if (match) {
      pushUnique(
        frameworks,
        finding(
          match[1]![0]!.toUpperCase() + match[1]!.slice(1).toLowerCase(),
          "requirements.txt",
        ),
      );
      pushUnique(structure.backend, finding(match[1]!, "requirements.txt"));
    }
  }

  /* ---- commands: only what the repository actually declares ---- */
  const pm = has("pnpm-lock.yaml") ? "pnpm" : has("yarn.lock") ? "yarn" : "npm";
  const run = (script: string): string =>
    pm === "yarn" ? `yarn ${script}` : `${pm} run ${script}`;
  if (pkg) {
    if (has("package-lock.json")) {
      commands.push({
        purpose: "install",
        command: "npm ci",
        evidence: "package-lock.json",
      });
    } else if (has("pnpm-lock.yaml")) {
      commands.push({
        purpose: "install",
        command: "pnpm install --frozen-lockfile",
        evidence: "pnpm-lock.yaml",
      });
    } else if (has("yarn.lock")) {
      commands.push({
        purpose: "install",
        command: "yarn install --frozen-lockfile",
        evidence: "yarn.lock",
      });
    } else {
      commands.push({
        purpose: "install",
        command: "npm install",
        evidence: "package.json (no lockfile)",
      });
    }
    const scripts = pkg.scripts ?? {};
    const purposeByScript: ReadonlyArray<readonly [string, string[]]> = [
      ["typecheck", ["typecheck", "type-check", "tsc"]],
      ["lint", ["lint"]],
      ["test", ["test"]],
      ["build", ["build"]],
      ["start", ["start", "dev"]],
      ["deploy", ["deploy"]],
      ["other", ["check", "format:check"]],
    ];
    for (const [purpose, names] of purposeByScript) {
      for (const scriptName of names) {
        if (typeof scripts[scriptName] === "string") {
          commands.push({
            purpose,
            command: run(scriptName),
            evidence: `package.json script "${scriptName}"`,
          });
          if (purpose !== "start" && purpose !== "other") break;
        }
      }
    }
  }
  if (has("requirements.txt")) {
    commands.push({
      purpose: "install",
      command: "pip install -r requirements.txt",
      evidence: "requirements.txt",
    });
    if (/pytest/i.test(evidence.files["requirements.txt"] ?? "")) {
      commands.push({
        purpose: "test",
        command: "pytest",
        evidence: "requirements.txt lists pytest",
      });
      pushUnique(
        testFrameworks,
        finding("pytest", "requirements.txt lists pytest"),
      );
    }
  }
  if (has("gradlew")) {
    commands.push({
      purpose: "build",
      command: "./gradlew build",
      evidence: "gradlew wrapper present",
    });
  }
  if (has("pom.xml")) {
    commands.push({
      purpose: "build",
      command: "mvn package",
      evidence: "pom.xml (Maven lifecycle)",
    });
  }
  if (csproj) {
    commands.push({
      purpose: "build",
      command: "dotnet build",
      evidence: csproj,
    });
    if (/Microsoft\.NET\.Test\.Sdk/.test(evidence.files[csproj] ?? "")) {
      commands.push({
        purpose: "test",
        command: "dotnet test",
        evidence: `${csproj} references Microsoft.NET.Test.Sdk`,
      });
      pushUnique(testFrameworks, finding(".NET test SDK", csproj));
    }
  }
  if (has("Cargo.toml")) {
    commands.push({
      purpose: "build",
      command: "cargo build",
      evidence: "Cargo.toml",
    });
    commands.push({
      purpose: "test",
      command: "cargo test",
      evidence: "Cargo.toml",
    });
  }
  if (has("go.mod")) {
    commands.push({
      purpose: "build",
      command: "go build ./...",
      evidence: "go.mod",
    });
    commands.push({
      purpose: "test",
      command: "go test ./...",
      evidence: "go.mod",
    });
  }

  /* ---- structure from paths ---- */
  const testPath =
    hasMatch(/(^|\/)(tests?|__tests__|spec)\//) ??
    hasMatch(/\.(test|spec)\.[A-Za-z]+$/);
  if (testPath)
    pushUnique(
      structure.tests,
      finding("Automated tests present", testPath, "medium"),
    );
  if (has("index.html")) {
    pushUnique(
      structure.frontend,
      finding("Static entry (index.html)", "index.html", "medium"),
    );
  }
  const uiIndex = hasMatch(/(^|\/)index\.html$/);
  if (uiIndex && !has("index.html")) {
    pushUnique(
      structure.frontend,
      finding("Web entry point", uiIndex, "medium"),
    );
  }
  if (hasMatch(/^functions\//)) {
    pushUnique(
      structure.functions,
      finding("functions/ directory", "functions/", "medium"),
    );
  }
  const terraform = hasMatch(/\.tf$/);
  if (terraform)
    pushUnique(structure.infrastructure, finding("Terraform", terraform));
  if (has("Dockerfile") || hasMatch(/(^|\/)Dockerfile$/)) {
    pushUnique(structure.infrastructure, finding("Docker", "Dockerfile"));
  }
  if (hasMatch(/(^|\/)(k8s|kubernetes|helm)\//)) {
    pushUnique(
      structure.infrastructure,
      finding("Kubernetes manifests", "k8s/ directory", "medium"),
    );
  }
  if (hasMatch(/(^|\/)(api|routes|controllers)\//)) {
    pushUnique(
      structure.api,
      finding(
        "API layer",
        hasMatch(/(^|\/)(api|routes|controllers)\//)!,
        "medium",
      ),
    );
  }

  /* ---- deployment + CI ---- */
  const firebaseJson = evidence.files["firebase.json"];
  if (has("firebase.json")) {
    pushUnique(deployment, finding("Firebase", "firebase.json"));
    if (firebaseJson !== undefined) {
      if (/"hosting"/.test(firebaseJson))
        pushUnique(
          deployment,
          finding("Firebase Hosting", "firebase.json hosting"),
        );
      if (/"functions"/.test(firebaseJson)) {
        pushUnique(
          deployment,
          finding("Firebase Functions", "firebase.json functions"),
        );
        pushUnique(
          structure.functions,
          finding("Firebase Functions", "firebase.json functions"),
        );
      }
      if (/"firestore"/.test(firebaseJson)) {
        pushUnique(
          structure.database,
          finding("Firestore", "firebase.json firestore"),
        );
      }
      if (/"storage"/.test(firebaseJson)) {
        pushUnique(
          structure.storage,
          finding("Cloud Storage", "firebase.json storage"),
        );
      }
    }
  }
  if (has("storage.rules"))
    pushUnique(
      structure.storage,
      finding("Cloud Storage rules", "storage.rules"),
    );
  if (has("firestore.rules"))
    pushUnique(structure.database, finding("Firestore", "firestore.rules"));
  if (has("vercel.json"))
    pushUnique(deployment, finding("Vercel", "vercel.json"));
  if (has("netlify.toml"))
    pushUnique(deployment, finding("Netlify", "netlify.toml"));
  if (has("Dockerfile"))
    pushUnique(
      deployment,
      finding("Container image (Dockerfile)", "Dockerfile", "medium"),
    );
  if (has("app.yaml") || has("cloudbuild.yaml")) {
    pushUnique(
      deployment,
      finding(
        "Google Cloud (App Engine / Cloud Build)",
        has("app.yaml") ? "app.yaml" : "cloudbuild.yaml",
        "medium",
      ),
    );
  }
  if (has("azure-pipelines.yml"))
    pushUnique(
      deployment,
      finding("Azure Pipelines", "azure-pipelines.yml", "medium"),
    );
  if (has("serverless.yml"))
    pushUnique(
      deployment,
      finding("Serverless Framework (AWS)", "serverless.yml", "medium"),
    );
  if (has("fastlane/Fastfile"))
    pushUnique(
      deployment,
      finding(
        "App Store / Play Store (fastlane)",
        "fastlane/Fastfile",
        "medium",
      ),
    );
  const workflows = paths.filter((path) =>
    /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path),
  );
  for (const workflow of workflows) {
    pushUnique(structure.ci, finding("GitHub Actions", workflow));
    const content = evidence.files[workflow];
    if (
      content &&
      /firebase(?:-tools)?\s+deploy|FirebaseExtended\/action-hosting-deploy/i.test(
        content,
      )
    ) {
      pushUnique(
        deployment,
        finding("Firebase (via GitHub Actions)", workflow, "medium"),
      );
    }
  }
  if (has(".gitlab-ci.yml"))
    pushUnique(structure.ci, finding("GitLab CI", ".gitlab-ci.yml"));
  if (has("azure-pipelines.yml"))
    pushUnique(structure.ci, finding("Azure Pipelines", "azure-pipelines.yml"));
  for (const item of deployment) pushUnique(structure.deployment, item);

  /* ---- environment variable NAMES ---- */
  const envVars: EnvVarFinding[] = [];
  const seenEnv = new Set<string>();
  for (const [path, content] of Object.entries(evidence.files)) {
    if (!/^\.env\.(?:example|sample|template)$/.test(path)) continue;
    for (const name of parseEnvVarNames(content)) {
      if (seenEnv.has(name)) continue;
      seenEnv.add(name);
      envVars.push({
        name,
        classification: classifyEnvVar(name),
        evidence: path,
      });
    }
  }
  if (envVars.length === 0) {
    unavailable.push(
      "no .env.example / .env.sample found: required environment variable names are not established",
    );
  }

  /* ---- security (read-only) ---- */
  const committedEnv = paths.find(
    (path) =>
      /(^|\/)\.env(\.[A-Za-z]+)?$/.test(path) &&
      !/\.(example|sample|template)$/.test(path),
  );
  if (committedEnv) {
    note(
      security,
      "warning",
      "committed-env-file",
      "An environment file appears to be committed to the repository; review it for secret values.",
      committedEnv,
    );
  }
  const keyFile = paths.find(
    (path) =>
      /\.(pem|p12|pfx)$/i.test(path) ||
      /service[-_]?account.*\.json$/i.test(path),
  );
  if (keyFile) {
    note(
      security,
      "warning",
      "credential-file-path",
      "A file whose name suggests a private key or service-account credential is committed.",
      keyFile,
    );
  }
  if (
    /allow\s+(?:read|write|read,\s*write)\s*:\s*if\s+true/.test(
      evidence.files["firestore.rules"] ?? "",
    )
  ) {
    note(
      security,
      "warning",
      "open-firestore-rules",
      "firestore.rules contains a rule that allows access unconditionally.",
      "firestore.rules",
    );
  }
  if (evidence.visibility === "public") {
    note(
      findings,
      "info",
      "public-repository",
      "The repository is public; anything committed is publicly readable.",
    );
  }

  /* ---- documentation ---- */
  const documentation: DocumentationRef[] = [];
  for (const path of paths) {
    let kind: DocumentationRef["kind"] | undefined;
    if (/^README(\.[A-Za-z]+)?$/i.test(path)) kind = "readme";
    else if (/(^|\/)adr\//i.test(path) && /\.md$/i.test(path)) kind = "adr";
    else if (/architecture[^/]*\.md$/i.test(path)) kind = "architecture";
    else if (/(coding-standards|contributing)[^/]*\.md$/i.test(path))
      kind = "standards";
    else if (/^docs\/.+\.md$/i.test(path)) kind = "docs";
    if (kind && documentation.length < 60) documentation.push({ path, kind });
  }
  for (const doc of documentation.slice(0, 5)) {
    structure.documentation.push(finding(doc.kind, doc.path));
  }

  /* ---- architectural findings (reported, never auto-changed) ---- */
  if (!commands.some((command) => command.purpose === "build")) {
    note(
      findings,
      "info",
      "build-command-unresolved",
      "No build command could be determined from repository evidence.",
    );
  }
  if (structure.tests.length === 0 && testFrameworks.length === 0) {
    note(
      findings,
      "warning",
      "no-tests-detected",
      "No automated tests were detected.",
    );
  } else if (!commands.some((command) => command.purpose === "test")) {
    note(
      findings,
      "warning",
      "test-command-unresolved",
      "Tests exist but no test command could be determined.",
    );
  }
  if (structure.ci.length === 0) {
    note(
      findings,
      "info",
      "no-ci-detected",
      "No CI configuration was detected.",
    );
  }
  if (deployment.length === 0) {
    note(
      findings,
      "info",
      "no-deployment-detected",
      "No deployment configuration was detected.",
    );
  } else if (structure.ci.length === 0) {
    note(
      findings,
      "info",
      "deployment-not-verified",
      "Deployment is configured but no automated verification pipeline was detected.",
    );
  }
  if (documentation.length === 0) {
    note(
      findings,
      "info",
      "no-documentation",
      "No README or documentation was detected.",
    );
  }
  if (evidence.truncated) {
    note(
      findings,
      "warning",
      "listing-truncated",
      "The provider truncated the file listing; discovery may be incomplete.",
    );
    unavailable.push("complete file listing (provider truncated the tree)");
  }
  if (languages.length === 0) {
    unavailable.push("programming languages (no recognised source files)");
  }
  if (evidence.commit === undefined) unavailable.push("analysed commit");
  if (coverage === "unknown") unavailable.push("test coverage configuration");
  dependencyNotes.push(
    "Dependencies are reported only; nothing is upgraded during onboarding.",
  );

  const repository: RepositoryBaseline = {
    provider: evidence.provider,
    repositoryUrl: evidence.url,
    visibility: evidence.visibility,
    defaultBranch: evidence.defaultBranch,
    branch: evidence.branch,
    ...(evidence.commit ? { commit: evidence.commit } : {}),
  };

  return {
    basis: "repository",
    generatedAt,
    repository,
    applicationKinds,
    languages,
    frameworks,
    packageManagers,
    buildSystems,
    structure,
    dependencies: {
      manifests,
      ...(runtimeCount !== undefined ? { runtimeCount } : {}),
      ...(devCount !== undefined ? { devCount } : {}),
      notes: dependencyNotes,
    },
    commands,
    testFrameworks,
    coverageConfigured: coverage,
    deployment,
    envVars,
    security,
    documentation,
    findings,
    unavailable,
    truncated: evidence.truncated,
  };
}

/* ------------------------------------------------------------------ */
/* New project: specification analysis (a PROPOSAL, never a detection) */
/* ------------------------------------------------------------------ */

const SPEC_SIGNALS: ReadonlyArray<{
  pattern: RegExp;
  bucket:
    | "languages"
    | "frameworks"
    | "database"
    | "authentication"
    | "deployment"
    | "kinds";
  value: string;
}> = [
  { pattern: /\btypescript\b/i, bucket: "languages", value: "TypeScript" },
  { pattern: /\bpython\b/i, bucket: "languages", value: "Python" },
  { pattern: /\bswift(?:ui)?\b/i, bucket: "languages", value: "Swift" },
  { pattern: /\bkotlin\b/i, bucket: "languages", value: "Kotlin" },
  { pattern: /\bc#|\.net\b/i, bucket: "languages", value: "C#" },
  { pattern: /\breact\b/i, bucket: "frameworks", value: "React" },
  { pattern: /\bvite\b/i, bucket: "frameworks", value: "Vite" },
  { pattern: /\bnext\.?js\b/i, bucket: "frameworks", value: "Next.js" },
  { pattern: /\bunity\b/i, bucket: "frameworks", value: "Unity" },
  { pattern: /\bunreal\b/i, bucket: "frameworks", value: "Unreal Engine" },
  { pattern: /\bfirestore\b/i, bucket: "database", value: "Firestore" },
  { pattern: /\bpostgres(?:ql)?\b/i, bucket: "database", value: "PostgreSQL" },
  {
    pattern: /\bfirebase auth(?:entication)?\b/i,
    bucket: "authentication",
    value: "Firebase Authentication",
  },
  { pattern: /\bfirebase\b/i, bucket: "deployment", value: "Firebase" },
  { pattern: /\bvercel\b/i, bucket: "deployment", value: "Vercel" },
  {
    pattern: /\b(?:web ?app(?:lication)?|website|dashboard|web portal)\b/i,
    bucket: "kinds",
    value: "Web application",
  },
  {
    pattern: /\b(?:ios|iphone|ipad)\b/i,
    bucket: "kinds",
    value: "iOS application",
  },
  { pattern: /\bandroid\b/i, bucket: "kinds", value: "Android application" },
  { pattern: /\b(?:game|3d game)\b/i, bucket: "kinds", value: "Game" },
  {
    pattern: /\b(?:rest api|api service|backend service)\b/i,
    bucket: "kinds",
    value: "Backend service",
  },
  {
    pattern: /\bcommand[- ]line|\bcli tool\b/i,
    bucket: "kinds",
    value: "Command-line tool",
  },
];

export function analyzeSpecification(
  specification: string,
  generatedAt: string,
): ProjectAnalysis {
  const text = specification.trim();
  const buckets = {
    languages: [] as Finding[],
    frameworks: [] as Finding[],
    database: [] as Finding[],
    authentication: [] as Finding[],
    deployment: [] as Finding[],
    kinds: [] as Finding[],
  };
  for (const signal of SPEC_SIGNALS) {
    const match = signal.pattern.exec(text);
    if (match) {
      pushUnique(
        buckets[signal.bucket],
        finding(signal.value, `specification mentions "${match[0]}"`, "medium"),
      );
    }
  }
  const structure = emptyStructure();
  structure.database = buckets.database;
  structure.authentication = buckets.authentication;
  structure.deployment = buckets.deployment;
  const findings: ArchitectureFinding[] = [];
  const unavailable: string[] = [
    "repository evidence (a new project has no source to analyse)",
    "build and test commands (proposed only after a stack is chosen and source exists)",
    "analysed commit",
  ];
  if (text.length < 40) {
    findings.push({
      code: "specification-too-short",
      severity: "warning",
      message:
        "The specification is very short; the proposal will be incomplete.",
    });
  }
  if (buckets.languages.length === 0 && buckets.frameworks.length === 0) {
    unavailable.push(
      "technology stack (the specification does not name one; choose or override in review)",
    );
  }
  return {
    basis: "specification",
    generatedAt,
    repository: {},
    applicationKinds: buckets.kinds,
    languages: buckets.languages,
    frameworks: buckets.frameworks,
    packageManagers: [],
    buildSystems: [],
    structure,
    dependencies: { manifests: [], notes: [] },
    commands: [],
    testFrameworks: [],
    coverageConfigured: "unknown",
    deployment: buckets.deployment,
    envVars: [],
    security: [],
    documentation: [],
    findings,
    unavailable,
    truncated: false,
  };
}
