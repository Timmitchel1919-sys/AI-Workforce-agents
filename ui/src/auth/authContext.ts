import { createContext } from "react";
import type { AuthSession } from "./auth.types";

/** Provided by `AuthProvider` (real Firebase) or a test double. */
export const AuthContext = createContext<AuthSession | null>(null);
