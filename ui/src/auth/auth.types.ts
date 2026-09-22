export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string | null;
}

export interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  accessToken: string | null;
  signOut: () => Promise<void>;
}