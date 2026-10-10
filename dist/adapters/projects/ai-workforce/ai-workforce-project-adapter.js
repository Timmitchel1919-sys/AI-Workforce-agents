import { BaseProjectAdapter, } from "../project-adapter.js";
/** Stable, immutable internal identity of the AI Workforce project. */
export const AI_WORKFORCE_PROJECT_ID = "ai-workforce";
export const AI_WORKFORCE_DISPLAY_NAME = "AI Workforce";
/**
 * The authoritative repository REFERENCE for the AI Workforce project. Identity
 * only: no credential is stored here or anywhere in project metadata. Access
 * to the (possibly private) repository is a separate server-side integration.
 */
export const AI_WORKFORCE_REPOSITORY = Object.freeze({
    url: "https://github.com/Timmitchel1919-sys/AI-Workforce-agents",
    defaultBranch: "main",
});
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
export class AiWorkforceProjectAdapter extends BaseProjectAdapter {
    projectId = AI_WORKFORCE_PROJECT_ID;
    displayName = AI_WORKFORCE_DISPLAY_NAME;
    operations = {
        READ_PROJECT: {
            capability: {
                operation: "READ_PROJECT",
                description: "Read the AI Workforce project's identity and repository reference.",
                action: "read",
            },
            handler: () => ({
                projectId: AI_WORKFORCE_PROJECT_ID,
                name: AI_WORKFORCE_DISPLAY_NAME,
                description: "The AI Workforce platform: the Control Plane, agents, orchestration and UI in this repository.",
                repository: { ...AI_WORKFORCE_REPOSITORY },
            }),
        },
    };
}
