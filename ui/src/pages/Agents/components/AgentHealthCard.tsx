import { EmptyState } from "../../../components/ui";
import { Activity } from "../../../components/ui/icons";

/**
 * Health / heartbeat boundary. `AgentView` (the Control Plane's agent
 * contract) does not expose health status, heartbeat, latency, or runtime
 * state today — so this renders an explicit "unavailable" boundary instead
 * of a fabricated health percentage or a fake heartbeat timestamp. Swap this
 * for real fields the moment the contract adds them.
 */
export function AgentHealthCard() {
  return (
    <EmptyState
      icon={Activity}
      title="Health data unavailable"
      detail="The Control Plane does not yet report health status, heartbeat, or latency for agents. This card will populate once that data is exposed."
    />
  );
}
