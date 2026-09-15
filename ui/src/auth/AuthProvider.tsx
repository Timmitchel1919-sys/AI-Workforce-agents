import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  GoogleAuthProvider,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { getFirebaseAuth } from "./firebaseClient";
import { AuthContext } from "./authContext";
import type { AuthSession, AuthStatus, AuthUser } from "./auth.types";
import type { OperatorRole } from "../api/contracts";

const OPERATOR_ROLES: readonly OperatorRole[] = ["viewer", "operator", "admin"];

interface Claims {
  role: OperatorRole | null;
  allowedProjects: readonly string[] | "*" | null;
}

function parseClaims(raw: Record<string, unknown>): Claims {
  const role =
    typeof raw.role === "string" &&
    (OPERATOR_ROLES as readonly string[]).includes(raw.role)
      ? (raw.role as OperatorRole)
      : null;

  let allowedProjects: Claims["allowedProjects"] = null;
  if (raw.allowedProjects === "*") {
    allowedProjects = "*";
  } else if (
    Array.isArray(raw.allowedProjects) &&
    raw.allowedProjects.every((p) => typeof p === "string")
  ) {
    allowedProjects = raw.allowedProjects as string[];
  }
  return { role, allowedProjects };
}

function toAuthUser(user: User): AuthUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
  };
}

function friendlySignInError(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  switch (code) {
    case "auth/invalid-email":
      return "That email address is not valid.";
    case "auth/user-disabled":
      return "This account has been disabled.";
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password.";
    case "auth/too-many-requests":
      return "Too many attempts. Try again later.";
    case "auth/network-request-failed":
      return "Network error while signing in.";
    case "auth/popup-closed-by-user":
      return "Google sign-in was cancelled.";
    case "auth/popup-blocked":
      return "Your browser blocked the Google sign-in window. Allow pop-ups and try again.";
    case "auth/operation-not-allowed":
      return "Google sign-in is not enabled for this Firebase project.";
    case "auth/account-exists-with-different-credential":
      return "This email address already uses a different sign-in method.";
    default:
      return "Sign-in failed. Please try again.";
  }
}

interface State {
  status: AuthStatus;
  user: AuthUser | null;
  role: OperatorRole | null;
  allowedProjects: readonly string[] | "*" | null;
  error: string | null;
}

const INITIAL: State = {
  status: "loading",
  user: null,
  role: null,
  allowedProjects: null,
  error: null,
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>(INITIAL);

  useEffect(() => {
    try {
      const auth = getFirebaseAuth();
      return onIdTokenChanged(
        auth,
        (user) => {
          if (!user) {
            setState({ ...INITIAL, status: "unauthenticated" });
            return;
          }
          user
            .getIdTokenResult()
            .then((result) => {
              const { role, allowedProjects } = parseClaims(
                result.claims as Record<string, unknown>,
              );
              setState({
                status: "authenticated",
                user: toAuthUser(user),
                role,
                allowedProjects,
                error: null,
              });
            })
            .catch(() => {
              setState({
                ...INITIAL,
                status: "error",
                error: "Could not read your operator profile.",
              });
            });
        },
        () => {
          setState({
            ...INITIAL,
            status: "error",
            error: "Authentication service is unavailable.",
          });
        },
      );
    } catch {
      setState({
        ...INITIAL,
        status: "error",
        error: "Authentication is not configured for this environment.",
      });
      return undefined;
    }
  }, []);

  const getIdToken = useCallback(async () => {
    const current = getFirebaseAuth().currentUser;
    return current ? current.getIdToken() : null;
  }, []);

  const signInWithEmail = useCallback(
    async (email: string, password: string) => {
      try {
        await signInWithEmailAndPassword(getFirebaseAuth(), email, password);
      } catch (error) {
        const message = friendlySignInError(error);
        setState((prev) => ({ ...prev, error: message }));
        throw new Error(message);
      }
    },
    [],
  );

  const signInWithGoogle = useCallback(async () => {
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(getFirebaseAuth(), provider);
    } catch (error) {
      const message = friendlySignInError(error);
      setState((prev) => ({ ...prev, error: message }));
      throw new Error(message);
    }
  }, []);

  const signOut = useCallback(async () => {
    await firebaseSignOut(getFirebaseAuth());
  }, []);

  const session = useMemo<AuthSession>(
    () => ({
      status: state.status,
      user: state.user,
      role: state.role,
      allowedProjects: state.allowedProjects,
      error: state.error,
      getIdToken,
      signInWithEmail,
      signInWithGoogle,
      signOut,
    }),
    [state, getIdToken, signInWithEmail, signInWithGoogle, signOut],
  );

  return (
    <AuthContext.Provider value={session}>{children}</AuthContext.Provider>
  );
}
