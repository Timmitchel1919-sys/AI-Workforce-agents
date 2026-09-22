import { Link } from 'react-router-dom';
import { Button, EmptyState } from '../../../components/ui';

export function OverviewEmptyState() {
  return (
    <EmptyState
      title="No workforce activity yet"
      description="Your AI Workforce has not generated operational activity yet. Create an agent, task, or workflow to get started."
      primaryAction={
        <Link to="/agents" aria-label="Create an agent">
          <Button type="button" variant="primary">
            Create an agent
          </Button>
        </Link>
      }
    />
  );
}

export default OverviewEmptyState;
