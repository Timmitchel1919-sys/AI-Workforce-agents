import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./useAuth";
import { LOGIN_ROUTE } from "../app/routes";
import { Spinner } from "../components/ui";
import { StateMessage } from "../components/feedback";

/**
 * Auth gate for the whole authenticated app. The dashboard is NEVER rendered
 * while auth is `loading` — a full-page loader is shown until the state
 * resolves, then either the app or a redirect to `/login`.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, error } = useAuth();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="full-page-center">
        <Spinner label="Checking your session…" />
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="full-page-center">
        <StateMessage
          tone="error"
          title="Sign-in is unavailable"
          detail={error ?? "The authentication service could not be reached."}
          action={
            <button
              type="button"
              className="btn"
              onClick={() => window.location.reload()}
            >
              Retry
            </button>
          }
        />
      </div>
    );
  }

  if (status === "unauthenticated") {
    return (
      <Navigate to={LOGIN_ROUTE} replace state={{ from: location.pathname }} />
    );
  }

  return <>{children}</>;
}
