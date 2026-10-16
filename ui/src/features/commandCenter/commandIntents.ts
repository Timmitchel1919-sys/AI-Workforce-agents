/**
 * UI Layer 7 command interpretation. Deterministic keyword matching only — no
 * model, no guessing. Every intent resolves to a READ / NAVIGATION target.
 * High-impact phrases (deploy, merge, delete, start a pipeline, approve…)
 * never execute: they resolve to `requires_approval`, which sends the owner to
 * the Approval Center. REQUESTED != APPROVED != EXECUTED.
 */

export type CommandIntent =
  | { kind: "open_project"; projectId: string; label: string; to: string }
  | { kind: "navigate"; intent: NavigateIntent; to: string }
  | { kind: "requires_approval"; action: string; to: string }
  | { kind: "search_knowledge"; query: string; to: string }
  | { kind: "unsupported_pull_requests" }
  | { kind: "project_not_found"; query: string }
  | { kind: "no_match" };

export type NavigateIntent =
  | "show_missions"
  | "show_approvals"
  | "show_agents"
  | "show_workflows"
  | "show_costs"
  | "show_activity"
  | "show_runners"
  | "show_intelligence"
  | "show_security"
  | "show_integrations"
  | "show_teams"
  | "show_operations";

export interface ProjectRef {
  projectId: string;
  displayName?: string;
}

const MAX_COMMAND = 300;

const HIGH_IMPACT: { re: RegExp; action: string }[] = [
  { re: /\b(deploy|uitrol|rol uit|release to production|publiceer)\b/, action: "deploy" },
  { re: /\b(merge|samenvoegen)\b/, action: "merge" },
  { re: /\b(delete|remove|verwijder|wis)\b/, action: "delete" },
  { re: /\b(approve|goedkeur|keur .* goed)\b/, action: "approve" },
  { re: /\b(rollback|terugdraai)\b/, action: "rollback" },
  { re: /\b(rotate|roteer)\b/, action: "rotate credentials" },
  { re: /\b(start|run|launch|trigger|begin|draai|voer .* uit)\b.*\b(pipeline|pijplijn|build|test|mission|missie|workflow)\b/, action: "start a pipeline" },
  { re: /\b(push|commit)\b/, action: "push / commit" },
];

const NAV: { re: RegExp; intent: NavigateIntent; to: string }[] = [
  { re: /\b(approvals?|goedkeuring(en)?)\b/, intent: "show_approvals", to: "/approvals" },
  { re: /\b(integrations?|integraties|mcp|webhooks?|connectors?)\b/, intent: "show_integrations", to: "/integrations" },
  { re: /\b(teams?|handoffs?|overdrachten|task board)\b/, intent: "show_teams", to: "/agent-teams" },
  { re: /\b(failed|mislukt|incidents?|alerts?|operations)\b/, intent: "show_operations", to: "/operations" },
  { re: /\b(missions?|missies?|software factory|programs?|programma'?s?)\b/, intent: "show_missions", to: "/software-factory" },
  { re: /\b(agents?)\b/, intent: "show_agents", to: "/agents" },
  { re: /\b(workflows?|studio)\b/, intent: "show_workflows", to: "/workflow-studio" },
  { re: /\b(costs?|kosten|spend|uitgaven|budget)\b/, intent: "show_costs", to: "/cost" },
  { re: /\b(activity|activiteit|audit|log|history|geschiedenis)\b/, intent: "show_activity", to: "/audit-log" },
  { re: /\b(runners?|environments?|omgevingen|infrastructure|infrastructuur)\b/, intent: "show_runners", to: "/infrastructure" },
  { re: /\b(models?|modellen|routing|routering|intelligence|intelligentie)\b/, intent: "show_intelligence", to: "/intelligence" },
  { re: /\b(security|beveiliging|devices?|apparaten|sessions?|sessies|lost phone|kwijt)\b/, intent: "show_security", to: "/profile#sessions" },
];

export function interpretCommand(raw: string, projects: readonly ProjectRef[]): CommandIntent {
  const text = raw.trim().toLowerCase().slice(0, MAX_COMMAND);
  if (!text) return { kind: "no_match" };

  for (const h of HIGH_IMPACT) {
    if (h.re.test(text)) return { kind: "requires_approval", action: h.action, to: "/approvals" };
  }

  const open = /^(open|show|toon|ga naar|go to)\s+(?:my\s+|mijn\s+)?(?:project\s+)(.+)$/.exec(text);
  if (open) {
    const query = open[2]!.replace(/\b(project)\b/g, "").trim();
    const match =
      projects.find((p) => p.projectId.toLowerCase() === query) ??
      projects.find((p) => (p.displayName ?? "").toLowerCase() === query);
    if (!match) return { kind: "project_not_found", query };
    return {
      kind: "open_project",
      projectId: match.projectId,
      label: match.displayName ?? match.projectId,
      to: `/projects/${encodeURIComponent(match.projectId)}`,
    };
  }

  const find = /^(?:find|search|zoek)\s+(?:for\s+|naar\s+)?(?:the\s+|de\s+)?(.+?)(?:\s+(?:docs?|documentation|documentatie|knowledge|kennis))?$/.exec(text);
  if (find && find[1]!.trim()) {
    const query = find[1]!.trim().slice(0, 200);
    return { kind: "search_knowledge", query, to: `/knowledge?q=${encodeURIComponent(query)}` };
  }

  if (/\b(pull requests?|prs?)\b/.test(text)) return { kind: "unsupported_pull_requests" };

  for (const n of NAV) {
    if (n.re.test(text)) return { kind: "navigate", intent: n.intent, to: n.to };
  }
  return { kind: "no_match" };
}
