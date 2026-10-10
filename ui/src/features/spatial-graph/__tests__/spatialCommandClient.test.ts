import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequest = vi.fn();
// A plain function (not a vi.fn) produces the rejection: vitest's call tracking would otherwise
// attach its own un-handled derived promise to it.
let failWith: unknown = null;
vi.mock("../../../api/client", () => ({
  apiRequest: (...a: unknown[]) => (failWith ? Promise.reject(failWith) : apiRequest(...a)),
}));
const failing = (e: unknown) => { failWith = e; };

import { ApiError } from "../../../api/errors";
import { executeNodeCommand, newSpatialCorrelationId, COMMAND_FAILURE_KINDS } from "../api/spatialCommandClient";
import { actionsFor } from "../lib/nodeActions";
import { node } from "./fixtures";

const [cancelTask] = actionsFor(node("task-t1", "TASK", "T", "running"), ["cancel_task"]);
const [stop] = actionsFor(node("session-s", "EXECUTION_SESSION", "S", "running", undefined, "running"), ["cancel_execution"]);
const executed = { command: "cancel_task", outcome: "executed", ok: true, reason: "task cancelled", correlationId: "c", details: {}, auditEventId: "e1", timestamp: "t" };

beforeEach(() => {
  apiRequest.mockReset();
  failWith = null;
});

describe("executeNodeCommand", () => {
  it("POSTs an allowlisted command with the token, a spatial-tagged correlation id and the exact body", async () => {
    apiRequest.mockResolvedValue(executed);
    const r = await executeNodeCommand(cancelTask, "why", "tok", "sg-fixed");
    const [path, init] = apiRequest.mock.calls[0];
    expect(path).toBe("/api/commands/cancel-task");
    expect(init).toMatchObject({ method: "POST", accessToken: "tok", headers: { "x-correlation-id": "sg-fixed" } });
    expect(JSON.parse(init.body)).toEqual({ taskId: "t1", reason: "why" });
    expect(r).toMatchObject({ ok: true, auditEventId: "e1", correlationId: "sg-fixed", inProgress: false });
  });

  it("mints sg- correlation ids so the audit trail shows where a command began", () => {
    expect(newSpatialCorrelationId()).toMatch(/^sg-.+/);
    expect(newSpatialCorrelationId()).not.toBe(newSpatialCorrelationId());
  });

  it("a cancel of a RUNNING session is accepted, not finished (inProgress)", async () => {
    apiRequest.mockResolvedValue({ ...executed, command: "cancel_execution", details: { outcome: "cancelling" } });
    const r = await executeNodeCommand(stop, "halt", "tok");
    expect(r).toMatchObject({ ok: true, inProgress: true });
  });

  it.each([
    ["forbidden", 403, "not_authorized"],
    ["unauthorized", 401, "unauthenticated"],
    ["invalid_request", 400, "invalid"],
    ["not_found", 404, "stale_or_missing"],
    ["invalid_state", 409, "conflict"],
    ["approval_failure", 422, "approval"],
    ["command_failure", 500, "execution_failure"],
  ])("classifies server errorKind %s (HTTP %i) as %s and keeps the server's reason", async (errorKind, status, kind) => {
    failing(new ApiError("generic", { status, errorKind, reason: "task is already completed" }));
    const r = await executeNodeCommand(cancelTask, "", "tok", "sg-x");
    expect(r).toEqual({ ok: false, kind, reason: "task is already completed", correlationId: "sg-x" });
  });

  it("falls back to the HTTP status when the body carried no errorKind", async () => {
    failing(new ApiError("nope", { status: 403 }));
    expect(await executeNodeCommand(cancelTask, "", "tok")).toMatchObject({ ok: false, kind: "not_authorized" });
  });

  it("a timeout is an UNKNOWN outcome, a network failure is distinct; neither is success", async () => {
    failing(new ApiError("The request timed out.", { code: "timeout" }));
    expect(await executeNodeCommand(cancelTask, "", "tok")).toMatchObject({ ok: false, kind: "unknown_outcome" });
    failing(new ApiError("Unable to communicate", { code: "network" }));
    expect(await executeNodeCommand(cancelTask, "", "tok")).toMatchObject({ ok: false, kind: "network" });
    failing(new TypeError("boom"));
    expect(await executeNodeCommand(cancelTask, "", "tok")).toMatchObject({ ok: false, kind: "network" });
  });

  it("REQUESTED != EXECUTED: a 200 that is not an executed outcome is a failure, never 'Done'", async () => {
    for (const body of [{ outcome: "rejected", ok: false, reason: "no" }, { outcome: "executed", ok: false }, {}, null, "<html>"]) {
      apiRequest.mockResolvedValue(body);
      const r = await executeNodeCommand(cancelTask, "", "tok");
      expect(r.ok).toBe(false);
    }
  });

  it("never lets a secret shape reach the screen via a server reason", async () => {
    failing(new ApiError("x", { status: 409, errorKind: "invalid_state", reason: "failed with key sk-abcdefghijklmnop1234" }));
    const r = await executeNodeCommand(cancelTask, "", "tok");
    expect(r.ok === false && r.reason).not.toMatch(/sk-abcdefghijklmnop/);
  });

  it("has a distinct failure kind for every case the spec names", () => {
    expect([...COMMAND_FAILURE_KINDS].sort()).toEqual(["approval", "conflict", "execution_failure", "invalid", "network", "not_authorized", "stale_or_missing", "unauthenticated", "unknown_outcome"]);
  });
});
