import { Stack } from "../../../components/layout";
import { Card, CardBody, MetricGroup, Skeleton } from "../../../components/ui";

export function TasksLoadingState() {
  return (
    <Stack gap="lg" aria-busy="true" aria-label="Loading tasks">
      <span className="visually-hidden" role="status">
        Loading the task registry…
      </span>
      <MetricGroup>
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="ui-metric">
            <Skeleton variant="text" width="5rem" />
            <Skeleton variant="text" width="2.5rem" height="1.5rem" />
          </div>
        ))}
      </MetricGroup>
      <Card>
        <CardBody>
          <Stack gap="sm">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} height="2.75rem" />
            ))}
          </Stack>
        </CardBody>
      </Card>
    </Stack>
  );
}
