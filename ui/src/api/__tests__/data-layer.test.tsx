import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiContext } from "../../app/providers/apiContext";
import type { ApiClient } from "../client";
import { ApiError } from "../errors";
import { queryKeys } from "../queryKeys";
import { invalidateForCommand } from "../invalidation";
import { parseResponse } from "../index";
import { assertConfig, type AppConfig } from "../../lib/config";
import { useAgents } from "../../features/agents";
import { useCancelTask } from "../../features/tasks";

function makeWrapper(client: Partial<ApiClient>) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const full = {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    ...client,
  } as ApiClient;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ApiContext.Provider value={full}>{children}</ApiContext.Provider>
    </QueryClientProvider>
  );
  return { wrapper, qc };
}

const AGENT = {
  agentId: "a1",
  name: "Research",
  role: "research",
  status: "available",
  capabilities: [],
  enabled: true,
  allowedProjects: ["*"],
  stats: {
    taskCount: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    successRate: null,
  },
};

describe("query hooks", () => {
  it("useAgents: loading → success with data", async () => {
    const { wrapper } = makeWrapper({
      get: vi.fn(async () => ({
        data: [AGENT],
        status: 200,
        correlationId: "c",
      })) as unknown as ApiClient["get"],
    });
    const { result } = renderHook(() => useAgents(), { wrapper });

    expect(result.current.isPending).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(1);
    expect(result.current.data?.[0]?.agentId).toBe("a1");
  });

  it("useAgents: an ApiError surfaces as isError with category", async () => {
    const { wrapper } = makeWrapper({
      get: vi.fn(async () => {
        throw new ApiError({
          kind: "forbidden",
          message: "nope",
          status: 403,
          correlationId: "cid",
        });
      }),
    });
    const { result } = renderHook(() => useAgents(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    const err = result.current.error;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).category).toBe("forbidden");
  });

  it("useAgents: a malformed payload becomes a boundary error", async () => {
    const { wrapper } = makeWrapper({
      get: vi.fn(async () => ({
        data: [{ notAnAgent: true }],
        status: 200,
        correlationId: "c",
      })) as unknown as ApiClient["get"],
    });
    const { result } = renderHook(() => useAgents(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe("mutations + invalidation", () => {
  it("useCancelTask calls the command and invalidates task queries", async () => {
    const post = vi.fn(async () => ({
      data: { command: "cancel_task", outcome: "executed", ok: true },
      status: 200,
      correlationId: "c",
    })) as unknown as ApiClient["post"];
    const { wrapper, qc } = makeWrapper({ post });
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    const { result } = renderHook(() => useCancelTask(), { wrapper });
    await result.current.mutateAsync({ taskId: "t-9", reason: "stop" });

    expect(post).toHaveBeenCalledWith("/commands/cancel-task", {
      taskId: "t-9",
      reason: "stop",
    });
    const keys = invalidateSpy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toContainEqual(queryKeys.tasks.all);
    expect(keys).toContainEqual(queryKeys.tasks.detail("t-9"));
    expect(keys).toContainEqual(queryKeys.workflows.all);
  });
});

describe("invalidateForCommand map", () => {
  it("approve touches approvals, tasks, workflows, dashboard", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    await invalidateForCommand(qc, "approve", { taskId: "t1" });
    const keys = spy.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(queryKeys.approvals.all));
    expect(keys).toContain(JSON.stringify(queryKeys.tasks.all));
    expect(keys).toContain(JSON.stringify(queryKeys.workflows.all));
    expect(keys).toContain(JSON.stringify(queryKeys.dashboard.all));
    expect(keys).toContain(JSON.stringify(queryKeys.tasks.detail("t1")));
  });
});

describe("response schemas", () => {
  it("accepts a valid agent list and rejects a bad enum", () => {
    expect(() => parseResponse.agentList([AGENT])).not.toThrow();
    expect(() =>
      parseResponse.agentList([{ ...AGENT, status: "on-fire" }]),
    ).toThrow();
  });

  it("validates PageResult shape (items / total / nextCursor)", () => {
    const page = {
      items: [
        {
          taskId: "t1",
          status: "queued",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      total: 1,
      nextCursor: null,
    };
    expect(() => parseResponse.taskPage(page)).not.toThrow();
    expect(() => parseResponse.taskPage({ items: [], total: "x" })).toThrow();
  });
});

describe("config validation", () => {
  const base: AppConfig = {
    apiBaseUrl: "/api",
    apiTimeoutMs: 20000,
    mode: "production",
    isDev: false,
    isProd: true,
    isTest: false,
  };
  it("prod build with the dev default `/api` throws", () => {
    expect(() => assertConfig(base)).toThrow(/VITE_API_BASE_URL/);
  });
  it("prod build with a relative URL throws", () => {
    expect(() => assertConfig({ ...base, apiBaseUrl: "api/v1" })).toThrow();
  });
  it("prod build with an absolute https URL is fine", () => {
    expect(() =>
      assertConfig({ ...base, apiBaseUrl: "https://cp.example.com/api" }),
    ).not.toThrow();
  });
  it("dev build never throws", () => {
    expect(() =>
      assertConfig({
        ...base,
        isProd: false,
        isDev: true,
        mode: "development",
      }),
    ).not.toThrow();
  });
});
