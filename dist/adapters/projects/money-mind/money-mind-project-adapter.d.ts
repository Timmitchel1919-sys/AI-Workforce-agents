import type { ProjectOperation } from "../project-adapter.js";
import { BaseProjectAdapter } from "../project-adapter.js";
import type { MoneyMindRepoPort } from "./money-mind-repo-port.js";
export interface MoneyMindProjectAdapterOptions {
    repo: MoneyMindRepoPort;
    repositoryUrl?: string;
    commandTimeoutMs?: number;
}
export declare class MoneyMindProjectAdapter extends BaseProjectAdapter {
    readonly projectId = "money-mind";
    protected readonly displayName = "Money Mind";
    protected readonly operations: Record<string, ProjectOperation>;
    private readonly repo;
    private readonly repositoryUrl;
    private readonly commandTimeoutMs;
    private readonly maxFileChars;
    private readonly maxOutputChars;
    private readonly defaultInspectDepth;
    private readonly maxInspectDepth;
    private readonly maxInspectEntries;
    constructor(options: MoneyMindProjectAdapterOptions);
    private readProject;
    private readStatus;
    private readTestResults;
    private readConfiguration;
    private readFile;
    private runTests;
    private inspectStructure;
    private readDocumentation;
    private readPackageJsonSummary;
    private readFeatureFlagNames;
}
