import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { ApiProvider } from "../ApiProvider";
import { useApiClient } from "../apiContext";
import { AuthContext } from "../../../auth/authContext";
import { makeStubAuth } from "../../../test/stubs";

function Probe() {
  const client = useApiClient();
  useEffect(() => {
    void client.get("/status").catch(() => {});
  }, [client]);
  return <span>probe</span>;
}

describe("ApiProvider", () => {
  it("passes the auth session's id token to the API client as a Bearer token", async () => {
    const headerSeen: Record<string, string> = {};
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_url, init) => {
        Object.assign(
          headerSeen,
          (init?.headers ?? {}) as Record<string, string>,
        );
        return new Response("{}", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });

    const auth = makeStubAuth({
      getIdToken: vi.fn(async () => "token-from-firebase"),
    });

    render(
      <AuthContext.Provider value={auth}>
        <ApiProvider>
          <Probe />
        </ApiProvider>
      </AuthContext.Provider>,
    );

    await screen.findByText("probe");
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(headerSeen.authorization).toBe("Bearer token-from-firebase");
    expect(auth.getIdToken).toHaveBeenCalled();
  });
});
