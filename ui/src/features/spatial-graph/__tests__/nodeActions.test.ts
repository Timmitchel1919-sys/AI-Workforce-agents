import { describe, expect, it } from "vitest";
import { actionsFor, inspectionLinksFor, NODE_COMMANDS } from "../lib/nodeActions";
import { node } from "./fixtures";

const ALL = ["view", "cancel_task", "retry_task", "cancel_execution", "approve", "reject", "kill_execution", "disable_agent", "cancel_workflow"];
const names = (n: ReturnType<typeof node>, caps: readonly string[] = ALL) => actionsFor(n, caps).map((a) => a.command);

describe("node action discovery (a hint; the server authorises)", () => {
  it("offers cancel for a live task, retry for a failed one, and nothing for a finished one", () => {
    expect(names(node("task-t1", "TASK", "T", "running"))).toEqual(["cancel-task"]);
    expect(names(node("task-t1", "TASK", "T", "queued"))).toEqual(["cancel-task"]);
    expect(names(node("task-t1", "TASK", "T", "failed"))).toEqual(["cancel-task", "retry-task"]);
    expect(names(node("task-t1", "TASK", "T", "completed"))).toEqual([]);
    expect(names(node("task-t1", "TASK", "T", "cancelled"))).toEqual([]);
  });

  it("offers session cancel only while a session can still be cancelled", () => {
    for (const s of ["created", "validating", "ready", "running"]) expect(names(node("session-s", "EXECUTION_SESSION", "S", "running", undefined, s))).toEqual(["cancel-execution"]);
    for (const s of ["cancelling", "cancelled", "succeeded", "failed", "timed_out", "denied"]) expect(names(node("session-s", "EXECUTION_SESSION", "S", "running", undefined, s))).toEqual([]);
  });

  it("offers approve/reject only for a REQUESTED approval", () => {
    expect(names(node("approval-a", "APPROVAL", "A", "awaiting_approval", undefined, "requested"))).toEqual(["approve", "reject"]);
    for (const s of ["approved", "rejected", "expired"]) expect(names(node("approval-a", "APPROVAL", "A", "completed", undefined, s))).toEqual([]);
  });

  it("never offers an action the spec/backend does not support", () => {
    // Deployment, agent, environment, commit, changeset, verification, review: inspect only.
    for (const type of ["DEPLOYMENT", "AGENT", "ENVIRONMENT", "COMMIT", "CHANGESET", "VERIFICATION", "REVIEW", "WORKFLOW", "PROJECT"] as const) {
      expect(names(node(`x-${type}`, type, "N", "running"))).toEqual([]);
    }
    // Emergency kill / agent enable-disable / workflow control are never in the vocabulary.
    expect([...NODE_COMMANDS].sort()).toEqual(["approve", "cancel-execution", "cancel-task", "reject", "retry-task"]);
  });

  it("hides actions the account has no capability for, and offers none without a capability list", () => {
    expect(names(node("task-t1", "TASK", "T", "failed"), ["view"])).toEqual([]);
    expect(names(node("task-t1", "TASK", "T", "failed"), ["view", "retry_task"])).toEqual(["retry-task"]);
    expect(actionsFor(node("task-t1", "TASK", "T", "failed"), undefined)).toEqual([]);
  });

  it("offers no state-changing action for an unknown/absent status", () => {
    expect(names(node("task-t1", "TASK", "T", "unavailable", undefined, ""))).toEqual([]);
  });

  it("targets the DOMAIN id (referenceId), never the graph node id, with the exact command body", () => {
    const [cancel] = actionsFor(node("task-t1", "TASK", "T", "running"), ALL);
    expect(cancel.targetId).toBe("t1");
    expect(cancel.body("because")).toEqual({ taskId: "t1", reason: "because" });
    expect(cancel.body("")).toEqual({ taskId: "t1" });
    const [reject] = actionsFor(node("approval-a9", "APPROVAL", "A", "awaiting_approval", undefined, "requested"), ALL).slice(1);
    expect(reject.body("no")).toEqual({ approvalId: "a9", reason: "no" });
    expect(reject.reason).toBe("required");
    const [stop] = actionsFor(node("session-s3", "EXECUTION_SESSION", "S", "running", undefined, "running"), ALL);
    expect(stop.body("halt")).toEqual({ sessionId: "s3", reason: "halt" });
  });

  it("every state-changing action is flagged consequential or explicitly non-destructive, never silent", () => {
    for (const a of actionsFor(node("task-t1", "TASK", "T", "failed"), ALL)) expect(typeof a.destructive).toBe("boolean");
    expect(actionsFor(node("task-t1", "TASK", "T", "running"), ALL)[0].destructive).toBe(true);
  });

  it("inspection links are read-only and encode ids", () => {
    expect(inspectionLinksFor(node("task-t1", "TASK", "T"))).toEqual([{ id: "task", to: "/tasks/t1" }]);
    expect(inspectionLinksFor(node("approval-a", "APPROVAL", "A"))).toEqual([{ id: "approvals", to: "/approvals" }]);
    expect(inspectionLinksFor(node("session-s/1", "EXECUTION_SESSION", "S"))[0].to).toBe("/projects/p1/operations/s%2F1");
    expect(inspectionLinksFor(node("deployment-d", "DEPLOYMENT", "D"))).toEqual([]);
  });
});
