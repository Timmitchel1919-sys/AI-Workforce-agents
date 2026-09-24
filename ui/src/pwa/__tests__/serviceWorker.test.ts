import { describe, expect, it, vi } from "vitest";
import { SERVICE_WORKER_URL, syncServiceWorker } from "../serviceWorker";

function makeEnv(cacheKeys: string[] = []) {
  const unregister = vi.fn().mockResolvedValue(true);
  const serviceWorker = {
    register: vi.fn().mockResolvedValue({}),
    getRegistrations: vi.fn().mockResolvedValue([{ unregister }, { unregister }]),
  };
  const cacheStorage = {
    keys: vi.fn().mockResolvedValue(cacheKeys),
    delete: vi.fn().mockResolvedValue(true),
  };
  return {
    unregister,
    serviceWorker: serviceWorker as unknown as Pick<
      ServiceWorkerContainer,
      "register" | "getRegistrations"
    >,
    cacheStorage: cacheStorage as unknown as Pick<CacheStorage, "keys" | "delete">,
    mocks: { serviceWorker, cacheStorage },
  };
}

describe("syncServiceWorker", () => {
  it("registers the worker in production and leaves caches alone", async () => {
    const env = makeEnv(["ai-workforce-shell-v1"]);
    await syncServiceWorker({ isProduction: true, ...env });

    expect(env.mocks.serviceWorker.register).toHaveBeenCalledWith(SERVICE_WORKER_URL);
    expect(env.mocks.serviceWorker.getRegistrations).not.toHaveBeenCalled();
    expect(env.mocks.cacheStorage.delete).not.toHaveBeenCalled();
  });

  it("never registers in development and cleans up prior installs", async () => {
    const env = makeEnv(["ai-workforce-shell-v1", "unrelated-cache"]);
    await syncServiceWorker({ isProduction: false, ...env });

    expect(env.mocks.serviceWorker.register).not.toHaveBeenCalled();
    expect(env.unregister).toHaveBeenCalledTimes(2);
    expect(env.mocks.cacheStorage.delete).toHaveBeenCalledTimes(1);
    expect(env.mocks.cacheStorage.delete).toHaveBeenCalledWith("ai-workforce-shell-v1");
  });

  it("tolerates browsers without service worker or cache support", async () => {
    await expect(syncServiceWorker({ isProduction: true })).resolves.toBeUndefined();
    await expect(syncServiceWorker({ isProduction: false })).resolves.toBeUndefined();
  });
});
