import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../../../api/queryKeys";
import { useAuth } from "../../../auth/useAuth";
import {
  getSoftwareFactoryOverview,
  getSoftwareFactoryProgramDetail,
  runSoftwareFactoryCommand,
  SoftwareFactoryClientError,
  type SoftwareFactoryCommand,
} from "../api/softwareFactoryClient";
import type { SoftwareFactoryClientErrorCode } from "../api/softwareFactoryTypes";

/**
 * Satellite UI state for one read. 401, 403, 404, 409 and 5xx stay
 * distinguishable — a 403 is never "empty" and a missing program is not
 * "this feature is down".
 */
export type SoftwareFactoryUiState =
  | "loading"
  | "ready"
  | "empty"
  | "not_found"
  | "unauthenticated"
  | "forbidden"
  | "conflict"
  | "error";

export type SoftwareFactoryFailureState = Exclude<SoftwareFactoryUiState, "loading" | "ready" | "empty">;

export function stateForError(error: unknown): SoftwareFactoryFailureState {
  const code: SoftwareFactoryClientErrorCode | undefined = error instanceof SoftwareFactoryClientError ? error.code : undefined;
  switch (code) {
    case "UNAUTHENTICATED":
      return "unauthenticated";
    case "FORBIDDEN":
      return "forbidden";
    case "NOT_FOUND":
      return "not_found";
    case "CONFLICT":
      return "conflict";
    default:
      return "error";
  }
}

function useToken() {
  return useAuth().accessToken ?? "anonymous";
}

const softwareFactoryKey = () => queryKeys.softwareFactory();
const detailKey = (projectId: string | undefined, programId: string | undefined) =>
  [...softwareFactoryKey(), "detail", projectId, programId] as const;

/** `GET /api/software-factory?projectId=…` — the project-scoped program list. */
export function useSoftwareFactoryPrograms(projectId: string | undefined) {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: [...softwareFactoryKey(), "list", projectId ?? "all", useToken()],
    queryFn: () => getSoftwareFactoryOverview(projectId, accessToken),
    enabled: Boolean(projectId),
    retry: false,
    staleTime: 30_000,
  });
  const programs = query.data?.programs ?? [];
  const status: SoftwareFactoryUiState = !projectId
    ? "empty"
    : query.isLoading
      ? "loading"
      : query.error
        ? stateForError(query.error)
        : programs.length === 0
          ? "empty"
          : "ready";
  return { status, programs, refetch: query.refetch };
}

/** `GET /api/software-factory/programs/:programId` — detail view. */
export function useSoftwareFactoryProgram(
  projectId: string | undefined,
  programId: string | undefined,
) {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: [...detailKey(projectId, programId), useToken()],
    queryFn: () =>
      getSoftwareFactoryProgramDetail(projectId ?? "", programId ?? "", accessToken),
    enabled: Boolean(projectId && programId),
    retry: false,
    staleTime: 15_000,
  });
  const status: SoftwareFactoryUiState = !projectId || !programId
    ? "not_found"
    : query.isLoading
      ? "loading"
      : query.error
        ? stateForError(query.error)
        : query.data
          ? "ready"
          : "empty";
  return { status, program: query.data, refetch: query.refetch };
}

/**
 * Software Factory commands (create-program, create-workstream,
 * add-workstream-task, tick). Every command invalidates the list and the
 * detail views so the next paint reflects the backend's new state.
 */
export function useSoftwareFactoryCommand(
  projectId?: string,
  programId?: string,
) {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (command: SoftwareFactoryCommand) => runSoftwareFactoryCommand(command, accessToken),
    onSettled: () => {
      client.invalidateQueries({ queryKey: softwareFactoryKey() });
      if (projectId && programId) {
        client.invalidateQueries({ queryKey: detailKey(projectId, programId) });
      }
    },
  });
}