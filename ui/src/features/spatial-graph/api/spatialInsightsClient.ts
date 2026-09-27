import { apiRequest } from "../../../api/client";
import {
  INSIGHT_KINDS,
  INSIGHT_LIMITATIONS,
  INSIGHT_RECOMMENDATIONS,
  INSIGHT_SEVERITIES,
  INSIGHT_VARIANTS,
  type InsightEvidence,
  type InsightRecommendation,
  type SpatialInsight,
  type SpatialInsightsReport,
} from "../../../../../contracts/graph";

/** Read-only: GET /api/projects/:id/insights. Nothing here can change anything. */
const API = "/api";
const RELATED = ["retry-task", "cancel-task", "cancel-execution", "approve", "reject"] as const;

const isOneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function readEvidence(v: unknown): InsightEvidence | null {
  if (!isObj(v) || typeof v.nodeId !== "string" || typeof v.label !== "string" || typeof v.state !== "string" || typeof v.status !== "string" || typeof v.nodeType !== "string") return null;
  return v as unknown as InsightEvidence;
}

function readRecommendation(v: unknown): InsightRecommendation | null {
  if (!isObj(v) || !isOneOf(INSIGHT_RECOMMENDATIONS, v.kind) || typeof v.targetNodeId !== "string") return null;
  // Only a known command LABEL is kept; anything else (or any extra field) is dropped.
  return {
    kind: v.kind,
    targetNodeId: v.targetNodeId,
    ...(isOneOf(RELATED, v.relatedCommand) ? { relatedCommand: v.relatedCommand } : {}),
  };
}

/** A finding the UI does not fully understand is dropped, never rendered half-trusted. */
export function readFinding(v: unknown): SpatialInsight | null {
  if (!isObj(v)) return null;
  if (!isOneOf(INSIGHT_KINDS, v.kind) || !isOneOf(INSIGHT_VARIANTS, v.variant) || !isOneOf(INSIGHT_SEVERITIES, v.severity)) return null;
  if (typeof v.id !== "string" || typeof v.subjectNodeId !== "string" || !isObj(v.params)) return null;
  const params: Record<string, string | number> = {};
  for (const [k, val] of Object.entries(v.params)) {
    if (typeof val === "string" || typeof val === "number") params[k] = val;
  }
  const evidence = (Array.isArray(v.evidence) ? v.evidence : []).map(readEvidence).filter((e): e is InsightEvidence => e !== null);
  // A finding without evidence is not a grounded finding.
  if (evidence.length === 0) return null;
  return {
    id: v.id,
    kind: v.kind,
    variant: v.variant,
    severity: v.severity,
    subjectNodeId: v.subjectNodeId,
    params,
    evidence,
    recommendations: (Array.isArray(v.recommendations) ? v.recommendations : []).map(readRecommendation).filter((r): r is InsightRecommendation => r !== null),
    limitations: (Array.isArray(v.limitations) ? v.limitations : []).filter((l): l is (typeof INSIGHT_LIMITATIONS)[number] => isOneOf(INSIGHT_LIMITATIONS, l)),
  };
}

/** Bound to the project that was asked for; a reply about anything else is rejected. */
export function assertInsights(value: unknown, projectId: string): SpatialInsightsReport {
  if (!isObj(value) || value.projectId !== projectId || value.basis !== "observed_state" || typeof value.graphRevision !== "number" || typeof value.generatedAt !== "string" || !Array.isArray(value.findings)) {
    throw new Error("The insights service returned an unexpected response.");
  }
  return {
    projectId,
    graphRevision: value.graphRevision,
    generatedAt: value.generatedAt,
    findings: value.findings.map(readFinding).filter((f): f is SpatialInsight => f !== null),
    truncated: value.truncated === true,
    ...(Array.isArray(value.unavailableSources) ? { unavailableSources: value.unavailableSources.filter((s): s is string => typeof s === "string") } : {}),
    ...(Array.isArray(value.inertCapabilities) ? { inertCapabilities: value.inertCapabilities.filter((s): s is string => typeof s === "string") } : {}),
    ...(Array.isArray(value.notConfiguredSources) ? { notConfiguredSources: value.notConfiguredSources.filter((s): s is string => typeof s === "string") } : {}),
    basis: "observed_state",
  };
}

export async function fetchSpatialInsights(projectId: string, accessToken?: string | null): Promise<SpatialInsightsReport> {
  const body = await apiRequest<unknown>(`${API}/projects/${encodeURIComponent(projectId)}/insights`, { method: "GET", accessToken });
  return assertInsights(body, projectId);
}
