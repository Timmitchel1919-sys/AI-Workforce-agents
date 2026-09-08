import { createContext, useContext } from "react";
import type { ApiClient } from "../../api";

export const ApiContext = createContext<ApiClient | null>(null);

export function useApiClient(): ApiClient {
  const client = useContext(ApiContext);
  if (!client) {
    throw new Error("useApiClient must be used within an <ApiProvider>");
  }
  return client;
}
