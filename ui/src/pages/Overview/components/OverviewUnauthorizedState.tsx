import { UnauthorizedState } from '../../../components/states';

export function OverviewUnauthorizedState() {
  return (
    <UnauthorizedState
      title="Access restricted"
      description="You do not have permission to view workforce operational data."
    />
  );
}

export default OverviewUnauthorizedState;
