/**
 * Memory write policy: not every statement becomes memory.
 *
 * The decision depends on WHO proposes it (user / agent / system), the memory
 * TYPE, how it was verified, and whether the user explicitly confirmed it.
 * Agents and inferred findings produce DRAFT candidates for protected types;
 * only explicit user statements (or verified execution evidence) become ACTIVE.
 */
import type { MemoryConfidence, MemoryImportance, MemoryRetention, MemorySource, MemoryStatus, MemoryType } from "../../contracts/knowledge-memory.js";
export type ActorKind = "USER" | "AGENT" | "SYSTEM";
export interface Actor {
    id: string;
    kind: ActorKind;
    /** Administrators may write SYSTEM memory and revoke critical memory. */
    admin?: boolean;
    agentId?: string;
    agentRole?: string;
}
export declare class KnowledgeError extends Error {
    readonly code: "policy" | "not_found" | "invalid_state" | "access_denied" | "invalid_request";
    constructor(code: "policy" | "not_found" | "invalid_state" | "access_denied" | "invalid_request", message: string);
}
export interface MemoryProposal {
    type: MemoryType;
    title: string;
    content: string;
    projectId?: string;
    source: MemorySource;
    sourceRef?: string;
    sourceHash?: string;
    importance?: MemoryImportance;
    tags?: string[];
    references?: {
        kind: "file" | "document" | "execution" | "task" | "commit" | "memory" | "url";
        ref: string;
        note?: string;
    }[];
    retention?: MemoryRetention;
    expiresAt?: string;
    /** The user explicitly asked to remember / confirmed this. */
    explicit?: boolean;
    /** Backed by verified evidence (e.g. a recorded failing/passing command). */
    verified?: boolean;
    agentId?: string;
}
export interface WriteDecision {
    status: MemoryStatus;
    confidence: MemoryConfidence;
    importance: MemoryImportance;
    retention: MemoryRetention;
    expiresAt?: string;
    title: string;
    content: string;
    tags: string[];
    redacted: boolean;
    reason: string;
}
export declare const importanceRank: (i: MemoryImportance) => number;
export declare const confidenceRank: (c: MemoryConfidence) => number;
export declare function decideWrite(proposal: MemoryProposal, actor: Actor, now: number): WriteDecision;
