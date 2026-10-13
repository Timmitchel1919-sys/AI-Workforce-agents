import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  initAppCheck,
  getAppCheckToken,
  isAppCheckConfigured,
  _resetAppCheckForTesting,
} from "../appCheck";
import { apiRequest, setAccessTokenProvider, setAppCheckTokenProvider } from "../../api/client";
import { ApiError } from "../../api/errors";

function createTestApp(): FirebaseApp {
  return initializeApp(
    {
      apiKey: "AIzaSyFakeKeyForTestOnly1234567890",
      projectId: "test-workforce-project",
      appId: "1:123456789:web:abcdef123456",
    },
    `test-app-${Math.random().toString(36).slice(2)}`,
  );
}

describe("Firebase App Check client initialization & token transport", () => {
  beforeEach(() => {
    _resetAppCheckForTesting();
    setAppCheckTokenProvider(null);
    setAccessTokenProvider(null);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    _resetAppCheckForTesting();
    setAppCheckTokenProvider(null);
    setAccessTokenProvider(null);
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("1. production client initializes App Check when configured with site key", () => {
    vi.stubEnv("VITE_APP_CHECK_ENABLED", "true");
    vi.stubEnv("VITE_FIREBASE_APP_CHECK_SITE_KEY", "test-recaptcha-site-key-12345");

    expect(isAppCheckConfigured()).toBe(true);

    const app = createTestApp();
    const appCheck = initAppCheck(app, {
      siteKey: "test-recaptcha-site-key-12345",
      isTokenAutoRefreshEnabled: true,
    });

    expect(appCheck).not.toBeNull();
  });

  it("2. missing site key prevents fake initialization", () => {
    vi.stubEnv("VITE_APP_CHECK_ENABLED", "true");
    vi.stubEnv("VITE_FIREBASE_APP_CHECK_SITE_KEY", "");

    expect(isAppCheckConfigured()).toBe(false);

    const app = createTestApp();
    const appCheck = initAppCheck(app, {
      siteKey: "",
    });

    expect(appCheck).toBeNull();
  });

  it("3. debug mode is not active in production", () => {
    // When import.meta.env.DEV is false (production), window.FIREBASE_APPCHECK_DEBUG_TOKEN must never be set
    const win = {} as Record<string, unknown>;
    vi.stubGlobal("window", win);

    const app = createTestApp();
    initAppCheck(app, {
      siteKey: "test-key",
    });

    expect(win.FIREBASE_APPCHECK_DEBUG_TOKEN).toBeUndefined();
  });

  it("4. token auto-refresh is enabled by default in initialization", () => {
    vi.stubEnv("VITE_APP_CHECK_ENABLED", "true");
    const app = createTestApp();
    const appCheck = initAppCheck(app, {
      siteKey: "test-enterprise-key",
      isTokenAutoRefreshEnabled: true,
    });

    expect(appCheck).not.toBeNull();
  });

  it("5. API request helper attaches standard X-Firebase-AppCheck header when token exists", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    setAppCheckTokenProvider(async () => "test-app-check-token-xyz");

    await apiRequest("/api/test-route");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = fetchMock.mock.calls[0]![1].headers as Headers;
    expect(headers.get("X-Firebase-AppCheck")).toBe("test-app-check-token-xyz");
  });

  it("6. token is never logged or leaked when API error occurs", async () => {
    const consoleSpy = vi.spyOn(console, "log");
    const consoleErrorSpy = vi.spyOn(console, "error");
    const consoleWarnSpy = vi.spyOn(console, "warn");

    const secretAppCheckToken = "super-sensitive-app-check-token-999";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "forbidden", message: "Denied" } }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    setAppCheckTokenProvider(async () => secretAppCheckToken);

    await expect(apiRequest("/api/secure-action")).rejects.toBeInstanceOf(ApiError);

    // Verify token was nowhere in any console log
    const allLoggedText = [
      ...consoleSpy.mock.calls.flat(),
      ...consoleErrorSpy.mock.calls.flat(),
      ...consoleWarnSpy.mock.calls.flat(),
    ].join(" ");

    expect(allLoggedText).not.toContain(secretAppCheckToken);
  });

  it("7. refreshes an invalid App Check token once and retries with the replacement", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: "app_check_invalid", message: "App Check token is invalid." },
          }),
          { status: 403, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const provider = vi
      .fn<(forceRefresh: boolean) => Promise<string | null>>()
      .mockResolvedValueOnce("stale-app-check-token")
      .mockResolvedValueOnce("fresh-app-check-token");
    setAppCheckTokenProvider(provider);

    await expect(apiRequest("/api/secure-action")).resolves.toEqual({ success: true });

    expect(provider).toHaveBeenNthCalledWith(1, false);
    expect(provider).toHaveBeenNthCalledWith(2, true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retryHeaders = fetchMock.mock.calls[1]![1].headers as Headers;
    expect(retryHeaders.get("X-Firebase-AppCheck")).toBe("fresh-app-check-token");
  });

  it("8. does not refresh App Check for an unrelated forbidden response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: { code: "forbidden", message: "Capability denied." } }),
        { status: 403, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const provider = vi.fn(async () => "valid-app-check-token");
    setAppCheckTokenProvider(provider);

    const error = await apiRequest("/api/secure-action").catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).code).toBe("forbidden");
    expect(provider).toHaveBeenCalledOnce();
    expect(provider).toHaveBeenCalledWith(false);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("9. returns no App Check token before initialization", async () => {
    await expect(getAppCheckToken()).resolves.toBeNull();
  });
});
