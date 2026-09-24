/**
 * Service worker lifecycle.
 *
 * Production registers /service-worker.js (cache-first for content-hashed
 * Vite assets, which is safe). The dev server serves unhashed source modules
 * (e.g. /src/i18n/locales/en.ts), which the worker would cache and keep
 * serving after edits — so in development we never register it, and we
 * actively unregister any previously installed worker and clear its caches
 * so existing dev browsers recover without manual cleanup.
 */

export const SERVICE_WORKER_URL = "/service-worker.js";
export const APP_CACHE_PREFIX = "ai-workforce-";

export interface ServiceWorkerEnv {
  isProduction: boolean;
  serviceWorker?: Pick<
    ServiceWorkerContainer,
    "register" | "getRegistrations"
  >;
  cacheStorage?: Pick<CacheStorage, "keys" | "delete">;
}

export async function registerServiceWorker(): Promise<void> {
  const container =
    typeof navigator !== "undefined" && "serviceWorker" in navigator
      ? navigator.serviceWorker
      : undefined;
  await syncServiceWorker({
    isProduction: import.meta.env.PROD,
    serviceWorker: container,
    cacheStorage: typeof caches !== "undefined" ? caches : undefined,
  });
}

export async function syncServiceWorker(env: ServiceWorkerEnv): Promise<void> {
  const { isProduction, serviceWorker, cacheStorage } = env;

  if (isProduction) {
    if (serviceWorker) await serviceWorker.register(SERVICE_WORKER_URL);
    return;
  }

  if (serviceWorker) {
    const registrations = await serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
  }

  if (cacheStorage) {
    const keys = await cacheStorage.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(APP_CACHE_PREFIX))
        .map((key) => cacheStorage.delete(key)),
    );
  }
}
