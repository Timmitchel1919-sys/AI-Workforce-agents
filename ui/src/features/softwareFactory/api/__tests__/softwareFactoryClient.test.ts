import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SoftwareFactoryClientError,
  getSoftwareFactoryOverview,
  getSoftwareFactoryProgramDetail,
  runSoftwareFactoryCommand,
} from "../softwareFactoryClient";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("softwareFactory reads", () => {
  it("scopes GET /api/software-factory to the selected project, with the ID token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json(200, {
        programs: [
          {
            id: "web-platform",
            projectId: "proj-1",
            name: "Web platform",
            objective: "Ship the web platform.",
            status: "active",
            workstreamIds: ["ws-1"],
            taskCount: 3,
            activeTaskCount: 2,
            updatedAt: "2026-09-25T10:00:00.000Z",
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const overview = await getSoftwareFactoryOverview("proj-1", "token-1");

    expect(overview.programs).toHaveLength(1);
    expect(overview.programs[0]).toMatchObject({
      id: "web-platform",
      projectId: "proj-1",
      status: "active",
      activeTaskCount: 2,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/software-factory?projectId=proj-1");
    expect((init as RequestInit).method).toBe("GET");
    expect(((init as RequestInit).headers as Headers).get("Authorization")).toBe("Bearer token-1");
  });

  it("maps GET /api/software-factory/programs/:programId onto the detail", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      json(200, {
        program: {
          schemaVersion: 1,
          id: "p-1",
          projectId: "proj-1",
          name: "P",
          objective: "O",
          status: "active",
          workstreams: ["ws-1"],
          createdAt: "c",
          updatedAt: "u",
        },
        workstreams: [
          {
            schemaVersion: 1,
            id: "ws-1",
            projectId: "proj-1",
            programId: "p-1",
            name: "WS",
            objective: "W",
            status: "active",
            tasks: ["t-1"],
            createdAt: "c",
            updatedAt: "u",
          },
        ],
        graph: {
          nodes: [{ id: "t-1", status: "created", task: { id: "t-1" } }],
          edges: [],
        },
        routes: [{ taskId: "t-1", code: "docker", status: "routed", detail: "ready" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const detail = await getSoftwareFactoryProgramDetail("proj-1", "p-1");

    expect(detail.program.name).toBe("P");
    expect(detail.program.projectId).toBe("proj-1");
    expect(detail.workstreams[0]!.id).toBe("ws-1");
    expect(detail.graph.nodes[0]!.id).toBe("t-1");
    expect(detail.routes[0]!.status).toBe("routed");

    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/software-factory/programs/p-1?projectId=proj-1");
  });

  it("encodes the program id and the project scope in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { program: {}, workstreams: [], graph: {}, routes: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await getSoftwareFactoryProgramDetail("proj/1 2", "a/b c");
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "/api/software-factory/programs/a%2Fb%20c?projectId=proj%2F1%202",
    );
  });
});

describe("softwareFactory commands", () => {
  it("POSTs create-program to /api/commands/create-program with the payload", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        json(200, { ok: true, reason: "created", resourceId: "p-9", correlationId: "c", auditEventId: "a", timestamp: "t" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runSoftwareFactoryCommand(
      {
        kind: "create-program",
        request: { projectId: "proj-1", id: "p-9", name: "Platform", objective: "Reach v2" },
      },
      "token-2",
    );

    expect(result.ok).toBe(true);
    expect(result.resourceId).toBe("p-9");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/commands/create-program");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      projectId: "proj-1",
      id: "p-9",
      name: "Platform",
      objective: "Reach v2",
    });
    expect(((init as RequestInit).headers as Headers).get("Authorization")).toBe("Bearer token-2");
  });

  it("POSTs add-workstream-task with the server-derived scope and a draft without ownership", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { ok: true, reason: "ok", correlationId: "c", auditEventId: "a", timestamp: "t" }));
    vi.stubGlobal("fetch", fetchMock);
    await runSoftwareFactoryCommand({
      kind: "add-workstream-task",
      request: {
        projectId: "proj-1",
        programId: "p-1",
        workstreamId: "ws-1",
        task: {
          type: "build",
          description: "Compile",
          dependencies: ["t-2"],
          environmentRequirements: ["docker"],
        },
      },
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/commands/add-workstream-task");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      projectId: "proj-1",
      programId: "p-1",
      workstreamId: "ws-1",
      task: {
        type: "build",
        description: "Compile",
        dependencies: ["t-2"],
        environmentRequirements: ["docker"],
      },
    });
  });

  it("POSTs the project and program scope for tick-software-factory", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { ok: true, reason: "idle", correlationId: "c", auditEventId: "a", timestamp: "t" }));
    vi.stubGlobal("fetch", fetchMock);
    await runSoftwareFactoryCommand({ kind: "tick", request: { projectId: "proj-1", programId: "p-1" } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("/api/commands/tick-software-factory");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      projectId: "proj-1",
      programId: "p-1",
    });
  });
});

describe("error mapping", () => {
  it("turns a 404 into NOT_FOUND (a missing program is not an empty state)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(404, { error: { message: "unknown program: p-1" } })));
    const error = await getSoftwareFactoryProgramDetail("proj-1", "p-1").then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(SoftwareFactoryClientError);
    expect((error as SoftwareFactoryClientError).code).toBe("NOT_FOUND");
    expect((error as SoftwareFactoryClientError).message).toBe("unknown program: p-1");
  });

  it.each([
    [401, "UNAUTHENTICATED"],
    [403, "FORBIDDEN"],
    [409, "CONFLICT"],
    [500, "DEGRADED"],
  ])("distinguishes HTTP %s from an empty registry", async (status, expected) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(status, { error: { message: "nope" } })));
    const error = await getSoftwareFactoryOverview("proj-1").then(
      () => null,
      (e: unknown) => e,
    );
    expect((error as SoftwareFactoryClientError).code).toBe(expected);
  });
});