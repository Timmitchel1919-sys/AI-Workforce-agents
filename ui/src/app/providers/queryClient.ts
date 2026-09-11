import { QueryClient } from "@tanstack/react-query";
import { isApiError } from "../../api";

/**
 * Shared TanStack Query defaults for the Control Center.
 *
 * - `staleTime` 15s: dense ops data goes stale quickly but not on every render.
 * - `gcTime` 5m: keep unused caches around for quick back-navigation.
 * - `retry`: one retry, but NEVER for a client error (4xx) — those won't fix
 *   themselves. Transient failures (network / timeout / 5xx) get the retry.
 * - `refetchOnWindowFocus` off globally; specific queries (API status) opt in.
 */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          if (isApiError(error)) {
            const noRetry =
              error.category === "unauthenticated" ||
              error.category === "forbidden" ||
              error.category === "not_found" ||
              error.category === "validation" ||
              error.category === "conflict";
            if (noRetry) return false;
          }
          return failureCount < 1;
        },
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
