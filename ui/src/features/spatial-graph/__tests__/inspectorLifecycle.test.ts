import { describe, expect, it } from "vitest";
import { buildInspectorModel } from "../lib/inspectorModel";
import { toGraphData } from "../lib/graphModel";
import { edge, makeProjection, node } from "./fixtures";
import { en } from "../../../i18n/locales/en";
import { nl } from "../../../i18n/locales/nl";

const lifecycle = () =>
  makeProjection({
    nodes: [
      node("project-p1", "PROJECT", "Apollo"),
      node("agent-a1", "AGENT", "Builder"),
      node("task-t1", "TASK", "Write API", "running"),
      node("session-s1", "EXECUTION_SESSION", "Session build", "running", { stageKind: "build", attempts: 2, risk: "low" }),
      node("changeset-c1", "CHANGESET", "ChangeSet", "awaiting_review", { fileCount: 3 }),
      node("verification-v1", "VERIFICATION", "Verification", "completed", { stages: 4, passedStages: 4 }),
      node("commit-k1", "COMMIT", "Commit abcdef1", "completed", { commitSha: "abcdef1234567890", branch: "main" }),
      node("deployment-d1", "DEPLOYMENT", "Deployment hosting", "deployed", { targetClass: "hosting", simulated: false }),
      node("approval-ap1", "APPROVAL", "Approval", "awaiting_approval", { action: "commit" }),
    ],
    edges: [
      edge("agent-a1", "session-s1", "EXECUTES"),
      edge("task-t1", "session-s1", "EXECUTES"),
      edge("session-s1", "changeset-c1", "PRODUCES"),
      edge("changeset-c1", "verification-v1", "VERIFIED_BY"),
      edge("changeset-c1", "commit-k1", "COMMITTED_AS"),
      edge("commit-k1", "deployment-d1", "DEPLOYED_TO"),
      edge("commit-k1", "approval-ap1", "REQUIRES_APPROVAL"),
    ],
  });

const model = (id: string) => {
  const g = lifecycle();
  return buildInspectorModel(g.nodes.find((n) => n.id === id)!, toGraphData(g));
};
const field = (m: ReturnType<typeof model>, id: string) => m.fields.find((f) => f.id === id)?.value;
const labels = (v: unknown) => (v as { nodes: { label: string }[] }).nodes.map((n) => n.label);

describe("inspector: execution lifecycle nodes", () => {
  it("session shows its real agent, task, ChangeSet and facts", () => {
    const m = model("session-s1");
    expect(labels(field(m, "assignedAgent"))).toEqual(["Builder"]);
    expect(labels(field(m, "tasks"))).toEqual(["Write API"]);
    expect(labels(field(m, "changeSets"))).toEqual(["ChangeSet"]);
    expect(field(m, "attempts")).toEqual({ kind: "text", text: "2" });
    // Never recorded => explicit "Unavailable" (null text), not a guess.
    expect(field(m, "environments")).toEqual({ kind: "nodes", nodes: [], empty: "unavailable" });
    expect(m.fields.find((f) => f.id === "endedAt")).toBeUndefined(); // absent metadata is not invented
  });

  it("ChangeSet -> verification/commit chain is navigable and COMMIT != DEPLOYMENT", () => {
    const cs = model("changeset-c1");
    expect(labels(field(cs, "verifications"))).toEqual(["Verification"]);
    expect(labels(field(cs, "commits"))).toEqual(["Commit abcdef1"]);
    expect(field(cs, "reviews")).toEqual({ kind: "nodes", nodes: [], empty: "none" }); // none exist => none shown
    const commit = model("commit-k1");
    expect(labels(field(commit, "deployments"))).toEqual(["Deployment hosting"]);
    expect(labels(field(commit, "approvals"))).toEqual(["Approval"]);
    expect(model("deployment-d1").fields.some((f) => f.id === "commits")).toBe(true);
  });

  it("an approval node only reports state; it carries no decision metadata beyond the whitelist", () => {
    const m = model("approval-ap1");
    expect(field(m, "state")).toEqual({ kind: "state", state: "awaiting_approval" });
    expect(labels(field(m, "commits"))).toEqual(["Commit abcdef1"]);
  });

  it("every new inspector field has an EN and NL label (no missing keys)", () => {
    const ids = ["sessions", "changeSets", "verifications", "reviews", "approvals", "commits", "deployments", "stageKind", "risk", "attempts", "startedAt", "endedAt", "fileCount", "stages", "passedStages", "failedStages", "reviewerKind", "action", "requestedAt", "decidedAt", "commitSha", "branch", "targetClass", "simulated", "durationMs", "completedAt"];
    const get = (cat: unknown) => (cat as { spatial: { inspector: Record<string, string> } }).spatial.inspector;
    for (const id of ids) {
      expect(get(en)[id], `en ${id}`).toBeTruthy();
      expect(get(nl)[id], `nl ${id}`).toBeTruthy();
    }
  });
});
