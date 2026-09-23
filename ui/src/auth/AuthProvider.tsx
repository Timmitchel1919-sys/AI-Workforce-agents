import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  getAuth,
  onAuthStateChanged,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { initializeApp, getApps } from "firebase/app";
import type { AuthContextValue, AuthUser } from "./auth.types";
import { authContext } from "./authContext";

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

function mapFirebaseUser(user: User): AuthUser {
  return {
    id: user.uid,
    email: user.email,
    displayName: user.displayName,
  };
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(firebaseConfigured);

  useEffect(() => {
    if (!firebaseConfigured) {
      return;
    }

    const app =
      getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);

    const auth = getAuth(app);

    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        setUser(null);
        setAccessToken(null);
        setLoading(false);
        return;
      }

      setUser(mapFirebaseUser(firebaseUser));

      const token = await firebaseUser.getIdToken();
      setAccessToken(token);
      setLoading(false);
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      accessToken,
      signOut: async () => {
        if (!firebaseConfigured) {
          setUser(null);
          setAccessToken(null);
          return;
        }

        const auth = getAuth();
        await firebaseSignOut(auth);
      },
    }),
    [user, loading, accessToken],
  );

  return (
    <authContext.Provider value={value}>
      {children}
    </authContext.Provider>
  );
}