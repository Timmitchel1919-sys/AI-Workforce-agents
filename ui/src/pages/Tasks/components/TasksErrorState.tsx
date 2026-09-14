import { isApiError } from "../../../api";
import { Button, ErrorState } from "../../../components/ui";

export function TasksErrorState({
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
        title="You don't have access to the task registry"
        detail="Your operator role is not permitted to view tasks. Contact an administrator if you believe this is wrong."
      />
    );
  }

  return (
    <ErrorState
      variant="network"
      title="Unable to load tasks"
      detail={
        correlationId
          ? `The Control Center could not retrieve the task registry. Reference: ${correlationId}`
          : "The Control Center could not retrieve the task registry."
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
