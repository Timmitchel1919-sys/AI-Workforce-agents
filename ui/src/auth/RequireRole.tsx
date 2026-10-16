import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { UnauthorizedState } from "../components/states/UnauthorizedState";
import { useI18n } from "../i18n";
import { useAuth } from "./useAuth";
import { allowsRole } from "./roleAccess";
import type { AccessDetails } from "./auth.types";

/**
 * Client-side discovery guard. It prevents over-broad page rendering, while
 * the Control Plane remains the only authority for every read and mutation.
 */
export function RequireRole({ role, children }: { role: NonNullable<AccessDetails["role"]>; children: ReactNode }) {
  const { configured, accessDetails } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();

  if (!configured || allowsRole(accessDetails.role, role)) return <>{children}</>;

  return (
    <UnauthorizedState
      title={t("shell.restrictedView")}
      description={t("shell.restrictedViewDescription")}
      returnLabel={t("shell.returnToOverview")}
      onReturn={() => navigate("/overview", { replace: true })}
    />
  );
}
