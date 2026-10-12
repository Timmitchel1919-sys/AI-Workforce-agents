/**
 * Agent Router (Layer 4) — the ONE place a task is matched to an agent.
 *
 * An agent never receives a task merely because it exists. It must be enabled,
 * authorized for the project, cover every required capability (a broad
 * capability covers a narrower one, never the reverse), fit the task's tool and
 * risk needs, not be excluded (review independence / earlier failure), and is
 * then ranked by specialization and current workload. The evidence for the
 * choice — and the reason every other agent was rejected — is returned.
 */
import {
  canonicalizeCapability,
  capabilitySatisfies,
} from "../../contracts/capabilities.js";
import type { Agent } from "../../contracts/index.js";
import type {
  AgentAssignmentEvidence,
  OrchTask,
} from "../../contracts/execution-orchestration.js";
import { needsWriteTools } from "./policies.js";

export interface OrchAgentRouteInput {
  task: Pick<
    OrchTask,
    | "projectId"
    | "type"
    | "risk"
    | "requiredCapabilities"
    | "excludedAgents"
    | "destructive"
  >;
  /** The task approval was already granted (gated write tools may then be needed). */
  approved: boolean;
  agents: readonly Agent[];
  isEnabled?: (agentId: string) => boolean;
  workload?: (agentId: string) => number;
  /** Extra exclusions (e.g. the implementer, for an independent reviewer). */
  exclude?: readonly string[];
}

export interface OrchAgentRouteResult {
  selected?: AgentAssignmentEvidence;
  /** Every other agent and why it did not qualify. */
  rejected: { agentId: string; reasons: string[] }[];
  /** Present when nobody qualified. */
  reason?: string;
}

const RISK_RANK = { low: 0, medium: 1, high: 2 } as const;

function offered(agent: Agent): string[] {
  const out = new Set<string>();
  for (const label of agent.capabilities) {
    const canonical = canonicalizeCapability(label);
    if (canonical) out.add(canonical);
  }
  return [...out];
}

export class AgentRouter {
  route(input: OrchAgentRouteInput): OrchAgentRouteResult {
    const rejected: OrchAgentRouteResult["rejected"] = [];
    const qualified: {
      agent: Agent;
      evidence: AgentAssignmentEvidence;
      extra: number;
    }[] = [];
    const excluded = new Set([
      ...(input.exclude ?? []),
      ...input.task.excludedAgents,
    ]);

    for (const agent of input.agents) {
      const reasons: string[] = [];
      if (input.isEnabled && !input.isEnabled(agent.id))
        reasons.push("agent is disabled");
      if (excluded.has(agent.id))
        reasons.push("excluded (independence or an earlier failure)");
      if (!(
        agent.allowedProjects.includes("*") ||
        agent.allowedProjects.includes(input.task.projectId)
      )) {
        reasons.push("not authorized for this project");
      }
      const own = offered(agent);
      const missing = input.task.requiredCapabilities.filter(
        (required) => !own.some((o) => capabilitySatisfies(o, required)),
      );
      if (missing.length > 0)
        reasons.push(`does not cover: ${missing.join(", ")}`);

      const meta = agent.metadata ?? {};
      const readOnly = meta["readOnly"] === true;
      if (
        meta["toolAccess"] === "none" &&
        input.task.type !== "ANALYSIS" &&
        input.task.type !== "RESEARCH"
      ) {
        reasons.push("agent profile grants no tools");
      }
      if (readOnly && needsWriteTools(input.task.type, input.approved)) {
        reasons.push(
          "read-only agent cannot take a task that needs write tools",
        );
      }
      const maxRisk = meta["maxRisk"];
      if (
        (maxRisk === "low" || maxRisk === "medium") &&
        RISK_RANK[input.task.risk] > RISK_RANK[maxRisk]
      ) {
        reasons.push(
          `task risk ${input.task.risk} exceeds the agent ceiling ${maxRisk}`,
        );
      }

      if (reasons.length > 0) {
        rejected.push({ agentId: agent.id, reasons });
        continue;
      }
      const covered = input.task.requiredCapabilities.filter((r) =>
        own.some((o) => capabilitySatisfies(o, r)),
      );
      qualified.push({
        agent,
        extra: own.length - covered.length,
        evidence: {
          agentId: agent.id,
          agentName: agent.name,
          coveredCapabilities: covered,
          reasons: [
            "enabled and authorized for the project",
            `covers ${covered.join(", ")}`,
            ...(readOnly
              ? ["read-only profile suits a task with no write tools"]
              : []),
          ],
          workload: input.workload?.(agent.id) ?? 0,
        },
      });
    }

    if (qualified.length === 0) {
      return {
        rejected,
        reason: `no qualified agent for ${input.task.requiredCapabilities.join(", ") || "this task"}`,
      };
    }
    // Specialization first (fewest unrelated capabilities), then workload, then id.
    qualified.sort(
      (a, b) =>
        a.extra - b.extra ||
        a.evidence.workload - b.evidence.workload ||
        a.agent.id.localeCompare(b.agent.id),
    );
    const [best, ...rest] = qualified;
    return {
      selected: best!.evidence,
      rejected: [
        ...rejected,
        ...rest.map((r) => ({
          agentId: r.agent.id,
          reasons: ["qualified, but ranked lower (specialization/workload)"],
        })),
      ],
    };
  }
}
