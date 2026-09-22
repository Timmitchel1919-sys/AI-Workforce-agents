import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineState,
  StatusPresentation,
  UnauthorizedState,
  UnavailableState,
} from '../index';

describe('state presentation components', () => {
  it('renders a loading state with accessible status semantics', () => {
    render(<LoadingState title="Loading agents" description="Fetching the latest agent information." />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.getByText('Loading agents')).toBeInTheDocument();
    expect(screen.getByText('Fetching the latest agent information.')).toBeInTheDocument();
  });

  it('renders empty and error states with actions', () => {
    const retry = vi.fn();

    render(
      <>
        <EmptyState
          title="No agents yet"
          description="Create your first AI agent to begin building your workforce."
          primaryAction={<button type="button">Create agent</button>}
        />
        <ErrorState
          title="Unable to load agents"
          description="The agent data could not be retrieved."
          onRetry={retry}
        />
      </>,
    );

    expect(screen.getByText('No agents yet')).toBeInTheDocument();
    expect(screen.getByText('Create agent')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to load agents');

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('renders offline, unauthorized, unavailable, and status presentation variants', () => {
    render(
      <>
        <OfflineState title="Connection unavailable" description="Some Control Center data may be temporarily unavailable." />
        <UnauthorizedState title="Access restricted" description="You do not have permission to access this resource." />
        <UnavailableState title="Service unavailable" description="This Control Center capability is temporarily unavailable." />
        <StatusPresentation status="degraded" label="Degraded" />
      </>,
    );

    expect(screen.getByText('Connection unavailable')).toBeInTheDocument();
    expect(screen.getByText('Access restricted')).toBeInTheDocument();
    expect(screen.getByText('Service unavailable')).toBeInTheDocument();
    expect(screen.getByText('Degraded')).toBeInTheDocument();
  });
});
