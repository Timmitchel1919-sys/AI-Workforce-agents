import { ErrorState } from "../../../components/ui";

export interface AgentsErrorStateProps {
  onRetry?: () => void;
}

export function AgentsErrorState({ onRetry }: AgentsErrorStateProps) {
  return (
    <ErrorState
      title="Unable to load agents"
      description="The agent registry could not be retrieved from the Control Plane."
      onRetry={onRetry}
      retryLabel="Retry"
    />
  );
}

export default AgentsErrorState;
