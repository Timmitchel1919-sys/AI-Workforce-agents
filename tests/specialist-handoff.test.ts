/**
 * Specialist handoffs.
 *
 * A handoff is the point where work, context and risk move between agents, so
 * the failure modes are the interesting ones:
 *
 *   - a handoff that names a destination that cannot do the remaining work;
 *   - a handoff that crosses a project boundary;
 *   - a destination that was qualified when the work was proposed but is no
 *     longer qualified when the work is offered;
 *   - work that "moves" without the destination ever accepting it.
 *
 * Each of those is refused here, with the reason visible.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { SpecialistHandoffService } from "../core/handoffs/handoff-system.js";
import { V1_SPECIALIST_WORKFORCE } from "../agents/specialists/v1-specialist-workforce.js";
import {
  ValidationError,
  StateTransitionError,
  type AgentDescriptor,
  type HandoffDraft,
} from "../contracts/index.js";

const BY_ID = new Map(V1_SPECIALIST_WORKFORCE.map((d) => [d.id, d]));

function real(id: string): AgentDescriptor {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`unknown V1 agent: ${id}`);
  return found;
}

const BACKEND = real("backend-dev-v1");
const QA = real("qa-v1");
const REVIEWER = real("reviewer-v1");

function service(
  descriptors: readonly AgentDescriptor[],
  isEnabled: (agentId: string, projectId: string) => boolean = () => true,
): SpecialistHandoffService {
  return new SpecialistHandoffService(
    () => descriptors,
    isEnabled,
    undefined,
    () => "2026-01-01T00:00:00.000Z",
  );
}

function draft(overrides: Partial<HandoffDraft> = {}): HandoffDraft {
  return {
    taskId: "task-h1",
    projectId: "money-mind",
    sourceAgentId: "backend-dev-v1",
    destinationAgentId: "qa-v1",
    completedWork: "Implemented the persistence layer and its migrations.",
    remainingWork:
      "Write and run the integration tests for the new repository.",
    acceptanceCriteria: [
      "Every repository method has a passing integration test.",
    ],
    requiredCapabilities: ["software.testing"],
    ...overrides,
  };
}

test("a qualified destination is proposed with its evidence attached", () => {
  const handoff = service([BACKEND, QA]).propose({ draft: draft() });
  assert.equal(handoff.status, "proposed");
  assert.equal(handoff.projectId, "money-mind");
  assert.equal(handoff.destinationAgentId, "qa-v1");
  assert.equal(handoff.destinationQualification?.qualified, true);
  assert.deepEqual(handoff.destinationQualification?.matchedCapabilities, [
    "software.testing",
  ]);
  assert.equal(handoff.destinationQualification?.descriptorVersion, QA.version);
});

test("a destination that cannot do the remaining work is refused at proposal time", () => {
  // The UI designer does not declare software.testing. Offering it the test
  // work would be a routing error, not a transfer.
  assert.throws(
    () =>
      service([BACKEND, real("ui-designer-v1")]).propose({
        draft: draft({ destinationAgentId: "ui-designer-v1" }),
      }),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.match(error.message, /does not qualify/);
      assert.match(error.message, /missing_capability/);
      return true;
    },
  );
});

test("an unregistered destination is refused", () => {
  assert.throws(
    () =>
      service([BACKEND]).propose({
        draft: draft({ destinationAgentId: "ghost-v9" }),
      }),
    /not a registered specialist descriptor/,
  );
});

test("a handoff may not cross a project boundary", () => {
  // money-mind agents are scoped to money-mind. Handing work to one from a
  // different project would leak that project's context to an agent that is
  // not allowed to be in the project at all.
  assert.throws(
    () =>
      service([BACKEND, QA]).propose({
        draft: draft({ projectId: "ai-workforce" }),
      }),
    /does not qualify/,
  );
});

test("a handoff must state the project that owns the work", () => {
  const { projectId: _projectId, ...withoutProject } = draft();
  assert.throws(
    () => service([BACKEND, QA]).propose({ draft: withoutProject }),
    /must state the project that owns the work/,
  );
});

test("eligibility is RE-VERIFIED at acceptance: a destination suspended in between loses the work", () => {
  let suspended = false;
  const svc = service([BACKEND, QA], () => !suspended);
  const handoff = svc.propose({ draft: draft() });
  suspended = true;
  assert.throws(
    () => svc.accept(handoff.id, "orchestrator"),
    /no longer enabled for project/,
  );
  // The handoff is still `proposed`, so the orchestrator can route it elsewhere
  // rather than losing the work.
  assert.equal(svc.require(handoff.id).status, "proposed");
});

test("a destination removed from the project loses the work at acceptance", () => {
  let pool: readonly AgentDescriptor[] = [BACKEND, QA];
  const svc = new SpecialistHandoffService(
    () => pool,
    () => true,
    undefined,
    () => "2026-01-01T00:00:00.000Z",
  );
  const handoff = svc.propose({ draft: draft() });
  pool = [BACKEND];
  assert.throws(
    () => svc.accept(handoff.id, "orchestrator"),
    /no longer a registered specialist descriptor/,
  );
});

test("work only moves on explicit acceptance, and the acceptor is recorded", () => {
  const svc = service([BACKEND, QA]);
  const handoff = svc.propose({ draft: draft() });
  const accepted = svc.accept(handoff.id, "user:admin");
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.acceptedBy, "user:admin");
  assert.ok(accepted.resolvedAt);
});

test("an accepted handoff cannot be accepted again", () => {
  const svc = service([BACKEND, QA]);
  const handoff = svc.propose({ draft: draft() });
  svc.accept(handoff.id, "user:admin");
  assert.throws(
    () => svc.accept(handoff.id, "user:admin"),
    StateTransitionError,
  );
});

test("acceptance re-evaluates and refreshes the evidence", () => {
  const svc = service([BACKEND, QA]);
  const handoff = svc.propose({ draft: draft() });
  const accepted = svc.accept(handoff.id, "user:admin");
  assert.equal(accepted.destinationQualification?.qualified, true);
  assert.deepEqual(accepted.destinationQualification?.reasonCodes, []);
});

test("a rejected handoff does not move the work", () => {
  const svc = service([BACKEND, QA]);
  const handoff = svc.propose({ draft: draft() });
  const rejected = svc.reject(handoff.id, "destination is saturated");
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.resolution, "destination is saturated");
  assert.throws(
    () => svc.accept(handoff.id, "user:admin"),
    StateTransitionError,
  );
});

test("a handoff carries only the remaining work, not the source's whole context", () => {
  const svc = service([BACKEND, QA]);
  const handoff = svc.propose({
    draft: draft({
      context: { ticket: "PROJ-1", relevantFile: "src/repo.ts" },
    }),
  });
  assert.equal(handoff.completedWork.length > 0, true);
  assert.equal(handoff.remainingWork.length > 0, true);
  assert.equal(handoff.acceptanceCriteria.length, 1);
  assert.deepEqual(Object.keys(handoff.context).sort(), [
    "relevantFile",
    "ticket",
  ]);
});

test("source and destination may not be the same agent", () => {
  assert.throws(
    () =>
      service([BACKEND]).propose({
        draft: draft({
          destinationAgentId: "backend-dev-v1",
          requiredCapabilities: ["software.backend"],
        }),
      }),
    /must differ/,
  );
});

test("a handoff to the independent reviewer of the same work is offered, and the implementer is excluded", () => {
  const svc = service([BACKEND, QA, REVIEWER]);
  const handoff = svc.propose({
    draft: draft({
      sourceAgentId: "qa-v1",
      destinationAgentId: "reviewer-v1",
      remainingWork: "Review the test evidence before it lands.",
      requiredCapabilities: ["software.review"],
    }),
  });
  assert.equal(handoff.destinationAgentId, "reviewer-v1");

  // The reviewer cannot be asked to review its own change set: proposing the
  // implementer as the destination of its own review is a ValidationError at
  // the handoff level too.
  assert.throws(
    () =>
      svc.propose({
        draft: draft({
          sourceAgentId: "backend-dev-v1",
          destinationAgentId: "backend-dev-v1",
          remainingWork: "Review your own change set.",
          requiredCapabilities: ["software.review"],
        }),
      }),
    /must differ/,
  );
});
