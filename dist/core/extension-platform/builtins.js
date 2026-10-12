const skill = (id, name, description, spec) => ({
    id,
    name,
    description,
    version: "1.0.0",
    type: "SKILL",
    author: "AI Workforce OS (built-in)",
    capabilities: [spec.capability],
    dependencies: [],
    permissions: [],
    spec: {
        prerequisites: [],
        validation: ["Typecheck, lint and tests pass."],
        ...spec,
    },
});
export const BUILTIN_SKILLS = [
    skill("skill.react-development", "React development", "Build and change React/TypeScript interfaces safely.", {
        capability: "react.development",
        instructions: "Follow the existing component, hook and styling conventions. Keep components small and typed; use the shared design tokens; never add a new dependency without a reason. Cover loading, empty and error states and keyboard accessibility.",
        tools: ["repo.read", "repo.edit", "tests.run", "build.run"],
        expectedOutputs: [
            "Changed components with tests",
            "Typecheck and lint output",
        ],
        appliesTo: { keywords: ["react", "component", "tsx", "frontend", "ui"] },
    }),
    skill("skill.firebase-development", "Firebase development", "Work with Firebase Hosting, Functions, Auth, Firestore and rules.", {
        capability: "firebase.development",
        instructions: "Treat Firestore rules and Auth as the security boundary. Never trust client checks. Change rules and functions in the same commit as the code that needs them and add emulator or unit tests. Deploy only through the governed approval path.",
        tools: ["repo.read", "repo.edit", "tests.run"],
        expectedOutputs: [
            "Rules or function change with tests",
            "A deployment plan, not a deployment",
        ],
        appliesTo: {
            keywords: ["firebase", "firestore", "functions", "hosting", "rules"],
        },
    }),
    skill("skill.wordpress-development", "WordPress development", "Create and edit WordPress content and themes draft-first.", {
        capability: "wordpress.development",
        instructions: "Create content as drafts; publishing is a separate approved step. Respect the site's theme and plugin boundaries. Never store credentials in code.",
        tools: ["cms.draft.create", "cms.post.update"],
        expectedOutputs: ["Draft content", "A publish checklist"],
        appliesTo: { keywords: ["wordpress", "wp", "cms", "blog", "post"] },
    }),
    skill("skill.data-analysis", "Data analysis", "Analyse data with stated assumptions and verifiable results.", {
        capability: "data.analysis",
        instructions: "State the question, the data source and the assumptions first. Report sample sizes and uncertainty. Separate observation from interpretation and never present an estimate as a fact.",
        tools: ["repo.read"],
        expectedOutputs: [
            "Findings with the data they rest on",
            "Stated limitations",
        ],
        appliesTo: {
            keywords: [
                "analysis",
                "analyse",
                "analyze",
                "metrics",
                "dataset",
                "statistics",
            ],
        },
    }),
    skill("skill.sql-analysis", "SQL analysis", "Write and review read-only SQL.", {
        capability: "sql.analysis",
        instructions: "Write read-only queries. Parameterise values, name columns explicitly, explain joins and check row counts. Never run writes or schema changes from an analysis task.",
        tools: [],
        expectedOutputs: [
            "The query",
            "Expected result shape",
            "Performance notes",
        ],
        appliesTo: { keywords: ["sql", "query", "database", "join"] },
    }),
    skill("skill.ui-ux-review", "UI/UX review", "Review interfaces for usability, accessibility and consistency.", {
        capability: "ux.review",
        instructions: "Review against the design system, WCAG 2.1 AA, keyboard use, focus, contrast, responsive layouts from 375px, and empty/error/loading states. Report findings with evidence and severity.",
        tools: ["repo.read"],
        expectedOutputs: [
            "Findings by severity with evidence",
            "Recommended changes",
        ],
        appliesTo: {
            taskTypes: ["REVIEW"],
            keywords: ["ux", "usability", "accessibility", "design review"],
        },
    }),
    skill("skill.security-review", "Security review", "Review changes for security weaknesses.", {
        capability: "security.review",
        instructions: "Check authentication, authorization, input validation, secret handling, injection, project isolation and logging. Do not weaken existing controls. Report findings with severity and a concrete fix.",
        tools: ["repo.read"],
        expectedOutputs: [
            "Findings by severity",
            "Required fixes before approval",
        ],
        appliesTo: {
            taskTypes: ["SECURITY", "REVIEW"],
            keywords: ["security", "vulnerability", "auth", "permission"],
        },
    }),
    skill("skill.financial-analysis", "Financial analysis", "Analyse financial information without giving investment advice.", {
        capability: "finance.analysis",
        instructions: "Show calculations and sources. Do not give personalised investment advice. Distinguish actuals from forecasts and state the assumptions behind every projection.",
        tools: [],
        expectedOutputs: [
            "Calculations with sources",
            "Assumptions and limitations",
        ],
        appliesTo: {
            keywords: ["finance", "financial", "budget", "revenue", "forecast"],
        },
    }),
    skill("skill.3d-design", "3D design", "Plan and review 3D scene and asset work.", {
        capability: "design.3d",
        instructions: "Define the target platform, polygon and texture budgets and the file formats first. Keep scenes reproducible from described steps and review for performance on the target device.",
        tools: [],
        expectedOutputs: ["Scene plan", "Asset budget table"],
        appliesTo: { keywords: ["3d", "model", "scene", "mesh", "render"] },
    }),
    skill("skill.blender-workflow", "Blender workflow", "Describe repeatable Blender workflows.", {
        capability: "blender.workflow",
        instructions: "Describe the steps as a repeatable procedure with versions and add-ons stated. Blender automation is a declared boundary: do not assume an executable Blender integration exists.",
        tools: [],
        expectedOutputs: ["Step-by-step procedure"],
        appliesTo: { keywords: ["blender"] },
    }),
];
const agent = (id, name, description, spec) => ({
    id,
    name,
    description,
    version: "1.0.0",
    type: "AGENT",
    author: "AI Workforce OS (built-in)",
    capabilities: spec.capabilities,
    dependencies: [],
    permissions: [],
    spec,
});
export const BUILTIN_AGENTS = [
    agent("agent.wordpress", "WordPress Agent", "Creates and edits WordPress content draft-first.", {
        agentId: "wordpress-agent",
        role: "WordPress developer",
        capabilities: ["wordpress.development", "cms.content"],
        modelRequirements: { capabilities: ["text"], minContextTokens: 16000 },
        tools: ["cms.draft.create", "cms.post.update"],
        inputContract: "A content or theme request with the target site and acceptance criteria.",
        outputContract: "Draft content or a change set plus a publish checklist. Never publishes.",
        validation: ["Content is a draft", "Links and media resolve"],
        costProfile: { tier: "low", maxTokensPerTask: 40000 },
    }),
    agent("agent.data-analyst", "Data Analyst Agent", "Analyses data and reports findings with limits.", {
        agentId: "data-analyst-agent",
        role: "Data analyst",
        capabilities: ["data.analysis", "sql.analysis"],
        modelRequirements: {
            capabilities: ["text", "reasoning"],
            minContextTokens: 32000,
        },
        tools: ["repo.read"],
        inputContract: "A question, the data source and any constraints.",
        outputContract: "Findings, assumptions, sample sizes and limitations.",
        validation: ["Every figure cites its source"],
        costProfile: { tier: "medium", maxTokensPerTask: 80000 },
    }),
    agent("agent.3d", "3D Agent", "Plans 3D scenes and assets.", {
        agentId: "three-d-agent",
        role: "3D designer",
        capabilities: ["design.3d", "blender.workflow"],
        modelRequirements: { capabilities: ["text"], minContextTokens: 16000 },
        tools: [],
        inputContract: "A scene or asset brief with the target platform.",
        outputContract: "A scene plan and asset budget; no executable Blender automation.",
        validation: ["Budgets are stated"],
        costProfile: { tier: "low" },
    }),
    agent("agent.finance", "Finance Agent", "Analyses financial information; never gives investment advice.", {
        agentId: "finance-agent",
        role: "Financial analyst",
        capabilities: ["finance.analysis"],
        modelRequirements: {
            capabilities: ["text", "reasoning"],
            minContextTokens: 32000,
        },
        tools: [],
        inputContract: "A financial question with the data provided.",
        outputContract: "Calculations, sources and assumptions.",
        validation: ["Calculations are shown"],
        costProfile: { tier: "medium" },
    }),
    agent("agent.research", "Research Agent", "Researches a topic and cites sources.", {
        agentId: "research-agent",
        role: "Researcher",
        capabilities: ["research.synthesis"],
        modelRequirements: {
            capabilities: ["text", "reasoning"],
            minContextTokens: 64000,
        },
        tools: [],
        inputContract: "A research question and the allowed sources.",
        outputContract: "A summary with sources and a confidence statement.",
        validation: ["Claims cite sources"],
        costProfile: { tier: "high", maxTokensPerTask: 150000 },
    }),
];
const workflow = (id, name, description, spec) => ({
    id,
    name,
    description,
    version: "1.0.0",
    type: "WORKFLOW",
    author: "AI Workforce OS (built-in)",
    capabilities: [`workflow.${id.replace(/^workflow\./, "")}`],
    dependencies: [],
    permissions: [],
    spec,
});
/** The standard development loop, as a reusable template. */
export const BUILTIN_WORKFLOWS = [
    workflow("workflow.standard-development", "Standard development loop", "Analyse, plan, code, test, review, security, approval.", {
        stages: [
            { id: "analyze", title: "Analyse the request", taskType: "ANALYSIS" },
            {
                id: "plan",
                title: "Plan the change",
                taskType: "PLANNING",
                dependsOn: ["analyze"],
            },
            {
                id: "code",
                title: "Implement",
                taskType: "DEVELOPMENT",
                agentRole: "developer",
                dependsOn: ["plan"],
            },
            { id: "test", title: "Test", taskType: "TESTING", dependsOn: ["code"] },
            {
                id: "review",
                title: "Review",
                taskType: "REVIEW",
                dependsOn: ["test"],
            },
            {
                id: "security",
                title: "Security check",
                taskType: "SECURITY",
                dependsOn: ["review"],
            },
            {
                id: "approval",
                title: "Human approval",
                taskType: "APPROVAL",
                requiresApproval: true,
                dependsOn: ["security"],
            },
        ],
    }),
    workflow("workflow.maintenance-fix", "Maintenance fix", "Diagnose, fix, test and prepare a pull request for review.", {
        stages: [
            { id: "diagnose", title: "Diagnose the failure", taskType: "ANALYSIS" },
            {
                id: "fix",
                title: "Prepare the fix",
                taskType: "DEVELOPMENT",
                dependsOn: ["diagnose"],
            },
            {
                id: "test",
                title: "Test the fix",
                taskType: "TESTING",
                dependsOn: ["fix"],
            },
            {
                id: "pr",
                title: "Prepare a pull request",
                taskType: "REVIEW",
                requiresApproval: true,
                dependsOn: ["test"],
            },
        ],
    }),
];
export const BUILTIN_EXTENSIONS = [
    ...BUILTIN_SKILLS,
    ...BUILTIN_AGENTS,
    ...BUILTIN_WORKFLOWS,
];
