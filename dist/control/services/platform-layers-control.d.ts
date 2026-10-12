/**
 * Control services for Layers 9–13 (Extension Platform, Business Operating Layer, Portfolio
 * Intelligence, Autonomous Operations, Analytics). They are thin: authorization, project-scoped
 * filtering, input hand-off to the core services, and an audited command result. Reads need
 * `view` (and project access for project-bound data); commands need the layer's capability, and
 * the consequential ones are administrator-only. The browser's own checks are never trusted.
 */
import { type CommandOptions, type ControlCapability, type ControlCommandResult, type OperatorPrincipal } from "../../contracts/index.js";
import type { AuditLog } from "../../core/index.js";
import { type AnalyticsIntelligence } from "../../core/analytics-intelligence/service.js";
import { type AutonomyEngine } from "../../core/autonomy/engine.js";
import { type BusinessService } from "../../core/business/service.js";
import { type ExtensionPlatform } from "../../core/extension-platform/registry.js";
import { type PortfolioIntelligence } from "../../core/portfolio-intelligence/service.js";
type Body = Record<string, unknown>;
interface Common {
    audit: AuditLog;
    clock?: () => string;
}
declare abstract class Base {
    protected readonly common: Common;
    private readonly names;
    private readonly capability;
    protected readonly clock: () => string;
    constructor(common: Common, names: readonly string[], capability: ControlCapability);
    protected view(p: OperatorPrincipal): void;
    protected admin(p: OperatorPrincipal, what: string): void;
    protected access: (p: OperatorPrincipal) => (projectId: string) => boolean;
    protected needProject(p: OperatorPrincipal, projectId: string | undefined): void;
    protected abstract run(command: string, principal: OperatorPrincipal, body: Body): Promise<Record<string, unknown>>;
    execute(command: string, principal: OperatorPrincipal, body: Body, options?: CommandOptions): Promise<ControlCommandResult>;
    private result;
}
export declare class ExtensionControlService extends Base {
    private readonly platform;
    constructor(common: Common, platform: ExtensionPlatform);
    overview(p: OperatorPrincipal): {
        extensions: import("../../contracts/extension-platform.js").ExtensionView[];
        summary: {
            total: number;
            installed: number;
            active: number;
            disabled: number;
            incompatible: number;
            failed: number;
            updateAvailable: number;
        };
        types: {
            level: "ACTIVE" | "REGISTRY_ONLY";
            effect: string;
            type: string;
        }[];
        permissions: readonly {
            scope: string;
            risk: import("../../contracts/security-governance.js").GovRisk;
            description: string;
            grantable: boolean;
        }[];
        recentAudit: import("../../contracts/extension-platform.js").ExtensionAuditEvent[];
        generatedAt: string;
    };
    extension(p: OperatorPrincipal, id: string): {
        manifests: {
            version: string;
            manifest: import("../../contracts/extension-platform.js").ExtensionManifest;
            test: {
                passed: boolean;
                at: string;
                findings: import("../../contracts/extension-platform.js").ValidationFinding[];
            } | null;
            review: {
                outcome: "PASSED" | "NEEDS_APPROVAL" | "BLOCKED" | "APPROVED";
                at: string;
                findings: string[];
                approvedBy?: string;
            } | null;
        }[];
        dependents: {
            extensionId: string;
            range?: string;
        }[];
        audit: import("../../contracts/extension-platform.js").ExtensionAuditEvent[];
        extensionId: string;
        type: import("../../contracts/extension-platform.js").ExtensionType;
        name: string;
        description: string;
        source: "builtin" | "user";
        status: import("../../contracts/extension-platform.js").ExtensionStatus;
        health: import("../../contracts/extension-platform.js").ExtensionHealth;
        healthReason: string;
        activeVersion?: string;
        latestVersion: string;
        versions: {
            version: string;
            registeredAt: string;
            tested: boolean | null;
            review: string | null;
        }[];
        requestedPermissions: string[];
        grantedPermissions: string[];
        missingGrants: string[];
        dependencies: import("../../contracts/extension-platform.js").DependencyCheck[];
        capabilities: string[];
        effect: string;
        supportLevel: "ACTIVE" | "REGISTRY_ONLY";
        lifecycle: import("../../contracts/extension-platform.js").LifecycleView[];
        config: Record<string, string | number | boolean>;
        updatedAt: string;
    };
    audit(p: OperatorPrincipal, extensionId?: string): {
        events: import("../../contracts/extension-platform.js").ExtensionAuditEvent[];
    };
    protected run(command: string, p: OperatorPrincipal, b: Body): Promise<Record<string, unknown>>;
}
export declare class BusinessControlService extends Base {
    private readonly business;
    constructor(common: Common, business: BusinessService);
    overview(p: OperatorPrincipal): {
        board: import("../../contracts/business-layer.js").BoardView;
        organization: import("../../contracts/business-layer.js").OrgNode;
        departments: import("../../contracts/business-layer.js").Department[];
    };
    objectives(p: OperatorPrincipal, params: URLSearchParams): {
        objectives: {
            kpiStatus: import("../../contracts/business-layer.js").KpiStatus[];
            objectiveId: string;
            level: import("../../contracts/business-layer.js").ObjectiveLevel;
            title: string;
            description: string;
            strategy: string;
            ownerFunction: import("../../contracts/business-layer.js").ExecutiveFunction;
            departmentId?: string;
            parentObjectiveId?: string;
            projectId?: string;
            priority: import("../../contracts/business-layer.js").BusinessPriority;
            status: import("../../contracts/business-layer.js").ObjectiveStatus;
            targetDate?: string;
            kpis: import("../../contracts/business-layer.js").Kpi[];
            createdAt: string;
            updatedAt: string;
            updatedBy: string;
            id: string;
        }[];
    };
    objective(p: OperatorPrincipal, id: string): {
        kpiStatus: import("../../contracts/business-layer.js").KpiStatus[];
        initiatives: import("../../contracts/business-layer.js").Initiative[];
        decisions: import("../../contracts/business-layer.js").DecisionRecord[];
        objectiveId: string;
        level: import("../../contracts/business-layer.js").ObjectiveLevel;
        title: string;
        description: string;
        strategy: string;
        ownerFunction: import("../../contracts/business-layer.js").ExecutiveFunction;
        departmentId?: string;
        parentObjectiveId?: string;
        projectId?: string;
        priority: import("../../contracts/business-layer.js").BusinessPriority;
        status: import("../../contracts/business-layer.js").ObjectiveStatus;
        targetDate?: string;
        kpis: import("../../contracts/business-layer.js").Kpi[];
        createdAt: string;
        updatedAt: string;
        updatedBy: string;
        id: string;
    };
    initiatives(p: OperatorPrincipal, objectiveId?: string): {
        initiatives: import("../../contracts/business-layer.js").Initiative[];
    };
    decisions(p: OperatorPrincipal, params: URLSearchParams): {
        decisions: import("../../contracts/business-layer.js").DecisionRecord[];
    };
    protected run(command: string, p: OperatorPrincipal, b: Body): Promise<Record<string, unknown>>;
}
export declare class PortfolioIntelligenceControlService extends Base {
    private readonly portfolio;
    constructor(common: Common, portfolio: PortfolioIntelligence);
    dashboard(p: OperatorPrincipal): import("../../contracts/portfolio-intelligence.js").PortfolioDashboard;
    projects(p: OperatorPrincipal, includeArchived?: boolean): {
        projects: import("../../contracts/portfolio-intelligence.js").ProjectSummary[];
    };
    project(p: OperatorPrincipal, id: string): import("../../contracts/portfolio-intelligence.js").ProjectSummary;
    health(p: OperatorPrincipal, id: string): import("../../contracts/portfolio-intelligence.js").ProjectHealth;
    priorities(p: OperatorPrincipal): {
        ranking: import("../../contracts/portfolio-intelligence.js").PriorityRank[];
        note: string;
    };
    conflicts(p: OperatorPrincipal): {
        conflicts: import("../../contracts/portfolio-intelligence.js").ResourceConflict[];
        claims: import("../../contracts/portfolio-intelligence.js").ResourceClaim[];
    };
    dependencies(p: OperatorPrincipal): {
        dependencies: import("../../contracts/portfolio-intelligence.js").ProjectDependency[];
    };
    ask(p: OperatorPrincipal, question: string): import("../../contracts/portfolio-intelligence.js").PortfolioAnswer;
    knowledge(p: OperatorPrincipal): {
        items: import("../../contracts/portfolio-intelligence.js").ReusableKnowledge[];
    };
    protected run(command: string, p: OperatorPrincipal, b: Body): Promise<Record<string, unknown>>;
}
export declare class AutonomyControlService extends Base {
    private readonly engine;
    constructor(common: Common, engine: AutonomyEngine);
    operations(p: OperatorPrincipal): import("../../contracts/autonomy.js").OperationsCenterView;
    instances(p: OperatorPrincipal, params: URLSearchParams): {
        instances: import("../../contracts/autonomy.js").WorkflowInstance[];
    };
    instance(p: OperatorPrincipal, id: string): {
        instance: import("../../contracts/autonomy.js").WorkflowInstance;
        audit: import("../../contracts/autonomy.js").AutonomyAuditEvent[];
    };
    catalog(p: OperatorPrincipal): {
        levels: {
            name: string;
            description: string;
            level: number;
        }[];
        actions: import("../../contracts/autonomy.js").AutonomousAction[];
        definitions: import("../../contracts/autonomy.js").AutonomousWorkflowDef[];
        rules: import("../../contracts/autonomy.js").TriggerRule[];
        settings: import("../../contracts/autonomy.js").AutonomySetting[];
        global: import("../../contracts/autonomy.js").AutonomyGlobal;
    };
    levelFor(p: OperatorPrincipal, projectId: string): import("../../contracts/autonomy.js").AutonomySetting;
    audit(p: OperatorPrincipal, params: URLSearchParams): {
        events: import("../../contracts/autonomy.js").AutonomyAuditEvent[];
    };
    protected run(command: string, p: OperatorPrincipal, b: Body): Promise<Record<string, unknown>>;
}
export declare class AnalyticsControlService extends Base {
    private readonly analytics;
    constructor(common: Common, analytics: AnalyticsIntelligence);
    overview(p: OperatorPrincipal): import("../../contracts/analytics-intelligence.js").AnalyticsOverview;
    agents(p: OperatorPrincipal): {
        agents: import("../../contracts/analytics-intelligence.js").AgentAnalytics[];
    };
    workflows(p: OperatorPrincipal, projectId?: string): import("../../contracts/analytics-intelligence.js").WorkflowAnalytics;
    project(p: OperatorPrincipal, projectId: string): import("../../contracts/analytics-intelligence.js").ProjectAnalytics;
    cost(p: OperatorPrincipal, projectId?: string): import("../../contracts/analytics-intelligence.js").CostIntelligence;
    bottlenecks(p: OperatorPrincipal): {
        bottlenecks: import("../../contracts/analytics-intelligence.js").Bottleneck[];
    };
    predictions(p: OperatorPrincipal): {
        predictions: import("../../contracts/analytics-intelligence.js").Prediction[];
        note: string;
    };
    recommendations(p: OperatorPrincipal, status?: string): {
        recommendations: import("../../contracts/analytics-intelligence.js").Recommendation[];
    };
    lessons(p: OperatorPrincipal): {
        lessons: import("../../contracts/analytics-intelligence.js").Lesson[];
    };
    protected run(command: string, p: OperatorPrincipal, b: Body): Promise<Record<string, unknown>>;
}
export {};
