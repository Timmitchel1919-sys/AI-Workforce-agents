/**
 * Built-in context sources (Phase 3).
 *
 * Every source reads EXISTING platform state through a narrow structural port
 * (Project Registry, ContextSystem, Knowledge repository, tasks, the
 * onboarding plan, the read-only repository reader). Nothing here duplicates
 * those systems and none of them can write. A source scopes its output to
 * `request.projectId`; the engine re-checks this defensively.
 */
import type { ContextCategory, ContextFragment, ContextRequest, ContextSource, RelevantFileResolver } from "../../contracts/prompt-intelligence.js";
import type { ContextSystem } from "../context/context-system.js";
import type { ProjectRegistry } from "../registry/project-registry.js";
import type { RepositorySourceReader } from "../onboarding/repository-source.js";
/** The security rules every prompt carries. Mandatory and never overridable. */
export declare class PlatformSecurityBaselineSource implements ContextSource {
    readonly id = "platform-security-baseline";
    readonly categories: readonly ContextCategory[];
    fetch(): readonly ContextFragment[];
}
/** Lowest-precedence defaults; any project fragment with the same key wins. */
export declare class PlatformDevelopmentDefaultsSource implements ContextSource {
    readonly id = "platform-development-defaults";
    readonly categories: readonly ContextCategory[];
    fetch(): readonly ContextFragment[];
}
export declare class ProjectRegistrySource implements ContextSource {
    private readonly registry;
    readonly id = "project-registry";
    readonly categories: readonly ContextCategory[];
    constructor(registry: ProjectRegistry);
    fetch(request: ContextRequest): readonly ContextFragment[];
}
/** Turns `namespace.key → value` entries into fragments for one project. */
export declare function fragmentsFromValues(projectId: string, values: Readonly<Record<string, unknown>>, source: string, origin: string, authority?: ContextFragment["authority"]): ContextFragment[];
/** Project configuration held in the platform `ContextSystem` (project-isolated). */
export declare class ProjectContextValuesSource implements ContextSource {
    private readonly contexts;
    readonly id = "project-context";
    readonly categories: readonly ContextCategory[];
    constructor(contexts: Pick<ContextSystem, "getProjectContext">);
    fetch(request: ContextRequest): readonly ContextFragment[];
}
/** A fixed, reviewed profile for one project (facts taken from its own repo docs). */
export declare class StaticProjectProfileSource implements ContextSource {
    readonly id: string;
    private readonly projectId;
    private readonly origin;
    private readonly values;
    readonly categories: readonly ContextCategory[];
    constructor(id: string, projectId: string, origin: string, values: Readonly<Record<string, unknown>>);
    fetch(request: ContextRequest): readonly ContextFragment[];
}
/**
 * The AI Workforce platform's own profile. Every fact is from AGENTS.md,
 * package.json, firebase.json or the shipped UI — nothing is inferred.
 */
export declare const AI_WORKFORCE_PROFILE: Readonly<Record<string, unknown>>;
export interface KnowledgeRecord {
    id: string;
    projectId?: string;
    type: string;
    title: string;
    body: string;
    tags: readonly string[];
    source?: string;
    updatedAt: string;
}
export interface KnowledgeReader {
    list(): readonly KnowledgeRecord[];
}
/** Approved Knowledge items (the existing Knowledge repository), per project. */
export declare class KnowledgeContextSource implements ContextSource {
    private readonly reader;
    readonly id = "knowledge";
    readonly categories: readonly ContextCategory[];
    constructor(reader: KnowledgeReader);
    fetch(request: ContextRequest): readonly ContextFragment[];
}
export interface TaskRecordLike {
    id: string;
    projectId: string;
    description: string;
    status: string;
    errors: readonly string[];
    objective?: string;
    requirements?: readonly string[];
    dependencies?: readonly string[];
    updatedAt: string;
}
export interface TaskReader {
    list(): readonly TaskRecordLike[];
}
/** Current task, its dependencies and recent failures — this project only. */
export declare class TaskContextSource implements ContextSource {
    private readonly tasks;
    readonly id = "task-history";
    readonly categories: readonly ContextCategory[];
    constructor(tasks: TaskReader);
    fetch(request: ContextRequest): readonly ContextFragment[];
}
export interface OnboardedProjectReader {
    get(projectId: string): Promise<{
        plan?: {
            technology?: {
                languages?: readonly {
                    value: string;
                }[];
                frameworks?: readonly {
                    value: string;
                }[];
                packageManagers?: readonly {
                    value: string;
                }[];
                testSystems?: readonly {
                    value: string;
                }[];
            };
            pipeline?: readonly {
                stage: string;
                status: string;
                command?: string;
            }[];
            deployment?: {
                targets?: readonly {
                    provider: string;
                }[];
            };
            git?: {
                defaultBranch?: string;
                testsRequired?: boolean;
                reviewRequired?: boolean;
            };
            secrets?: readonly {
                name: string;
            }[];
        };
    } | undefined>;
}
/** Facts the onboarding discovery established (evidence-based, derived). */
export declare class OnboardedProjectSource implements ContextSource {
    private readonly reader;
    readonly id = "onboarding-plan";
    readonly categories: readonly ContextCategory[];
    constructor(reader: OnboardedProjectReader);
    fetch(request: ContextRequest): Promise<readonly ContextFragment[]>;
}
/**
 * Finds likely-relevant files in the project's bound repository using the
 * READ-ONLY repository reader. It never clones, writes or executes anything,
 * and says so honestly when the repository cannot be read.
 */
export declare class RepositoryFileResolver implements RelevantFileResolver {
    private readonly registry;
    private readonly reader;
    private readonly options;
    private readonly cache;
    constructor(registry: ProjectRegistry, reader: RepositorySourceReader, options?: {
        ttlMs?: number;
        limit?: number;
        now?: () => number;
    });
    resolve(projectId: string, keywords: readonly string[]): Promise<{
        ok: false;
        note: string;
    } | {
        note?: string | undefined;
        ok: true;
        files: string[];
    }>;
}
