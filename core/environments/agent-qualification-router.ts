/**
 * AgentQualificationRouter — intentionally SEPARATED from environment routing.
 *
 * Qualification asks "does this agent DECLARE the capability to do the task?";
 * environment placement asks "is a real, usable environment installed?". The
 * two must not blur: a qualified agent with no environment is
 * `REQUIRES_PROVISIONING`, never a fabricated success, and an unqualified
 * agent is rejected even when an environment is available.
 */
import {
  type Agent,
  type AgentQualificationResult,
  type AgentRouteResult,
  type CapabilityId,
  type EnvironmentRequirement,
} from "../../contracts/index.js";
import { EnvironmentRegistry } from "./environment-registry.js";
import { EnvironmentRouter } from "./environment-router.js";

export class AgentQualificationRouter {
  private readonly router: EnvironmentRouter;

  constructor(registry: EnvironmentRegistry) {
    this.router = new EnvironmentRouter(registry);
  }

  qualify(
    agent: Agent,
    requirement: EnvironmentRequirement,
  ): AgentQualificationResult {
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

    if (
      requirement.environmentType !== undefined &&
      !capabilities.includes(requirement.environmentType) &&
      !capabilities.includes("*")
    ) {
      return {
        agentId: agent.id,
        qualifies: false,
        reason: `agent does not declare environment type "${requirement.environmentType}"`,
        matchedCapability: undefined,
      };
    }

    if (
      requirement.descriptorId !== undefined &&
      !capabilities.includes(requirement.descriptorId) &&
      !capabilities.includes("*")
    ) {
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
      matchedCapability: requiredCapabilities[0] as CapabilityId | undefined,
    };
  }

  route(agent: Agent, requirement: EnvironmentRequirement): AgentRouteResult {
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
