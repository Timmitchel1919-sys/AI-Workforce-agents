import { useContext } from "react";
import { WorkspaceContext } from "./workspaceContextState";

export function useWorkspaceContext() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspaceContext must be used inside WorkspaceContextProvider");
  return value;
}
