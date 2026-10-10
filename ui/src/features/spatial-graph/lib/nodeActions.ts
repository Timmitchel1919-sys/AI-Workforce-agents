import type { WorkforceGraphNode, WorkforceGraphNodeType } from "../../../../../contracts/graph";

/**
 * Node action discovery (EO-5.7). This maps a node to the EXISTING Control Plane commands that
 * apply to it — it invents nothing. The list is a UX hint only: the server re-authorises every
 * command (role, project scope), re-checks the target's CURRENT state, and audits it.
 * GRAPH SELECTION != COMMAND AUTHORIZATION.
 *
 * Only commands that already exist AND that the spec lists for graph nodes are offered:
 *   Task: cancel / retry · Execution session: cancel · Approval: approve / reject.
 * Deliberately absent: kill-execution (emergency, admin-only — stays in Operations), agent
 * enable/disable, workflow control, and anything the backend does not support (pause task,
 * retry execution, deployment control).
 */
export const NODE_COMMANDS = ["cancel-task", "retry-task", "cancel-execution", "approve", "reject"] as const;
export type NodeCommand = (typeof NODE_COMMANDS)[number];

/** Control capability the server requires for the command (used only to hide, never to permit). */
const CAPABILITY: Readonly<Record<NodeCommand, string>> = {
  "cancel-task": "cancel_task",
  "retry-task": "retry_task",
  "cancel-execution": "cancel_execution",
  approve: "approve",
  reject: "reject",
};

export type ReasonRule = "none" | "optional" | "required";

export interface NodeAction {
  command: NodeCommand;
  /** Destructive/consequential actions ALWAYS need an explicit confirmation step. */
  destructive: boolean;
  reason: ReasonRule;
  /** The id the command targets (a domain reference id, never a graph node id). */
  targetId: string;
  /** JSON body for POST /api/commands/:command. */
  body: (reason: string) => Record<string, string>;
}

const TERMINAL_TASK = new Set(["completed", "cancelled"]);
const CANCELLABLE_SESSION = new Set(["created", "validating", "ready", "running"]);

const isNodeCommand = (c: string): c is NodeCommand => (NODE_COMMANDS as readonly string[]).includes(c);

/**
 * Actions for a node, from its AUTHORITATIVE raw status. Absent/unknown status → no action, so a
 * node with unknown state never offers a state-changing command.
 */
export function actionsFor(node: WorkforceGraphNode, capabilities: readonly string[] | undefined): NodeAction[] {
  if (!capabilities || !node.referenceId) return [];
  const id = node.referenceId;
  const out: NodeAction[] = [];
  const add = (a: Omit<NodeAction, "targetId">) => {
    if (isNodeCommand(a.command) && capabilities.includes(CAPABILITY[a.command])) out.push({ ...a, targetId: id });
  };
  switch (node.type as WorkforceGraphNodeType) {
    case "TASK":
      if (node.status && !TERMINAL_TASK.has(node.status)) {
        add({ command: "cancel-task", destructive: true, reason: "optional", body: (r) => ({ taskId: id, ...(r ? { reason: r } : {}) }) });
      }
      if (node.status === "failed") {
        add({ command: "retry-task", destructive: false, reason: "none", body: () => ({ taskId: id }) });
      }
      break;
    case "EXECUTION_SESSION":
      if (CANCELLABLE_SESSION.has(node.status)) {
        add({ command: "cancel-execution", destructive: true, reason: "required", body: (r) => ({ sessionId: id, reason: r }) });
      }
      break;
    case "APPROVAL":
      // `requested` is the only state a decision can be recorded in; the server re-checks it.
      if (node.status === "requested") {
        add({ command: "approve", destructive: false, reason: "optional", body: (r) => ({ approvalId: id, ...(r ? { note: r } : {}) }) });
        add({ command: "reject", destructive: true, reason: "required", body: (r) => ({ approvalId: id, reason: r }) });
      }
      break;
    default:
      break;
  }
  return out;
}

/** Read-only inspection links (never state-changing). */
export interface InspectionLink {
  id: "task" | "approvals" | "operations";
  to: string;
}

export function inspectionLinksFor(node: WorkforceGraphNode): InspectionLink[] {
  const enc = encodeURIComponent;
  switch (node.type) {
    case "TASK":
      return node.referenceId ? [{ id: "task", to: `/tasks/${enc(node.referenceId)}` }] : [];
    case "APPROVAL":
      return [{ id: "approvals", to: "/approvals" }];
    case "EXECUTION_SESSION":
      return node.referenceId && node.projectId
        ? [{ id: "operations", to: `/projects/${enc(node.projectId)}/operations/${enc(node.referenceId)}` }]
        : [];
    default:
      return [];
  }
}
