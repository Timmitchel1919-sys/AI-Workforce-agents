export const EXECUTION_UNAVAILABLE_REASON = "Plan execution is not available yet (EO-4). Planning only.";
export function executionPlanSummaryView(plan, current) {
    return {
        id: plan.id,
        planId: plan.planId,
        version: plan.version,
        projectId: plan.projectId,
        title: plan.request.title,
        status: plan.status,
        current,
        blockerCodes: plan.blockers.map((b) => b.code),
        environmentCount: plan.environments.length,
        approvalState: plan.approval.state,
        createdBy: plan.createdBy,
        createdAt: plan.createdAt,
        updatedAt: plan.updatedAt,
        ...(plan.supersededBy ? { supersededBy: plan.supersededBy } : {}),
    };
}
export function executionPlanView(plan, current) {
    const { deployment, request, ...rest } = plan;
    return {
        ...rest,
        request: {
            ...request,
            ...(request.deployments
                ? {
                    deployments: request.deployments.map(({ credentialRef, ...intent }) => ({
                        ...intent,
                        ...(credentialRef
                            ? {
                                credentialRef: {
                                    kind: credentialRef.kind,
                                    ref: "[reference]",
                                },
                            }
                            : {}),
                    })),
                }
                : {}),
        },
        current,
        deployment: deployment.map(({ credentialRef, ...d }) => ({
            ...d,
            ...(credentialRef ? { credentialRef: { kind: credentialRef.kind } } : {}),
        })),
        execution: { available: false, reason: EXECUTION_UNAVAILABLE_REASON },
    };
}
