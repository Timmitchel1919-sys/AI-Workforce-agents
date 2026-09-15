import { Card, CardBody, EmptyState } from "../../../components/ui";
import { Workflow } from "../../../components/ui/icons";

/** The current WorkflowView contract does not expose a trigger model. */
export function WorkflowTriggerCard() {
  return (
    <Card>
      <CardBody>
        <EmptyState
          icon={Workflow}
          title="Trigger unavailable"
          detail="The Control Plane does not expose trigger metadata for this workflow."
        />
      </CardBody>
    </Card>
  );
}
