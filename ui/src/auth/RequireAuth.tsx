import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Spinner } from "../components/ui";
import { AccessUnavailable } from "./AccessUnavailable";
import { loginPathFor } from "./redirect";
import { useAuth } from "./useAuth";
import { useI18n } from "../i18n";

/**
 * Route guard for the Control Center. It only decides where to send the
 * browser; the Control Plane API still verifies the ID token and enforces
 * authorization on every request.
 *
 * Without Firebase web config (local development with demo data) the guard is
 * a pass-through, matching the app's existing development behaviour.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { configured, loading, user, access } = useAuth();
  const location = useLocation();
  const { t } = useI18n();

  if (!configured) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="auth-guard-loading" role="status" aria-live="polite">
        <Spinner />
        <span>{t("shell.verifyingSession")}</span>
      </div>
    );
  }

  // A Control Plane that cannot be reached is not a lost session, so the user
  // stays on this route and is given a way to retry rather than being bounced
  // back to the gateway.
  if (access === "unavailable") {
    return <AccessUnavailable />;
  }

  if (!user || access !== "granted") {
    return <Navigate to={loginPathFor(location)} replace />;
  }

  return <>{children}</>;
}

export default RequireAuth;
