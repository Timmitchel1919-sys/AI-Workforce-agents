import { type GovernedGitPort, type StageSetFile } from "../../contracts/index.js";
export interface GovernedRepositoryConfig {
    projectId: string;
    repositoryId: string;
    /** Host path of the working tree (trusted configuration only). */
    localPath: string;
    remote: {
        remoteId: string;
        /** https URL or an absolute local bare-repository path (tests/mirrors). */
        url: string;
    };
}
export interface GovernedGitAdapterOptions {
    gitPath: string;
    /** Directory used as HOME for git (no user/global configuration). */
    stateRoot: string;
    repositories: readonly GovernedRepositoryConfig[];
    timeoutMs?: number;
}
export declare class GovernedGitAdapter implements GovernedGitPort {
    private readonly options;
    private readonly repos;
    constructor(options: GovernedGitAdapterOptions);
    private repo;
    remoteId(projectId: string): string;
    private git;
    head(projectId: string): Promise<{
        sha?: string;
        branch?: string;
    }>;
    commit(projectId: string, input: {
        files: readonly StageSetFile[];
        message: string;
        identity: {
            name: string;
            email: string;
        };
        expectedHead?: string;
    }): Promise<{
        sha: string;
        parentSha?: string;
        files: readonly string[];
    }>;
    readCommit(projectId: string, sha: string): Promise<{
        sha: string;
        parents: readonly string[];
        files: readonly string[];
    } | undefined>;
    remoteHead(projectId: string, branch: string, credential?: string): Promise<string | undefined>;
    push(projectId: string, input: {
        branch: string;
        commitSha: string;
        credential?: string;
    }): Promise<"pushed" | "up_to_date">;
}
