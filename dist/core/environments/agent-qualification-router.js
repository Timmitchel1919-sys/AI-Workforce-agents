import { EnvironmentRouter } from "./environment-router.js";
export class AgentQualificationRouter {
    router;
    constructor(registry) {
        this.router = new EnvironmentRouter(registry);
    }
    qualify(agent, requirement) {
        const capabilities = agent.capabilities;
        const requiredCapabilities = requirement.requiredCapabilities ?? [];
        for (const capability of requiredCapabilities) {
            if (!capabilities.includes(capability)) {
                return {
                    agentId: agent.id,
                    qualifies: false,
                    reason: `agent does not declare capability "${capability}"`,
                    matchedCapability: undefined,
                };
            }
        }
        if (requirement.environmentType !== undefined &&
            !capabilities.includes(requirement.environmentType) &&
            !capabilities.includes("*")) {
            return {
                agentId: agent.id,
                qualifies: false,
                reason: `agent does not declare environment type "${requirement.environmentType}"`,
                matchedCapability: undefined,
            };
        }
        if (requirement.descriptorId !== undefined &&
            !capabilities.includes(requirement.descriptorId) &&
            !capabilities.includes("*")) {
            return {
                agentId: agent.id,
                qualifies: false,
                reason: `agent does not declare descriptor "${requirement.descriptorId}"`,
                matchedCapability: undefined,
            };
        }
        return {
            agentId: agent.id,
            qualifies: true,
            reason: "agent declares all required capabilities",
            matchedCapability: requiredCapabilities[0],
        };
    }
    route(agent, requirement) {
        const qualification = this.qualify(agent, requirement);
        if (!qualification.qualifies) {
            return {
                outcome: "NOT_QUALIFIED",
                agentId: agent.id,
                reason: qualification.reason,
            };
        }
        const placement = this.router.route(requirement);
        switch (placement.outcome) {
            case "ROUTED":
                return {
                    outcome: "ROUTED",
                    agentId: agent.id,
                    instance: placement.instance,
                };
            case "REQUIRES_PROVISIONING":
                return {
                    outcome: "REQUIRES_PROVISIONING",
                    agentId: agent.id,
                    reason: placement.reason,
                };
            case "NO_AVAILABLE_ENVIRONMENT":
                return {
                    outcome: "NO_AVAILABLE_ENVIRONMENT",
                    agentId: agent.id,
                    reason: placement.reason,
                };
        }
    }
}
