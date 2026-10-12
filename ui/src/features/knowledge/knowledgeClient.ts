/**
 * Knowledge module over the same-origin Control Plane API. The browser never
 * reads Firestore; the Control Plane authorizes, validates, scopes by project
 * and audits every write.
 */
import { apiRequest } from "../../api/client";
import { ApiError } from "../../api/errors";

export const KNOWLEDGE_ITEM_TYPES = [
  "project_knowledge",
  "technical_documentation",
  "architecture",
  "decision",
  "requirement",
  "note",
] as const;

export type KnowledgeItemType = (typeof KNOWLEDGE_ITEM_TYPES)[number];

export interface KnowledgeItem {
  id: string;
  knowledgeId: string;
  projectId?: string;
  type: KnowledgeItemType;
  title: string;
  body: string;
  tags: string[];
  source?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateKnowledgeInput {
  projectId?: string;
  type: KnowledgeItemType;
  title: string;
  body: string;
  tags?: string[];
  source?: string;
}

export interface UpdateKnowledgeInput {
  type?: KnowledgeItemType;
  title?: string;
  body?: string;
  tags?: string[];
  source?: string;
}

export interface KnowledgeFilter {
  projectId?: string;
  type?: KnowledgeItemType;
  search?: string;
}

export type KnowledgeFailure =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "invalid"
  | "unavailable";

export class KnowledgeError extends Error {
  readonly failure: KnowledgeFailure;
  constructor(failure: KnowledgeFailure, message: string) {
    super(message);
    this.name = "KnowledgeError";
    this.failure = failure;
  }
}

function toError(error: unknown): KnowledgeError {
  if (error instanceof ApiError) {
    const failure: KnowledgeFailure =
      error.status === 401
        ? "unauthenticated"
        : error.status === 403
          ? "forbidden"
          : error.status === 404
            ? "not_found"
            : error.status === 409
              ? "conflict"
              : error.status === 400
                ? "invalid"
                : "unavailable";
    return new KnowledgeError(failure, error.message);
  }
  return new KnowledgeError("unavailable", "Control Plane unreachable");
}

async function call<T>(
  path: string,
  token: string | null | undefined,
  init: RequestInit = {},
): Promise<T> {
  try {
    return await apiRequest<T>(path, {
      method: "GET",
      ...init,
      accessToken: token,
    });
  } catch (error) {
    throw toError(error);
  }
}

export function getKnowledgeItems(
  filter: KnowledgeFilter,
  token?: string | null,
) {
  const params = new URLSearchParams();
  if (filter.projectId) params.set("projectId", filter.projectId);
  if (filter.type) params.set("type", filter.type);
  if (filter.search?.trim()) params.set("search", filter.search.trim());
  const qs = params.toString();
  return call<{ items: KnowledgeItem[]; total: number }>(
    `/api/knowledge-items${qs ? `?${qs}` : ""}`,
    token,
  );
}

export function getKnowledgeItem(knowledgeId: string, token?: string | null) {
  return call<KnowledgeItem>(
    `/api/knowledge-items/${encodeURIComponent(knowledgeId)}`,
    token,
  );
}

export function createKnowledge(
  input: CreateKnowledgeInput,
  token?: string | null,
) {
  return call<KnowledgeItem>("/api/knowledge-items", token, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateKnowledge(
  knowledgeId: string,
  input: UpdateKnowledgeInput,
  token?: string | null,
) {
  return call<KnowledgeItem>(
    `/api/knowledge-items/${encodeURIComponent(knowledgeId)}`,
    token,
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
}
