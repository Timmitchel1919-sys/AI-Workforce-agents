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
  const cases: Array<[number, ApiError["kind"]]> = [
    [400, "bad_request"],
    [401, "unauthorized"],
    [403, "forbidden"],
    [404, "not_found"],
    [409, "conflict"],
    [422, "unprocessable"],
    [500, "server_error"],
  ];

  for (const [status, kind] of cases) {
    it(`${status} → ApiError kind "${kind}" with the server message`, async () => {
      const { client } = makeClient(async () =>
        jsonResponse({ error: { message: `boom ${status}` } }, { status }),
      );
      const error = await client.get("/status").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ApiError);
      const apiError = error as ApiError;
      expect(apiError.kind).toBe(kind);
      expect(apiError.status).toBe(status);
      expect(apiError.message).toBe(`boom ${status}`);
      expect(JSON.stringify(apiError)).not.toContain("\n    at ");
    });
  }

  it("network failure → ApiError kind network", async () => {
    const { client } = makeClient(async () => {
      throw new TypeError("Failed to fetch");
    });
    const error = await client.get("/status").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe("network");
  });

  it("malformed 2xx body → ApiError kind malformed_response", async () => {
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
});
