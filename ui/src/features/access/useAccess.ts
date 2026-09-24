import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../auth/useAuth";
import {
  AccessClientError,
  getOperators,
  runAccessCommand,
  type AccessCommand,
  type AccessCommandBody,
  type OperatorAccountView,
} from "./accessClient";

const OPERATORS_KEY = ["workforce", "operators"] as const;

export type OperatorsUiState = "loading" | "ready" | "forbidden" | "error";

export function useOperators(): {
  status: OperatorsUiState;
  operators: readonly OperatorAccountView[];
  refetch: () => Promise<unknown>;
} {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: [...OPERATORS_KEY, accessToken ?? "anonymous"],
    queryFn: () => getOperators(accessToken),
    retry: false,
    staleTime: 10_000,
  });
  if (query.isLoading) return { status: "loading", operators: [], refetch: query.refetch };
  if (query.error) {
    const forbidden =
      query.error instanceof AccessClientError &&
      (query.error.failure === "forbidden" || query.error.failure === "unauthenticated");
    return { status: forbidden ? "forbidden" : "error", operators: [], refetch: query.refetch };
  }
  return { status: "ready", operators: query.data ?? [], refetch: query.refetch };
}

export function useAccessCommand() {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ command, body }: { command: AccessCommand; body: AccessCommandBody }) =>
      runAccessCommand(command, body, accessToken),
    onSettled: () => client.invalidateQueries({ queryKey: OPERATORS_KEY }),
  });
}
