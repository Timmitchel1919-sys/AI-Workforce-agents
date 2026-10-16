/**
 * UI Layer 4 Workflow Studio read models. Everything here is derived from the
 * REAL registries (agents, tools, operational enable flags) — the palette never
 * lists a capability the platform does not have.
 */
import { type Agent, type WorkflowCapabilityContext, type WorkflowNodeKind, type UnavailableWorkflowNodeKind } from "../../contracts/index.js";
export interface CapabilitySources {
    agents: {
        list(): Agent[];
    };
    tools: {
        list(): {
            id: string;
            name?: string;
        }[];
    };
    isAgentEnabled: (agentId: string, projectId: string) => boolean;
}
/** Agents usable on this project: allowed for it AND operationally enabled. */
export declare function workflowCapabilityContext(sources: CapabilitySources, projectId: string): WorkflowCapabilityContext;
export interface WorkflowStudioCatalog {
    projectId: string;
    nodeKinds: {
        kind: WorkflowNodeKind;
        backing: string;
    }[];
    unavailableNodeKinds: {
        kind: UnavailableWorkflowNodeKind;
        reason: string;
    }[];
    agents: {
        agentId: string;
        name: string;
        capabilities: readonly string[];
        supportedTaskTypes: readonly string[];
        allowedTools: readonly string[];
        usableOnProject: boolean;
    }[];
    tools: {
        toolId: string;
        name: string;
    }[];
    modes: {
        design: true;
        validation: true;
        simulation: true;
        dryRun: {
            available: false;
            reason: string;
        };
        liveExecution: {
            available: false;
            reason: string;
        };
    };
}
export declare function workflowStudioCatalog(sources: CapabilitySources, projectId: string): WorkflowStudioCatalog;
