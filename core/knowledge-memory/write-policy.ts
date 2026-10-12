/**
 * Memory write policy: not every statement becomes memory.
 *
 * The decision depends on WHO proposes it (user / agent / system), the memory
 * TYPE, how it was verified, and whether the user explicitly confirmed it.
 * Agents and inferred findings produce DRAFT candidates for protected types;
 * only explicit user statements (or verified execution evidence) become ACTIVE.
 */
import type {
  MemoryConfidence,
  MemoryImportance,
  MemoryRetention,
  MemorySource,
  MemoryStatus,
  MemoryType,
} from "../../contracts/knowledge-memory.js";
import { KNOWLEDGE_LIMITS } from "../../contracts/knowledge-memory.js";
import {
  containsSecret,
  maskSecrets,
} from "../prompt-intelligence/secret-scan.js";

export type ActorKind = "USER" | "AGENT" | "SYSTEM";
export interface Actor {
  id: string;
  kind: ActorKind;
  /** Administrators may write SYSTEM memory and revoke critical memory. */
  admin?: boolean;
  agentId?: string;
  agentRole?: string;
}

export class KnowledgeError extends Error {
  constructor(
    readonly code:
      | "policy"
      | "not_found"
      | "invalid_state"
      | "access_denied"
      | "invalid_request",
    message: string,
  ) {
    super(message);
    this.name = "KnowledgeError";
  }
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
    kind:
      "file" | "document" | "execution" | "task" | "commit" | "memory" | "url";
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

const PROTECTED: readonly MemoryType[] = [
  "SYSTEM",
  "PROJECT",
  "ARCHITECTURAL",
  "USER_PREFERENCE",
];
const HEDGE =
  /\b(i think|i guess|maybe|might be|might|perhaps|probably|possibly|not sure|could be|ik denk|misschien|mogelijk|waarschijnlijk)\b/i;
const DAY = 86_400_000;

export const importanceRank = (i: MemoryImportance): number =>
  ["LOW", "NORMAL", "HIGH", "CRITICAL"].indexOf(i);
export const confidenceRank = (c: MemoryConfidence): number =>
  [
    "UNVERIFIED",
    "INFERRED",
    "AGENT_GENERATED",
    "SYSTEM_GENERATED",
    "USER_CONFIRMED",
    "VERIFIED",
  ].indexOf(c);

export function decideWrite(
  proposal: MemoryProposal,
  actor: Actor,
  now: number,
): WriteDecision {
  const reject = (message: string): never => {
    throw new KnowledgeError("policy", message);
  };
  const title = (proposal.title ?? "").trim();
  let content = (proposal.content ?? "").trim();
  if (title === "") reject("a memory needs a title");
  if (content === "") reject("a memory needs content");
  if (title.length > KNOWLEDGE_LIMITS.maxTitle) reject("the title is too long");
  if (content.length > KNOWLEDGE_LIMITS.maxContent)
    reject("the content is too long");
  if (proposal.type !== "SYSTEM" && !proposal.projectId)
    reject("a memory must belong to a project");
  if (proposal.type === "SYSTEM" && proposal.projectId)
    reject("SYSTEM memory is platform-wide and has no project");

  // Secrets never persist: redact; if nothing meaningful is left, block.
  let redacted = false;
  let cleanTitle = title;
  if (containsSecret(content) || containsSecret(title)) {
    content = maskSecrets(content);
    cleanTitle = maskSecrets(title);
    redacted = true;
    const remaining = content
      .replace(/\[masked\]/gi, "")
      .replace(/[A-Za-z_][\w.-]*\s*[:=]\s*/g, "")
      .trim();
    if (remaining.length < 20)
      reject("the content is only a secret and was blocked");
  }

  const importanceIn = proposal.importance ?? "NORMAL";
  let status: MemoryStatus;
  let confidence: MemoryConfidence;
  let importance: MemoryImportance = importanceIn;
  let reason: string;

  switch (actor.kind) {
    case "USER": {
      if (proposal.type === "SYSTEM" && !actor.admin)
        reject("only an administrator may write SYSTEM memory");
      if (proposal.explicit === false) {
        status = "DRAFT";
        confidence = "UNVERIFIED";
        reason = "saved as a draft: not explicitly confirmed";
      } else {
        status = "ACTIVE";
        confidence = "USER_CONFIRMED";
        reason = "explicitly provided by the user";
      }
      break;
    }
    case "AGENT": {
      if (proposal.type === "SYSTEM")
        reject("an agent may not write trusted system memory");
      if (proposal.type === "USER_PREFERENCE")
        reject("preferences are only stored when the user states them");
      if (PROTECTED.includes(proposal.type) && HEDGE.test(content))
        reject("tentative statements are not stored as memory");
      if (proposal.type === "AGENT") {
        if (!actor.agentId && !proposal.agentId)
          reject("agent memory needs an agent id");
        status = "ACTIVE";
        confidence = "AGENT_GENERATED";
        reason = "agent working memory (visible to that agent only)";
      } else if (proposal.type === "EXECUTION" && proposal.verified) {
        status = "ACTIVE";
        confidence = "VERIFIED";
        reason = "backed by verified execution evidence";
      } else {
        status = "DRAFT";
        confidence = "AGENT_GENERATED";
        reason = "agent suggestion: a candidate until the user confirms it";
      }
      break;
    }
    case "SYSTEM": {
      if (proposal.type === "USER_PREFERENCE")
        reject("preferences are only stored when the user states them");
      if (proposal.type === "EXECUTION" && proposal.verified) {
        status = "ACTIVE";
        confidence = "VERIFIED";
        reason = "backed by verified execution evidence";
      } else if (proposal.type === "DOCUMENT" || proposal.type === "PROJECT") {
        status = proposal.verified === false ? "DRAFT" : "ACTIVE";
        confidence = "SYSTEM_GENERATED";
        reason = "generated from project sources";
      } else {
        status = "DRAFT";
        confidence = proposal.type === "EXECUTION" ? "UNVERIFIED" : "INFERRED";
        reason = "system finding: a candidate until the user confirms it";
      }
      // The system never decides architecture or rules on its own authority.
      if (proposal.type === "ARCHITECTURAL" || proposal.type === "SYSTEM")
        status = "DRAFT";
      break;
    }
  }

  if (importanceRank(importance) >= importanceRank("CRITICAL")) {
    if (actor.kind !== "USER" || proposal.explicit === false)
      importance = "HIGH";
  }

  let retention: MemoryRetention =
    proposal.retention ??
    (proposal.type === "EXECUTION" || proposal.type === "AGENT"
      ? "TEMPORARY"
      : "PERMANENT");
  if (
    proposal.type === "EXECUTION" &&
    importanceRank(importance) >= importanceRank("HIGH")
  )
    retention = proposal.retention ?? "PERMANENT";
  let expiresAt: string | undefined;
  if (retention === "TEMPORARY") {
    expiresAt =
      proposal.expiresAt ??
      new Date(
        now + (proposal.type === "AGENT" ? 90 : 180) * DAY,
      ).toISOString();
  }
  if (proposal.type === "ARCHITECTURAL" || proposal.type === "SYSTEM") {
    retention = "PERMANENT";
    expiresAt = undefined;
  }

  const tags = [
    ...new Set(
      (proposal.tags ?? []).map((t) => t.toLowerCase().trim()).filter(Boolean),
    ),
  ].slice(0, KNOWLEDGE_LIMITS.maxTags);
  if (redacted) tags.push("redacted");
  return {
    status,
    confidence,
    importance,
    retention,
    ...(expiresAt ? { expiresAt } : {}),
    title: cleanTitle,
    content,
    tags,
    redacted,
    reason,
  };
}
