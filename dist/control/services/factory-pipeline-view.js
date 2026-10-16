export const FACTORY_STAGES = [
    "mission_intake",
    "requirements_analysis",
    "planning",
    "agent_model_selection",
    "environment_allocation",
    "implementation",
    "testing",
    "code_review",
    "security_review",
    "build",
    "pull_request",
    "human_approval",
    "deployment",
    "production_verification",
];
export function factoryPipeline(ctx) {
    const release = ctx.releaseCapabilities;
    const families = ctx.environmentAdapters?.status() ?? [];
    const runnerAvailable = families.some((f) => f.realRunners > 0 && (f.status === "available" || f.status === "busy"));
    const s = (stage, mode, reason) => ({
        stage,
        mode,
        reason,
    });
    const stages = [
        ctx.softwareFactory
            ? s("mission_intake", "manual", "operator_authors_program")
            : s("mission_intake", "not_configured", "software_factory_not_composed"),
        s("requirements_analysis", "manual", "operator_defines_objective_and_acceptance"),
        ctx.planning
            ? s("planning", "automated", "deterministic_execution_planner")
            : s("planning", "not_configured", "planner_not_composed"),
        ctx.routing && ctx.specialist
            ? s("agent_model_selection", "automated", "registry_assignment_and_model_router")
            : ctx.routing
                ? s("agent_model_selection", "automated", "model_router_only")
                : s("agent_model_selection", "not_configured", "router_not_composed"),
        runnerAvailable
            ? s("environment_allocation", "automated", "runner_routing")
            : s("environment_allocation", "unavailable", "no_real_runner_online"),
        runnerAvailable
            ? s("implementation", "automated", "governed_execution_session")
            : s("implementation", "unavailable", "no_real_runner_online"),
        release?.verification
            ? s("testing", "automated", "verification_service")
            : s("testing", "unavailable", "no_verification_sandbox"),
        release
            ? s("code_review", "manual", "operator_review_change")
            : s("code_review", "not_configured", "release_pipeline_not_composed"),
        s("security_review", "not_configured", "no_security_review_capability"),
        release?.verification
            ? s("build", "automated", "verification_service")
            : s("build", "unavailable", "no_verification_sandbox"),
        release?.sourceControl
            ? s("pull_request", "awaiting_approval", "governed_commit_push")
            : s("pull_request", "unavailable", "no_governed_git"),
        s("human_approval", "awaiting_approval", "approval_system"),
        release && release.deploymentAdapters.length > 0
            ? s("deployment", "awaiting_approval", "approval_gated_deploy")
            : s("deployment", "unavailable", "no_deployment_adapter"),
        release && release.deploymentAdapters.length > 0
            ? s("production_verification", "automated", "post_deploy_verification")
            : s("production_verification", "unavailable", "no_deployment_adapter"),
    ];
    return {
        stages,
        runners: families.map((f) => ({
            family: f.family,
            status: f.status,
            realRunners: f.realRunners,
        })),
    };
}
