import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryEventBus,
  createEvent,
  type DomainEvent,
} from "../core/index.js";

test("events: createEvent builds a stable envelope", () => {
  const event = createEvent("PROJECT_CREATED", { projectId: "aims" });
  assert.equal(event.name, "PROJECT_CREATED");
  assert.equal(event.payload.projectId, "aims");
  assert.ok(event.id);
  assert.ok(event.occurredAt);
});

test("events: named subscribers receive only their event", () => {
  const bus = new InMemoryEventBus();
  const seen: string[] = [];

  bus.subscribe("PROJECT_CREATED", (e) =>
    seen.push(`created:${e.payload.projectId}`),
  );
  bus.subscribe("PROJECT_ARCHIVED", (e) =>
    seen.push(`archived:${e.payload.projectId}`),
  );

  bus.publish(createEvent("PROJECT_CREATED", { projectId: "a" }));
  bus.publish(createEvent("PROJECT_ARCHIVED", { projectId: "b" }));

  assert.deepEqual(seen, ["created:a", "archived:b"]);
});

test("events: subscribeAll sees every event and unsubscribe stops delivery", () => {
  const bus = new InMemoryEventBus();
  const seen: DomainEvent[] = [];
  const unsubscribe = bus.subscribeAll((e) => seen.push(e));

  bus.publish(createEvent("TASK_CREATED", { taskId: "t1" }));
  unsubscribe();
  bus.publish(createEvent("TASK_CREATED", { taskId: "t2" }));

  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.name, "TASK_CREATED");
  assert.deepEqual(seen[0]!.payload, { taskId: "t1" });
});

test("events: a throwing subscriber does not break dispatch", () => {
  const bus = new InMemoryEventBus();
  let delivered = false;

  bus.subscribe("AGENT_STARTED", () => {
    throw new Error("boom");
  });
  bus.subscribe("AGENT_STARTED", () => {
    delivered = true;
  });

  assert.doesNotThrow(() =>
    bus.publish(createEvent("AGENT_STARTED", { agentId: "developer" })),
  );
  assert.equal(delivered, true);
});

test("events: history is bounded by historyLimit", () => {
  const bus = new InMemoryEventBus({ historyLimit: 2 });
  bus.publish(createEvent("SECURITY_EVENT", { kind: "a" }));
  bus.publish(createEvent("SECURITY_EVENT", { kind: "b" }));
  bus.publish(createEvent("SECURITY_EVENT", { kind: "c" }));

  const history = bus.list();
  assert.equal(history.length, 2);
  assert.deepEqual(
    history.map((e) => e.payload),
    [{ kind: "b" }, { kind: "c" }],
  );
});
