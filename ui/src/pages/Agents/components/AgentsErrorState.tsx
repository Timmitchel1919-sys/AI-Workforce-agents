import { ErrorState } from "../../../components/ui";
import { useI18n } from "../../../i18n";
import type { AgentsUiState } from "../../../features/agents";

export interface AgentsErrorStateProps {
  onRetry?: () => void;
  /**
   * Which failure this actually was. "The registry failed" and "this build has
   * no route" and "this deployment has no specialist workforce" are three
   * different facts, and a single generic message makes all three look like the
   * same outage.
   */
  state?: Extract<AgentsUiState, "error" | "unauthorized" | "degraded" | "notComposed" | "notConfigured">;
}

export function AgentsErrorState({ onRetry, state = "error" }: AgentsErrorStateProps) {
  const { t } = useI18n();

  const copy: Record<NonNullable<AgentsErrorStateProps["state"]>, { title: string; description: string }> = {
    unauthorized: {
      title: t("agents.accessRestricted"),
      description: t("agents.accessRestrictedDescription"),
    },
    notComposed: {
      title: t("agents.notComposedTitle"),
      description: t("agents.notComposedDescription"),
    },
    notConfigured: {
      title: t("agents.notConfiguredTitle"),
      description: t("agents.notConfiguredDescription"),
    },
    degraded: {
      title: t("agents.degradedTitle"),
      description: t("agents.degradedDescription"),
    },
    error: {
      title: t("agents.errorTitle"),
      description: t("agents.errorDescription"),
    },
  };

  const { title, description } = copy[state];

  // Retrying cannot conjure a route that does not exist or a workforce that was
  // never composed, so the retry affordance is only offered where it can help.
  const canRetry = state === "degraded" || state === "error" || state === "unauthorized";

  return (
    <ErrorState
      title={title}
      description={description}
      onRetry={canRetry ? onRetry : undefined}
      retryLabel={t("common.retry")}
    />
  );
}

export default AgentsErrorState;
