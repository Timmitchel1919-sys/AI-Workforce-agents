import { useCallback } from "react";
import { useReport } from "../components/report";
import { useT } from "../lib/useT";
import { useCommand } from "./useCommand";
import type { CommandResult } from "../api/http";

/**
 * Fire one command and report the outcome in the page's live region. A refusal shows the server's own reason.
 * `onRefused` lets a caller react to a specific refusal (for example a breaking-change acknowledgement).
 */
export function useRunner() {
  const mutation = useCommand();
  const { report } = useReport();
  const { tt } = useT();
  const run = useCallback(
    (
      command: string,
      body: Record<string, unknown>,
      success: string | ((r: CommandResult) => string),
      hooks: { onDone?: (r: CommandResult) => void; onRefused?: (reason: string) => boolean } = {},
    ) => {
      mutation.mutate(
        { command, body },
        {
          onSuccess: (result) => {
            report({ tone: "success", message: typeof success === "function" ? success(result) : success });
            hooks.onDone?.(result);
          },
          onError: (error) => {
            const reason = error instanceof Error ? error.message : tt("error.networkBody");
            if (hooks.onRefused?.(reason)) return;
            report({ tone: "danger", message: reason });
          },
        },
      );
    },
    [mutation, report, tt],
  );
  return { run, pending: mutation.isPending };
}
