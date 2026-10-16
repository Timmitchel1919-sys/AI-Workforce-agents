/**
 * UI Layer 6 analytics — pure aggregations over AUTHORITATIVE records the
 * Control Plane already serves (agent counters, usage ledger, routing
 * decisions). Nothing is estimated or invented: every metric carries its
 * sample size, and anything without data stays `null` (UNKNOWN != ZERO).
 */
import { apiRequest } from "../../api/client";
import type { AgentListItem } from "../agents";
import type { UsageRecord } from "../costCenter/costCenterClient";
import type { RoutingDecision } from "../modelRouting/modelRoutingClient";

export interface ModelRegistryProfile {
  profileId: string;
  providerId: string;
  model: string | null;
  capabilities: string[];
  providerRegistered: boolean;
}

export type ModelRegistry =
  | { configured: false }
  | {
      configured: true;
      profiles: ModelRegistryProfile[];
      credentialStatus: "not_reported";
      pricing: "not_declared";
      benchmarks: "not_measured";
    };

export function getModelRegistry(accessToken?: string | null) {
  return apiRequest<ModelRegistry>("/api/intelligence/models", { accessToken });
}

/** Minimum sample before a rate is shown at all. */
export const MIN_SAMPLE = 5;

export interface Rate {
  /** null when there are no observations. */
  value: number | null;
  sample: number;
  /** true when 0 < sample < MIN_SAMPLE: shown, but flagged as low confidence. */
  lowSample: boolean;
}

export function rate(numerator: number, sample: number): Rate {
  return {
    value: sample > 0 ? numerator / sample : null,
    sample,
    lowSample: sample > 0 && sample < MIN_SAMPLE,
  };
}

export interface AgentPerformance {
  agentId: string;
  name: string;
  /** completed / (completed + failed) — tasks still running are excluded. */
  success: Rate;
  tasks: number;
}

export function agentPerformance(agents: readonly AgentListItem[]): AgentPerformance[] {
  return agents
    .map((a) => ({
      agentId: a.id,
      name: a.name,
      success: rate(a.completed, a.completed + a.failed),
      tasks: a.taskCount,
    }))
    .sort((x, y) => y.tasks - x.tasks || x.agentId.localeCompare(y.agentId));
}

export interface ModelUsage {
  key: string;
  provider: string;
  model: string;
  calls: number;
  /** null when no record reported tokens. */
  totalTokens: number | null;
  /** Sum of ACTUAL priced costs only. */
  pricedUsd: number;
  pricedCalls: number;
  unpricedCalls: number;
}

export function modelUsage(usage: readonly UsageRecord[]): ModelUsage[] {
  const map = new Map<string, ModelUsage>();
  for (const u of usage) {
    const key = `${u.provider}/${u.model}`;
    const m = map.get(key) ?? {
      key,
      provider: u.provider,
      model: u.model,
      calls: 0,
      totalTokens: null,
      pricedUsd: 0,
      pricedCalls: 0,
      unpricedCalls: 0,
    };
    m.calls += 1;
    if (typeof u.totalTokens === "number") m.totalTokens = (m.totalTokens ?? 0) + u.totalTokens;
    if (u.cost.priced) {
      m.pricedUsd += u.cost.amountUsd;
      m.pricedCalls += 1;
    } else {
      m.unpricedCalls += 1;
    }
    map.set(key, m);
  }
  return [...map.values()].sort((a, b) => b.calls - a.calls || a.key.localeCompare(b.key));
}

export interface RoutingSummary {
  decisions: number;
  selected: number;
  noModel: number;
  fallbacks: number;
  rejectionReasons: { reason: string; count: number }[];
  selections: { model: string; count: number }[];
}

export function routingSummary(decisions: readonly RoutingDecision[]): RoutingSummary {
  const reasons = new Map<string, number>();
  const selections = new Map<string, number>();
  let selected = 0;
  let fallbacks = 0;
  for (const d of decisions) {
    if (d.selectedProvider) {
      selected += 1;
      const k = `${d.selectedProvider}/${d.selectedModel ?? "(provider default)"}`;
      selections.set(k, (selections.get(k) ?? 0) + 1);
    }
    if (d.fallbackUsed) fallbacks += 1;
    for (const r of d.rejectedCandidates) reasons.set(r.reasonCode, (reasons.get(r.reasonCode) ?? 0) + 1);
  }
  const sorted = (m: Map<string, number>) => [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return {
    decisions: decisions.length,
    selected,
    noModel: decisions.length - selected,
    fallbacks,
    rejectionReasons: sorted(reasons).map(([reason, count]) => ({ reason, count })),
    selections: sorted(selections).map(([model, count]) => ({ model, count })),
  };
}

export type RecommendationKind = "agent_failure_rate" | "routing_no_model" | "unpriced_usage";

/** Advisory only: SUGGESTION != DECISION. Nothing here changes a policy. */
export interface Recommendation {
  kind: RecommendationKind;
  subject: string;
  /** Evidence numbers, rendered verbatim. */
  evidence: Record<string, number>;
  confidence: "low" | "medium";
}

export function recommendations(input: {
  performance: readonly AgentPerformance[];
  routing?: RoutingSummary;
  usage: readonly ModelUsage[];
}): Recommendation[] {
  const out: Recommendation[] = [];
  for (const p of input.performance) {
    if (p.success.value !== null && p.success.sample >= MIN_SAMPLE && p.success.value < 0.5) {
      out.push({
        kind: "agent_failure_rate",
        subject: p.name,
        evidence: { failed: Math.round((1 - p.success.value) * p.success.sample), sample: p.success.sample },
        confidence: p.success.sample >= 20 ? "medium" : "low",
      });
    }
  }
  if (input.routing && input.routing.decisions > 0 && input.routing.noModel > 0) {
    out.push({
      kind: "routing_no_model",
      subject: "routing",
      evidence: { noModel: input.routing.noModel, sample: input.routing.decisions },
      confidence: input.routing.decisions >= MIN_SAMPLE ? "medium" : "low",
    });
  }
  const unpriced = input.usage.reduce((n, u) => n + u.unpricedCalls, 0);
  const calls = input.usage.reduce((n, u) => n + u.calls, 0);
  if (unpriced > 0) {
    out.push({ kind: "unpriced_usage", subject: "cost", evidence: { unpriced, sample: calls }, confidence: "medium" });
  }
  return out;
}
