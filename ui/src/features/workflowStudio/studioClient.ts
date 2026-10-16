/**
 * Workflow Studio client (UI Layer 4). Same-origin Control Plane only.
 * Reads are project-scoped; every write is a typed, audited command the
 * server validates and authorizes. There is no execute call: live launch is
 * withheld by the backend and reported as such.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../api/client";
import { ApiError } from "../../api/errors";
import { useAuth } from "../../auth/useAuth";

export type WorkflowNodeKind = "trigger" | "agent_task" | "approval" | "terminal";
export type UnavailableNodeKind = "model" | "tool" | "condition" | "data" | "review" | "notification";

export interface WorkflowNodeConfig {
  taskType?: string;
  agentId?: string;
  capability?: string;
  expectedTools?: string[];
  acceptanceCriteria?: string[];
  approvalAction?: string;
}

export interface WorkflowNode {
  id: string;
  kind: WorkflowNodeKind;
  label: string;
  description?: string;
  config: WorkflowNodeConfig;
  position: { x: number; y: number };
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface ValidationIssue {
  code: string;
  severity: "error" | "warning";
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface WorkflowDefinition {
  definitionId: string;
  projectId: string;
  name: string;
  description: string;
  status: "draft" | "published" | "archived";
  draft: WorkflowGraph;
  draftRevision: number;
  lastValidation?: { valid: boolean; issues: ValidationIssue[]; draftRevision: number; validatedAt: string };
  latestPublishedVersion?: number;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
}

export interface WorkflowVersion {
  definitionId: string;
  projectId: string;
  version: number;
  name: string;
  graph: WorkflowGraph;
  graphHash: string;
  draftRevision: number;
  publishedAt: string;
  publishedBy: string;
}

export interface StudioCatalog {
  projectId: string;
  nodeKinds: { kind: WorkflowNodeKind; backing: string }[];
  unavailableNodeKinds: { kind: UnavailableNodeKind; reason: string }[];
  agents: {
    agentId: string;
    name: string;
    capabilities: string[];
    supportedTaskTypes: string[];
    allowedTools: string[];
    usableOnProject: boolean;
  }[];
  tools: { toolId: string; name: string }[];
  modes: {
    dryRun: { available: false; reason: string };
    liveExecution: { available: false; reason: string };
  };
}

export interface SimulationStep {
  order: number;
  nodeId: string;
  kind: WorkflowNodeKind;
  outcome: "would_start" | "would_dispatch" | "would_wait_for_approval" | "would_complete" | "blocked";
  resolvedAgentId?: string;
  detail: string;
}

export interface Simulation {
  mode: "simulation";
  sideEffectFree: true;
  source: "draft" | number;
  valid: boolean;
  steps: SimulationStep[];
  issues: ValidationIssue[];
  simulatedAt: string;
}

export type StudioCommand =
  | "save-workflow-draft"
  | "validate-workflow"
  | "publish-workflow"
  | "archive-workflow"
  | "restore-workflow-version"
  | "duplicate-workflow";

export interface CommandResult {
  ok: boolean;
  reason: string;
  resourceId?: string;
  details: { draftRevision?: number; valid?: boolean; version?: number; status?: string };
}

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}`;

export function getCatalog(projectId: string, accessToken?: string | null) {
  return apiRequest<StudioCatalog>(`${base(projectId)}/workflow-studio/catalog`, { accessToken });
}

export function listDefinitions(projectId: string, accessToken?: string | null) {
  return apiRequest<{ items: WorkflowDefinition[]; total: number }>(`${base(projectId)}/workflow-definitions`, {
    accessToken,
  });
}

export function getDefinition(projectId: string, definitionId: string, accessToken?: string | null) {
  return apiRequest<{ definition: WorkflowDefinition; versions: WorkflowVersion[] }>(
    `${base(projectId)}/workflow-definitions/${encodeURIComponent(definitionId)}`,
    { accessToken },
  );
}

export function getSimulation(
  projectId: string,
  definitionId: string,
  source: "draft" | number,
  accessToken?: string | null,
) {
  return apiRequest<Simulation>(
    `${base(projectId)}/workflow-definitions/${encodeURIComponent(definitionId)}/simulation?source=${encodeURIComponent(String(source))}`,
    { accessToken },
  );
}

export function runStudioCommand(command: StudioCommand, body: Record<string, unknown>, accessToken?: string | null) {
  return apiRequest<CommandResult>(`/api/commands/${command}`, {
    method: "POST",
    accessToken,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Operator-safe message for a failed request. */
export function studioErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.reason ?? error.message;
  return error instanceof Error ? error.message : String(error);
}

const keys = {
  catalog: (p: string) => ["workflowStudio", p, "catalog"] as const,
  list: (p: string) => ["workflowStudio", p, "list"] as const,
  detail: (p: string, d: string) => ["workflowStudio", p, "detail", d] as const,
};

export function useStudioCatalog(projectId: string | null) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: keys.catalog(projectId ?? ""),
    queryFn: () => getCatalog(projectId!, accessToken),
    enabled: Boolean(projectId),
    retry: false,
    staleTime: 30_000,
  });
}

export function useWorkflowDefinitions(projectId: string | null) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: keys.list(projectId ?? ""),
    queryFn: () => listDefinitions(projectId!, accessToken),
    enabled: Boolean(projectId),
    retry: false,
  });
}

export function useWorkflowDefinition(projectId: string | null, definitionId: string | null) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: keys.detail(projectId ?? "", definitionId ?? ""),
    queryFn: () => getDefinition(projectId!, definitionId!, accessToken),
    enabled: Boolean(projectId && definitionId),
    retry: false,
  });
}

export function useStudioCommand(projectId: string | null) {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ command, body }: { command: StudioCommand; body: Record<string, unknown> }) =>
      runStudioCommand(command, { projectId, ...body }, accessToken),
    onSettled: () => client.invalidateQueries({ queryKey: ["workflowStudio", projectId ?? ""] }),
  });
}
