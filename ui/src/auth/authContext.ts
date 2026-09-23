import { createContext, useContext } from "react";
import type { AuthContextValue } from "./auth.types";

export const authContext = createContext<AuthContextValue | undefined>(
  undefined,
);

export function useAuthContext(): AuthContextValue {
  const context = useContext(authContext);

  if (!context) {
    throw new Error("useAuthContext must be used inside AuthProvider");
  }

  return context;
}