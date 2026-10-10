/**
 * Build / test / security / deployment / approval PLANNING.
 *
 * Every stage produced here has the literal status `"planned"`. Nothing is
 * executed, no result is recorded, no scan is claimed and nothing is deployed.
 * Approval requirements come from a fixed policy table; they describe which
 * protected stages need a human decision — they never approve anything.
 */
import { type AgentRequirement, type BuildStage, type DependencyRequirement, type DeploymentRequirement, type PlanApprovalRequirement, type ProjectRequest, type SecurityStage, type TaskAnalysis, type TestStage } from "../../contracts/index.js";
import { type DraftEnvironmentRequirement } from "./project-architect.js";
import { type TechnologyCatalog } from "./technology-catalog.js";
export declare const SECURITY_REVIEW_CAPABILITY = "security_review";
export declare const SECURITY_AGENT_REQUIREMENT_ID = "agent:security-review";
export interface StagePlan {
    agentRequirements: AgentRequirement[];
    build: BuildStage[];
    tests: TestStage[];
    security: SecurityStage[];
    deployment: DeploymentRequirement[];
    approvalRequirements: PlanApprovalRequirement[];
}
export declare function planStages(request: ProjectRequest, analysis: TaskAnalysis, environments: readonly DraftEnvironmentRequirement[], dependencies: readonly DependencyRequirement[], catalog: TechnologyCatalog): StagePlan;
