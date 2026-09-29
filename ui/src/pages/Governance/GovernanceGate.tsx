import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { ErrorState, Skeleton } from "../../components/ui";
import { useI18n } from "../../i18n";

/**
 * Loading / failure handling shared by every panel on the Governance page.
 *
 * A permission, sign-in or server failure is reported as exactly that — it is
 * never rendered as "nothing configured". `empty` is a legitimate outcome and
 * falls through to the caller, which owns its own empty-state copy.
 */
export type GovernanceGateState = "loading" | "ready" | "empty" | string;

interface GovernanceGateProps {
  state: GovernanceGateState;
  onRetry: () => void;
  children: ReactNode;
}

export function GovernanceGate({ state, onRetry, children }: GovernanceGateProps) {
  const { t } = useI18n();

  if (state === "loading") {
    return (
      <div role="status" aria-label={t("governance.loading")}>
        <Skeleton height={48} width="100%" />
      </div>
    );
  }

  if (state === "forbidden" || state === "unauthenticated") {
    return (
      <ErrorState
        icon={<Lock size={24} />}
        title={t("governance.errorTitle")}
        description={t("governance.forbiddenDescription")}
      />
    );
  }

  if (state === "not_found") {
    return (
      <ErrorState title={t("governance.errorTitle")} description={t("governance.notFoundDescription")} />
    );
  }

  if (state !== "ready" && state !== "empty") {
    return (
      <ErrorState
        title={t("governance.errorTitle")}
        description={t("governance.errorDescription")}
        onRetry={onRetry}
        retryLabel={t("common.retry")}
      />
    );
  }

  return <>{children}</>;
}
