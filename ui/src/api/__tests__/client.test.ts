import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, setAccessTokenProvider } from "../client";
import { ApiError } from "../errors";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  setAccessTokenProvider(null);
  vi.unstubAllGlobals();
});

describe("apiRequest ID tokens", () => {
  it("sends the CURRENT token from the provider, not a stale captured one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    setAccessTokenProvider(async () => "fresh-token");
    await apiRequest("/api/agents", { accessToken: "stale-token" });
    const headers = fetchMock.mock.calls[0]![1].headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer fresh-token");
  });

  it("retries a 401 once with a force-refreshed token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(401, { error: { message: "authentication required" } }))
      .mockResolvedValueOnce(json(200, { agents: [] }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = vi.fn(async (force: boolean) => (force ? "refreshed" : "cached"));
    setAccessTokenProvider(provider);
    await expect(apiRequest("/api/agents", { accessToken: "x" })).resolves.toEqual({ agents: [] });
    expect(provider).toHaveBeenLastCalledWith(true);
    expect((fetchMock.mock.calls[1]![1].headers as Headers).get("Authorization")).toBe("Bearer refreshed");
  });

  it("surfaces a 401 when refreshing does not help, and never adds a token to anonymous calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(401, {}));
    vi.stubGlobal("fetch", fetchMock);
    setAccessTokenProvider(async () => "same");
    await expect(apiRequest("/api/agents", { accessToken: "same" })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await expect(apiRequest("/api/status")).rejects.toBeInstanceOf(ApiError);
    expect((fetchMock.mock.calls[1]![1].headers as Headers).get("Authorization")).toBeNull();
  });

  it("preserves the Control Plane error message from its response envelope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(400, { error: { message: "objective must not be empty" } })));

    const error = await apiRequest("/api/commands/create-program", { method: "POST" }).then(
      () => null,
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe("objective must not be empty");
  });
});
