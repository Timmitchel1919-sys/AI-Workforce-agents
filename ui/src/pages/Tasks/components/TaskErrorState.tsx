import { ErrorState } from "../../../components/ui";

export interface TaskErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
}

export function TaskErrorState({
  title = "Unable to load tasks",
  description = "The task registry could not be retrieved from the Control Plane.",
  onRetry,
}: TaskErrorStateProps) {
  return (
    <ErrorState
      title={title}
      description={description}
      onRetry={onRetry}
      retryLabel="Retry"
    />
  );
}

export default TaskErrorState;

