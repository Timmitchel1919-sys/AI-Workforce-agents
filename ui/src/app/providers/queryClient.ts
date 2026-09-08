import { QueryClient } from "@tanstack/react-query";

/** Shared TanStack Query defaults. Kept conservative for UI-1. */
export function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
