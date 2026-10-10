import { useEffect } from "react";
import { useRouteError } from "react-router-dom";
import { ErrorState } from "../components/states";
import { useI18n } from "../i18n";

/**
 * Route-level error element: a page that fails to render shows the app's own
 * error state (inside the shell) instead of the router's developer screen.
 * Technical details stay in the console, never on screen.
 */
export default function RouteError() {
  const error = useRouteError();
  const { t } = useI18n();
  useEffect(() => {
    console.error("Unhandled route error.", error);
  }, [error]);
  return (
    <ErrorState
      title={t("shell.errorTitle")}
      description={t("shell.errorDescription")}
      onRetry={() => window.location.reload()}
      retryLabel={t("common.retry")}
    />
  );
}
