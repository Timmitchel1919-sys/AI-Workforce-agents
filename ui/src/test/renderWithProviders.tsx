import type { ReactElement, ReactNode } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthContext } from "../auth/authContext";
import { ApiContext } from "../app/providers/apiContext";
import { ThemeProvider } from "../theme";
import { ToastProvider } from "../components/ui";
import type { AuthSession } from "../auth/auth.types";
import type { ApiClient } from "../api";
import { makeStubApiClient, makeStubAuth } from "./stubs";

export interface ProviderOptions {
  route?: string;
  auth?: Partial<AuthSession>;
  apiClient?: ApiClient;
  queryClient?: QueryClient;
}

export function renderWithProviders(
  ui: ReactElement,
  options: ProviderOptions = {},
) {
  const auth = makeStubAuth(options.auth);
  const apiClient = options.apiClient ?? makeStubApiClient();
  const queryClient =
    options.queryClient ??
    new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <AuthContext.Provider value={auth}>
            <ApiContext.Provider value={apiClient}>
              <ToastProvider>
                <MemoryRouter initialEntries={[options.route ?? "/overview"]}>
                  {children}
                </MemoryRouter>
              </ToastProvider>
            </ApiContext.Provider>
          </AuthContext.Provider>
        </QueryClientProvider>
      </ThemeProvider>
    );
  }

  return {
    ...render(ui, { wrapper: Wrapper }),
    auth,
    apiClient,
  };
}
