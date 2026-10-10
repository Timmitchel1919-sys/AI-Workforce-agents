import type { ProjectRepositoryRef } from "../../../contracts/index.js";
import { BaseProjectAdapter, type ProjectOperation } from "../project-adapter.js";
/** Stable, immutable internal identity of the AI Workforce project. */
export declare const AI_WORKFORCE_PROJECT_ID = "ai-workforce";
export declare const AI_WORKFORCE_DISPLAY_NAME = "AI Workforce";
/**
 * The authoritative repository REFERENCE for the AI Workforce project. Identity
 * only: no credential is stored here or anywhere in project metadata. Access
 * to the (possibly private) repository is a separate server-side integration.
 */
export declare const AI_WORKFORCE_REPOSITORY: ProjectRepositoryRef;
/**
 * Project adapter for the AI Workforce platform itself (the first internal
 * project). It REPRESENTS the project to the Control Plane and nothing more:
 *
 *  - it declares one read-only capability that returns static, safe identity;
 *  - it reads no files, runs no commands and touches no network;
 *  - it never instantiates a second Control Plane or triggers a build.
 *
 * PROJECT REGISTRATION != EXECUTION. Project state (tasks, workflows, agents,
 * environments) comes only from the real Control Plane registries.
 */
export declare class AiWorkforceProjectAdapter extends BaseProjectAdapter {
    readonly projectId = "ai-workforce";
    protected readonly displayName = "AI Workforce";
    protected readonly operations: Record<string, ProjectOperation>;
}
