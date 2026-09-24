/**
 * Build / test / security / deployment / approval PLANNING.
 *
 * Every stage produced here has the literal status `"planned"`. Nothing is
 * executed, no result is recorded, no scan is claimed and nothing is deployed.
 * Approval requirements come from a fixed policy table; they describe which
 * protected stages need a human decision — they never approve anything.
 */
import { TEST_TYPES, } from "../../contracts/index.js";
export const SECURITY_REVIEW_CAPABILITY = "security_review";
export const SECURITY_AGENT_REQUIREMENT_ID = "agent:security-review";
export function planStages(request, analysis, environments, dependencies, catalog) {
    const agentRequirements = [];
    const build = [];
    const tests = [];
    const sastComponents = [];
    for (const component of analysis.components) {
        const profiles = component.technologyIds
            .map((id) => catalog.get(id))
            .filter((p) => p !== undefined);
        if (profiles.length === 0)
            continue;
        const environment = environments.find((e) => e.componentIds.includes(component.componentId));
        if (!environment)
            continue;
        const agentRequirementId = `agent:build:${component.componentId}`;
        agentRequirements.push({
            id: agentRequirementId,
            purpose: "build",
            componentIds: [component.componentId],
            requiredCapabilities: unique(profiles.flatMap((p) => p.agentCapabilities)),
            modelCapabilities: unique(profiles.flatMap((p) => p.modelCapabilities)),
        });
        const buildId = `build:${component.componentId}`;
        build.push({
            id: buildId,
            componentId: component.componentId,
            status: "planned",
            inputs: [`source:${component.componentId}`],
            environmentRequirementId: environment.id,
            requiredCapabilities: [
                ...(environment.requirement.requiredCapabilities ?? []),
            ],
            dependencyIds: dependencies
                .filter((d) => d.requiredBy.includes(component.componentId))
                .map((d) => d.id),
            agentRequirementId,
            expectedArtifact: { ...profiles[0].artifact },
            validation: [
                "build_completes_without_error",
                "expected_artifact_present",
            ],
        });
        const types = new Set(profiles.flatMap((p) => p.testTypes));
        for (const type of TEST_TYPES.filter((t) => types.has(t))) {
            tests.push({
                id: `test:${component.componentId}:${type}`,
                componentId: component.componentId,
                type,
                status: "planned",
                environmentRequirementId: environment.id,
                dependsOnStageIds: [buildId],
            });
        }
        if (profiles.some((p) => p.sast))
            sastComponents.push(component.componentId);
    }
    const builtComponents = build.map((b) => b.componentId);
    const deployment = planDeployments(request, build);
    const hasProduction = deployment.some((d) => d.stage === "production");
    const security = [];
    if (builtComponents.length > 0) {
        security.push({
            id: "security:secret_scan",
            check: "secret_scan",
            status: "planned",
            componentIds: builtComponents,
        }, {
            id: "security:dependency_scan",
            check: "dependency_scan",
            status: "planned",
            componentIds: builtComponents,
        });
    }
    if (sastComponents.length > 0) {
        security.push({
            id: "security:sast",
            check: "sast",
            status: "planned",
            componentIds: sastComponents,
        });
    }
    if (hasProduction) {
        const deployed = unique(deployment
            .filter((d) => d.stage === "production")
            .map((d) => d.componentId));
        security.push({
            id: "security:permission_review",
            check: "permission_review",
            status: "planned",
            componentIds: deployed,
        }, {
            id: "security:security_agent_review",
            check: "security_agent_review",
            status: "planned",
            componentIds: deployed,
            agentRequirementId: SECURITY_AGENT_REQUIREMENT_ID,
        });
        agentRequirements.push({
            id: SECURITY_AGENT_REQUIREMENT_ID,
            purpose: "security_review",
            componentIds: deployed,
            requiredCapabilities: [SECURITY_REVIEW_CAPABILITY],
            modelCapabilities: ["reasoning"],
        });
    }
    // Deployment gates: the component's build, its tests and all security checks.
    for (const d of deployment) {
        d.preDeploymentGates = [
            `build:${d.componentId}`,
            ...tests.filter((t) => t.componentId === d.componentId).map((t) => t.id),
            ...security
                .filter((s) => s.componentIds.includes(d.componentId))
                .map((s) => s.id),
            ...(d.stage === "production" ? ["approval:production_deployment"] : []),
        ];
    }
    return {
        agentRequirements,
        build,
        tests,
        security,
        deployment,
        approvalRequirements: planApprovals(request, deployment),
    };
}
function planDeployments(request, build) {
    const out = [];
    for (const intent of request.deployments ?? []) {
        const stage = build.find((b) => b.componentId === intent.componentId);
        if (!stage)
            continue;
        out.push({
            id: `deploy:${intent.componentId}:${intent.targetType}:${intent.stage}`,
            componentId: intent.componentId,
            targetType: intent.targetType,
            stage: intent.stage,
            status: "planned",
            requiredArtifact: { ...stage.expectedArtifact },
            environmentRequirementId: stage.environmentRequirementId,
            ...(intent.credentialRef
                ? { credentialRef: { ...intent.credentialRef } }
                : {}),
            preDeploymentGates: [],
            rollbackRequired: intent.stage === "production" || intent.stage === "staging",
        });
    }
    return out;
}
function planApprovals(request, deployment) {
    const out = [];
    const production = deployment
        .filter((d) => d.stage === "production")
        .map((d) => d.id);
    if (production.length > 0) {
        out.push({
            id: "approval:production_deployment",
            reason: "production_deployment",
            subjectIds: production,
        });
    }
    if (request.constraints?.destructiveMigration) {
        out.push({
            id: "approval:destructive_migration",
            reason: "destructive_migration",
            subjectIds: [request.projectId],
        });
    }
    if (request.constraints?.privilegedInfrastructure) {
        out.push({
            id: "approval:privileged_infrastructure",
            reason: "privileged_infrastructure",
            subjectIds: [request.projectId],
        });
    }
    return out;
}
function unique(values) {
    return [...new Set(values)].sort();
}
