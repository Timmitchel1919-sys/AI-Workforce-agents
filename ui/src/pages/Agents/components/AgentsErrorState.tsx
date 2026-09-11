import { Button, ErrorState } from "../../../components/ui";
import { isApiError } from "../../../api";

/**
 * Error state for the Agents page. Renders a safe message only — never a raw
 * backend exception, stack trace, or internal detail. `403` gets an
 * access-restricted variant. Retrying is delegated to the caller (the query's
 * `refetch`); this component performs no network calls itself.
 */
export function AgentsErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const forbidden = isApiError(error) && error.category === "forbidden";
  const correlationId = isApiError(error) ? error.correlationId : null;

  if (forbidden) {
    return (
      <ErrorState
        variant="forbidden"
        title="You don't have access to the agent registry"
        detail="Your operator role is not permitted to view agents. Contact an administrator if you believe this is wrong."
      />
    );
  }

  return (
    <ErrorState
      variant="network"
      title="Unable to load agents"
      detail={
        correlationId
          ? `The Control Center could not retrieve the agent registry. Reference: ${correlationId}`
          : "The Control Center could not retrieve the agent registry."
      }
      action={
        onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        ) : undefined
      }
    />
  );
}
