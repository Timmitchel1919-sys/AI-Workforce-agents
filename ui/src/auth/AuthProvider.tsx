import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  getAuth,
  onIdTokenChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  validatePassword,
  type Auth,
  type User,
} from "firebase/auth";
import { initializeApp, getApps } from "firebase/app";
import { apiRequest } from "../api/client";
import type {
  AccessDetails,
  AccessState,
  AuthContextValue,
  AuthUser,
  PasswordPolicy,
  SignUpInput,
} from "./auth.types";
import { authContext } from "./authContext";
import { AuthFlowError } from "./authErrors";
import { DEFAULT_PASSWORD_POLICY } from "./passwordPolicy";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const firebaseConfigured =
  Boolean(firebaseConfig.apiKey) &&
  Boolean(firebaseConfig.authDomain) &&
  Boolean(firebaseConfig.projectId) &&
  Boolean(firebaseConfig.appId);

/** Mirrors `OPERATOR_ROLES` in contracts/control.ts. */
const OPERATOR_ROLES = ["viewer", "operator", "admin"] as const;
const NO_DETAILS: AccessDetails = { capabilities: [] };

/** `GET /api/me/access` (contracts/access.ts `MyAccessView`). */
interface MyAccessResponse {
  authorized: boolean;
  status: string;
  role?: string;
  capabilities?: readonly string[];
}

const STATUS_TO_ACCESS: Record<string, AccessState> = {
  pending: "pending",
  rejected: "rejected",
  suspended: "suspended",
  revoked: "revoked",
};

function getFirebaseAuth(): Auth {
  const app = getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);
  return getAuth(app);
}

function requireAuth(): Auth {
  if (!firebaseConfigured) {
    throw new AuthFlowError("not-configured");
  }
  return getFirebaseAuth();
}

function mapFirebaseUser(user: User): AuthUser {
  return {
    id: user.uid,
    email: user.email,
    displayName: user.displayName,
  };
}

/**
 * Ask the Control Plane — the only authority — what this identity may do.
 * Authentication (a Firebase token) alone never yields "granted".
 */
async function fetchAccess(token: string): Promise<{ access: AccessState; details: AccessDetails }> {
  try {
    const me = await apiRequest<MyAccessResponse>("/api/me/access", {
      method: "GET",
      accessToken: token,
    });
    if (me.authorized && me.status === "active") {
      const role = (OPERATOR_ROLES as readonly string[]).includes(me.role ?? "")
        ? (me.role as AccessDetails["role"])
        : undefined;
      return {
        access: "granted",
        details: { ...(role ? { role } : {}), capabilities: me.capabilities ?? [] },
      };
    }
    return { access: STATUS_TO_ACCESS[me.status] ?? "pending", details: NO_DETAILS };
  } catch {
    return { access: "unavailable", details: NO_DETAILS };
  }
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [access, setAccess] = useState<AccessState>("none");
  const [accessDetails, setAccessDetails] = useState<AccessDetails>(NO_DETAILS);
  const [loading, setLoading] = useState(firebaseConfigured);

  useEffect(() => {
    if (!firebaseConfigured) {
      return;
    }

    // Fires on sign-in, sign-out, and every token refresh, so the Control
    // Plane always receives a current ID token.
    return onIdTokenChanged(getFirebaseAuth(), async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setAccessToken(null);
        setAccess("none");
        setAccessDetails(NO_DETAILS);
        setLoading(false);
        return;
      }

      const token = await firebaseUser.getIdToken();
      const result = await fetchAccess(token);
      setUser(mapFirebaseUser(firebaseUser));
      setAccessToken(token);
      setAccess(result.access);
      setAccessDetails(result.details);
      setLoading(false);
    });
  }, []);

  const readAccess = useCallback(async (firebaseUser: User, forceRefresh: boolean) => {
    const token = await firebaseUser.getIdToken(forceRefresh);
    const result = await fetchAccess(token);
    setAccessToken(token);
    setAccess(result.access);
    setAccessDetails(result.details);
    return result.access;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      accessToken,
      configured: firebaseConfigured,
      access,
      accessDetails,
      signIn: async (email, password, remember) => {
        const auth = requireAuth();
        try {
          // Maps directly onto Firebase session persistence: local survives a
          // browser restart, session ends with the tab.
          await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
          const credential = await signInWithEmailAndPassword(auth, email, password);
          return await readAccess(credential.user, false);
        } catch (error) {
          throw AuthFlowError.from(error);
        }
      },
      signUp: async ({ displayName, email, password }: SignUpInput) => {
        const auth = requireAuth();
        try {
          const credential = await createUserWithEmailAndPassword(auth, email, password);
          const name = displayName?.trim();
          if (name) {
            // Stored on the Firebase Auth profile only — no Firestore write.
            await updateProfile(credential.user, { displayName: name });
            setUser(mapFirebaseUser(credential.user));
          }
          // A new account is recorded as PENDING by the Control Plane; access
          // is granted only by an administrator.
          return await readAccess(credential.user, false);
        } catch (error) {
          throw AuthFlowError.from(error);
        }
      },
      sendPasswordReset: async (email) => {
        const auth = requireAuth();
        try {
          await sendPasswordResetEmail(auth, email);
        } catch (error) {
          const flowError = AuthFlowError.from(error);
          // Never reveal whether an account exists for this address.
          if (flowError.kind === "invalid-credentials") return;
          throw flowError;
        }
      },
      refreshAccess: async () => {
        const current = requireAuth().currentUser;
        if (!current) {
          setAccess("none");
          setAccessDetails(NO_DETAILS);
          return "none";
        }
        try {
          return await readAccess(current, true);
        } catch (error) {
          throw AuthFlowError.from(error);
        }
      },
      getPasswordPolicy: async (): Promise<PasswordPolicy> => {
        if (!firebaseConfigured) return DEFAULT_PASSWORD_POLICY;
        try {
          // Fetches the project's policy; the password itself is evaluated
          // locally and never sent anywhere.
          const { passwordPolicy } = await validatePassword(getFirebaseAuth(), "");
          const options = passwordPolicy.customStrengthOptions;
          if (passwordPolicy.enforcementState !== "ENFORCE") return DEFAULT_PASSWORD_POLICY;
          return {
            minLength: Math.max(options.minPasswordLength ?? 6, 6),
            maxLength: options.maxPasswordLength,
            requireLowercase: Boolean(options.containsLowercaseLetter),
            requireUppercase: Boolean(options.containsUppercaseLetter),
            requireNumber: Boolean(options.containsNumericCharacter),
            requireSymbol: Boolean(options.containsNonAlphanumericCharacter),
            source: "project",
          };
        } catch {
          return DEFAULT_PASSWORD_POLICY;
        }
      },
      signOut: async () => {
        if (!firebaseConfigured) {
          setUser(null);
          setAccessToken(null);
          setAccess("none");
          setAccessDetails(NO_DETAILS);
          return;
        }

        await firebaseSignOut(getFirebaseAuth());
      },
    }),
    [user, loading, accessToken, access, accessDetails, readAccess],
  );

  return (
    <authContext.Provider value={value}>
      {children}
    </authContext.Provider>
  );
}
