import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { OverviewStateView } from '../OverviewStateView';

describe('OverviewStateView', () => {
  it('renders the appropriate state content and returns null for ready', () => {
    const renderView = (state: 'empty' | 'error' | 'unauthorized' | 'ready', onRetry?: () => void) =>
      render(
        <MemoryRouter>
          <OverviewStateView state={state} onRetry={onRetry} />
        </MemoryRouter>,
      );

    const { container, rerender } = renderView('empty');

    expect(screen.getByRole('heading', { name: 'No workforce activity yet' })).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <OverviewStateView state="error" onRetry={() => undefined} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <OverviewStateView state="unauthorized" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: 'Access restricted' })).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <OverviewStateView state="ready" />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
