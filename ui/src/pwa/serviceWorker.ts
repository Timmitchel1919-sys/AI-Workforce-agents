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

let waitingWorker: ServiceWorker | null = null;
let updateAvailable = false;
let reloading = false;
const updateListeners = new Set<() => void>();

function publishUpdate(worker: ServiceWorker) {
  waitingWorker = worker;
  updateAvailable = true;
  updateListeners.forEach((listener) => listener());
}

export function subscribeToServiceWorkerUpdate(listener: () => void) {
  updateListeners.add(listener);
  return () => {
    updateListeners.delete(listener);
  };
}

export function getServiceWorkerUpdateSnapshot() {
  return updateAvailable;
}

export function activateServiceWorkerUpdate() {
  if (!waitingWorker) return;
  reloading = true;
  waitingWorker.postMessage({ type: "SKIP_WAITING" });
}

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
  if (import.meta.env.PROD && container) {
    const registration = await container.register(SERVICE_WORKER_URL);
    const showWaitingUpdate = () => {
      if (registration.waiting && navigator.serviceWorker.controller) {
        publishUpdate(registration.waiting);
      }
    };

    showWaitingUpdate();
    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      installing?.addEventListener("statechange", () => {
        if (installing.state === "installed") showWaitingUpdate();
      });
    });
    container.addEventListener("controllerchange", () => {
      if (reloading) window.location.reload();
    });
    return;
  }

  await syncServiceWorker({
    isProduction: false,
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
