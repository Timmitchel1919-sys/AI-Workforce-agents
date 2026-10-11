/**
 * Agent, model and tool trust.
 *
 * Agents default to TRUSTED while enabled (the operational enable/disable store
 * stays the switch for DISABLED); a SUSPENDED / DISABLED agent cannot execute
 * anything. Models carry data-handling policy: an external provider has a
 * maximum data class it may receive. Tools carry risk, environments, allowed
 * agents and approval rules; the built-in catalog mirrors the Layer 5 tools.
 */
import {
  GOV_ENVIRONMENTS,
  type AgentTrustRecord,
  type DataClass,
  type GovEnvironment,
  type ModelTrustRecord,
  type GovRisk,
  type ToolTrustRecord,
  type TrustState,
} from "../../contracts/security-governance.js";
import { RUNTIME_TOOLS } from "../execution-runtime/tools.js";
import type { Repository } from "../../contracts/persistence.js";
import { dataClassRank } from "./resources.js";

export interface TrustRepos {
  agents: Repository<AgentTrustRecord>;
  models: Repository<ModelTrustRecord>;
  tools: Repository<ToolTrustRecord>;
}

const RISK: Record<"low" | "medium" | "high", GovRisk> = {
  low: "LOW",
  medium: "MEDIUM",
  high: "HIGH",
};

function builtinTools(at: string): ToolTrustRecord[] {
  const deploy: ToolTrustRecord = {
    id: "deploy.handoff",
    toolId: "deploy.handoff",
    name: "Deployment hand-off",
    capabilities: ["deployment.firebase"],
    risk: "HIGH",
    permissions: [],
    environments: ["DEVELOPMENT", "TEST", "STAGING", "PRODUCTION"],
    allowedAgents: ["*"],
    approval: "HIGH_RISK",
    securityRequirements: ["environment-aware approval"],
    status: "ENABLED",
    updatedAt: at,
    updatedBy: "system",
  };
  return [
    deploy,
    ...RUNTIME_TOOLS.map((t) => ({
      id: t.id,
      toolId: t.id,
      name: t.name,
      capabilities: [t.capability],
      risk: RISK[t.risk],
      permissions: [...t.permissions],
      environments: ["DEVELOPMENT", "TEST", "STAGING"] as GovEnvironment[],
      allowedAgents: ["*"],
      approval: (t.risk === "high"
        ? "HIGH_RISK"
        : "NONE") as ToolTrustRecord["approval"],
      securityRequirements: t.id === "repo.delete" ? ["task approval"] : [],
      status: "ENABLED" as const,
      updatedAt: at,
      updatedBy: "system",
    })),
  ];
}

export class TrustRegistry {
  constructor(
    private readonly repos: TrustRepos,
    private readonly clock: () => string,
    private readonly isAgentEnabled?: (agentId: string) => boolean,
  ) {}

  /* ---- agents ---- */

  agentState(agentId: string): TrustState {
    if (this.isAgentEnabled && !this.isAgentEnabled(agentId)) return "DISABLED";
    return this.repos.agents.findById(agentId)?.state ?? "TRUSTED";
  }

  agentRecord(agentId: string): AgentTrustRecord {
    return (
      this.repos.agents.findById(agentId) ?? {
        id: agentId,
        agentId,
        state: "TRUSTED",
        riskLevel: "LOW",
        updatedAt: this.clock(),
        updatedBy: "default",
        history: [],
      }
    );
  }

  listAgents(knownAgentIds: readonly string[] = []): AgentTrustRecord[] {
    const out = new Map<string, AgentTrustRecord>();
    for (const id of knownAgentIds) out.set(id, this.agentRecord(id));
    for (const r of this.repos.agents.list()) out.set(r.agentId, r);
    return [...out.values()].map((r) => ({
      ...r,
      state: this.agentState(r.agentId),
    }));
  }

  /** True when the agent must not execute anything. */
  isBlocked(agentId: string): boolean {
    const s = this.agentState(agentId);
    return s === "SUSPENDED" || s === "DISABLED";
  }

  setAgentState(
    agentId: string,
    state: TrustState,
    by: string,
    reason?: string,
    risk?: GovRisk,
  ): AgentTrustRecord {
    const cur = this.agentRecord(agentId);
    const next: AgentTrustRecord = {
      ...cur,
      state,
      riskLevel: risk ?? cur.riskLevel,
      ...(reason ? { reason } : {}),
      updatedAt: this.clock(),
      updatedBy: by,
      history: [
        ...cur.history,
        { state, at: this.clock(), by, ...(reason ? { reason } : {}) },
      ].slice(-50),
    };
    this.repos.agents.upsert(next);
    return next;
  }

  /* ---- models ---- */

  private defaultModel(provider: string, model: string): ModelTrustRecord {
    const external = provider.toLowerCase() !== "local";
    return {
      id: `${provider}/${model}`,
      provider,
      model,
      riskClass: external ? "MEDIUM" : "LOW",
      approvedTaskTypes: ["*"],
      maxDataClass: external ? "CONFIDENTIAL" : "RESTRICTED",
      external,
      dataHandling: external
        ? "External provider: project source (up to CONFIDENTIAL) may be sent; RESTRICTED data such as security rules and any secret are never sent."
        : "Local model: data does not leave the machine.",
      status: "ENABLED",
      updatedAt: this.clock(),
      updatedBy: "default",
    };
  }

  modelRecord(provider: string, model: string): ModelTrustRecord {
    return (
      this.repos.models.findById(`${provider}/${model}`) ??
      this.repos.models.findById(`${provider}/*`) ??
      this.defaultModel(provider, model)
    );
  }

  listModels(): ModelTrustRecord[] {
    return this.repos.models.list();
  }

  setModel(
    record: Omit<ModelTrustRecord, "id" | "updatedAt" | "updatedBy">,
    by: string,
  ): ModelTrustRecord {
    const next: ModelTrustRecord = {
      ...record,
      id: `${record.provider}/${record.model}`,
      updatedAt: this.clock(),
      updatedBy: by,
    };
    this.repos.models.upsert(next);
    return next;
  }

  /** May `taskType` data of `dataClass` be sent to this model? */
  modelAllows(
    provider: string,
    model: string,
    taskType: string | undefined,
    dataClass: DataClass,
  ): { ok: boolean; reason: string } {
    const m = this.modelRecord(provider, model);
    if (m.status === "DISABLED")
      return { ok: false, reason: `model ${m.id} is disabled` };
    if (dataClass === "SECRET")
      return { ok: false, reason: "secrets are never sent to any model" };
    if (dataClassRank(dataClass) > dataClassRank(m.maxDataClass))
      return {
        ok: false,
        reason: `${dataClass} data exceeds ${m.id}'s maximum (${m.maxDataClass})`,
      };
    if (
      taskType &&
      !m.approvedTaskTypes.includes("*") &&
      !m.approvedTaskTypes.includes(taskType)
    )
      return {
        ok: false,
        reason: `${m.id} is not approved for ${taskType} tasks`,
      };
    return { ok: true, reason: "model trust allows this" };
  }

  /* ---- tools ---- */

  listTools(): ToolTrustRecord[] {
    const stored = new Map(this.repos.tools.list().map((t) => [t.toolId, t]));
    for (const t of builtinTools(this.clock()))
      if (!stored.has(t.toolId)) stored.set(t.toolId, t);
    return [...stored.values()].sort((a, b) =>
      a.toolId.localeCompare(b.toolId),
    );
  }

  toolRecord(toolId: string): ToolTrustRecord | undefined {
    return this.listTools().find((t) => t.toolId === toolId);
  }

  setTool(
    record: Omit<ToolTrustRecord, "id" | "updatedAt" | "updatedBy">,
    by: string,
  ): ToolTrustRecord {
    for (const e of record.environments)
      if (!GOV_ENVIRONMENTS.includes(e)) throw new Error("invalid environment");
    const next: ToolTrustRecord = {
      ...record,
      id: record.toolId,
      updatedAt: this.clock(),
      updatedBy: by,
    };
    this.repos.tools.upsert(next);
    return next;
  }

  /** Tool authorization BEFORE execution: unknown tools are refused (deny by default). */
  toolAllows(
    toolId: string | undefined,
    agentId: string | undefined,
    env: GovEnvironment,
  ): { ok: boolean; reason: string; approval: ToolTrustRecord["approval"] } {
    if (!toolId)
      return { ok: true, reason: "no tool involved", approval: "NONE" };
    const t = this.toolRecord(toolId);
    if (!t)
      return {
        ok: false,
        reason: `tool "${toolId}" is not registered with the trust registry`,
        approval: "NONE",
      };
    if (t.status === "DISABLED")
      return {
        ok: false,
        reason: `tool "${toolId}" is disabled`,
        approval: t.approval,
      };
    if (
      !t.allowedAgents.includes("*") &&
      (!agentId || !t.allowedAgents.includes(agentId))
    )
      return {
        ok: false,
        reason: `tool "${toolId}" is not available to ${agentId ?? "this caller"}`,
        approval: t.approval,
      };
    if (!t.environments.includes(env))
      return {
        ok: false,
        reason: `tool "${toolId}" is not permitted in ${env}`,
        approval: t.approval,
      };
    return { ok: true, reason: "tool trust allows this", approval: t.approval };
  }
}
