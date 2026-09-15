import { isApiError } from "../../../api";
import { Stack } from "../../../components/layout";
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  ErrorState,
  MetricGroup,
  Skeleton,
} from "../../../components/ui";
import { FolderKanban } from "../../../components/ui/icons";

export function ProjectsLoadingState() {
  return (
    <Stack gap="lg" aria-busy="true" aria-label="Loading projects">
      <span className="visually-hidden" role="status">
        Loading project registryâ€¦
      </span>
      <MetricGroup>
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="ui-metric">
            <Skeleton variant="text" width="6rem" />
            <Skeleton variant="text" width="2.5rem" height="1.5rem" />
          </div>
        ))}
      </MetricGroup>
      <Card>
        <CardBody>
          <Stack gap="sm">
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} height="2.75rem" />
            ))}
          </Stack>
        </CardBody>
      </Card>
    </Stack>
  );
}
export function ProjectsEmptyState({
  filtered,
  onClearFilters,
}: {
  filtered: boolean;
  onClearFilters?: () => void;
}) {
  return (
    <EmptyState
      icon={FolderKanban}
      title={filtered ? "No projects match these filters" : "No projects found"}
      detail={
        filtered
          ? "Try changing the search or status filters."
          : "Projects appear here when the Control Plane has registered a project adapter."
      }
      action={
        filtered && onClearFilters ? (
          <Button variant="outline" size="sm" onClick={onClearFilters}>
            Clear filters
          </Button>
        ) : undefined
      }
    />
  );
}
export function ProjectsErrorState({
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
          ? "You don't have access to the project registry"
          : "Unable to load projects"
      }
      detail={
        forbidden
          ? "Your operator role is not permitted to view projects. Contact an administrator if you believe this is wrong."
          : correlationId
            ? `The Control Center could not retrieve projects. Reference: ${correlationId}`
            : "The Control Center could not retrieve projects."
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
