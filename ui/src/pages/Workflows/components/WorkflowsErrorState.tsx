import { isApiError } from "../../../api";
import { Button, ErrorState } from "../../../components/ui";

export function WorkflowsErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  const forbidden = isApiError(error) && error.category === "forbidden";
  const correlationId = isApiError(error) ? error.correlationId : null;
  return (
    <ErrorState
      variant={forbidden ? "forbidden" : "network"}
      title={
        forbidden
          ? "You don't have access to the workflow registry"
          : "Unable to load workflows"
      }
      detail={
        forbidden
          ? "Your operator role is not permitted to view workflows. Contact an administrator if you believe this is wrong."
          : correlationId
            ? `The Control Center could not retrieve workflows. Reference: ${correlationId}`
            : "The Control Center could not retrieve workflows."
      }
      action={
        forbidden ? undefined : (
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        )
      }
    />
  );
}
