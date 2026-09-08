import { useContext } from "react";
import { AuthContext } from "./authContext";
import type { AuthSession } from "./auth.types";

export function useAuth(): AuthSession {
  const session = useContext(AuthContext);
  if (!session) {
    throw new Error("useAuth must be used within an <AuthProvider>");
  }
  return session;
}
