import { describe, expect, it, vi } from "vitest";
import { createApiClient } from "../client";
import { ApiError } from "../errors";

interface FetchCall {
  url: string;
  init: RequestInit;
}

function jsonResponse(
  body: unknown,
  init: { status?: number; headers?: Record<string, string> } = {},
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

function makeClient(
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
  token: string | null = "id-token-123",
) {
  const calls: FetchCall[] = [];
  const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return fetchImpl(url, init);
  }) as unknown as typeof fetch;
  const client = createApiClient({
    baseUrl: "/api",
    getToken: async () => token,
    generateCorrelationId: () => "corr-fixed",
    fetchFn,
  });
  return { client, calls };
}

describe("api client — success", () => {
  it("GET returns parsed data and the echoed correlation id", async () => {
    const { client, calls } = makeClient(async () =>
      jsonResponse(
        { ok: true },
        { headers: { "x-correlation-id": "corr-echoed" } },
      ),
    );
    const result = await client.get<{ ok: boolean }>("/status");
    expect(result.data).toEqual({ ok: true });
    expect(result.status).toBe(200);
    expect(result.correlationId).toBe("corr-echoed");
    expect(calls[0]!.init.method).toBe("GET");
  });

  it("sends the Bearer token and correlation id headers", async () => {
    const { client, calls } = makeClient(async () => jsonResponse({}));
    await client.get("/agents");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer id-token-123");
    expect(headers["x-correlation-id"]).toBe("corr-fixed");
  });

  it("omits the Authorization header when unauthenticated", async () => {
    const { client, calls } = makeClient(async () => jsonResponse({}), null);
    await client.get("/health");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
  });

  it("POST serializes the body and sets content-type", async () => {
    const { client, calls } = makeClient(async () =>
      jsonResponse({ outcome: "executed" }),
    );
    const result = await client.post<{ outcome: string }>("/commands/approve", {
      approvalId: "ap-1",
    });
    expect(result.data.outcome).toBe("executed");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(calls[0]!.init.body).toBe(JSON.stringify({ approvalId: "ap-1" }));
  });

  it("appends defined query params only", async () => {
    const { client, calls } = makeClient(async () => jsonResponse({}));
    await client.get("/tasks", {
      query: { status: "failed", limit: 5, cursor: undefined, blank: "" },
    });
    expect(calls[0]!.url).toBe("/api/tasks?status=failed&limit=5");
  });
});

describe("api client — error normalization", () => {
  const cases: Array<[number, ApiError["kind"], string]> = [
    [400, "bad_request", "validation"],
    [401, "unauthorized", "unauthenticated"],
    [403, "forbidden", "forbidden"],
    [404, "not_found", "not_found"],
    [409, "conflict", "conflict"],
    [422, "unprocessable", "validation"],
    [429, "rate_limited", "rate_limited"],
    [500, "server_error", "server_error"],
    [503, "service_unavailable", "server_error"],
  ];

  for (const [status, kind, category] of cases) {
    it(`${status} → kind "${kind}" / category "${category}" with the server message`, async () => {
      const { client } = makeClient(async () =>
        jsonResponse({ error: { message: `boom ${status}` } }, { status }),
      );
      const error = await client.get("/status").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.kind).toBe(kind);
      expect(apiError.category).toBe(category);
      expect(apiError.status).toBe(status);
      expect(apiError.message).toBe(`boom ${status}`);
      expect(JSON.stringify(apiError)).not.toContain("\n    at ");
    });
  }

  it("network failure → kind network (category network)", async () => {
    const { client } = makeClient(async () => {
      throw new TypeError("Failed to fetch");
    });
    const error = await client.get("/status").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe("network");
    expect((error as ApiError).category).toBe("network");
  });

  it("a request that never resolves → kind timeout", async () => {
    const { client } = makeClient(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
          );
        }),
    );
    const error = await client
      .get("/status", { timeoutMs: 10 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe("timeout");
    expect((error as ApiError).category).toBe("timeout");
  });

  it("malformed 2xx body → kind malformed_response", async () => {
    const { client } = makeClient(
      async () =>
        new Response("not json", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const error = await client.get("/status").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe("malformed_response");
  });

  it("a rejecting `parse` → kind malformed_response", async () => {
    const { client } = makeClient(async () => jsonResponse({ wrong: true }));
    const error = await client
      .get("/status", {
        parse: () => {
          throw new Error("missing `status`");
        },
      })
      .catch((e: unknown) => e);
    expect((error as ApiError).kind).toBe("malformed_response");
    expect((error as ApiError).message).toContain("missing `status`");
  });
});

describe("api client — methods & logging", () => {
  it("PATCH and DELETE send a JSON content-type and body", async () => {
    const { client, calls } = makeClient(async () =>
      jsonResponse({ ok: true }),
    );
    await client.patch("/x", { a: 1 });
    await client.delete("/y");
    expect(calls[0]!.init.method).toBe("PATCH");
    expect(
      (calls[0]!.init.headers as Record<string, string>)["content-type"],
    ).toBe("application/json");
    expect(calls[0]!.init.body).toBe(JSON.stringify({ a: 1 }));
    expect(calls[1]!.init.method).toBe("DELETE");
  });

  it("the logger receives safe diagnostics only (no token / headers / body)", async () => {
    const entries: unknown[] = [];
    const client = createApiClient({
      baseUrl: "/api",
      getToken: async () => "SECRET-TOKEN",
      generateCorrelationId: () => "cid-1",
      fetchFn: (async () =>
        jsonResponse({ ok: true })) as unknown as typeof fetch,
      logger: (e) => entries.push(e),
    });
    await client.post("/commands/approve", { approvalId: "ap-1" });
    const json = JSON.stringify(entries);
    expect(json).toContain("cid-1");
    expect(json).toContain("/commands/approve");
    expect(json).not.toContain("SECRET-TOKEN");
    expect(json).not.toContain("approvalId");
    expect(json).not.toMatch(/authorization/i);
  });
});
