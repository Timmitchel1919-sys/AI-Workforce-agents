import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../../auth/AuthProvider';
import { ThemeProvider } from '../../../themes/ThemeProvider';
import TopBar from '../TopBar';
import { WorkspaceContextProvider } from '../../../features/workspaceContext';

const overviewStatus = vi.hoisted(() => ({ value: 'ready' }));
vi.mock('../../../features/overview', () => ({
  useOverview: () => ({ status: overviewStatus.value, refetch: vi.fn() }),
}));

vi.mock('../../../features/governance', () => ({
  useApprovalQueue: () => ({ state: 'empty', items: [], total: 0 }),
  useAuditTrail: () => ({ state: 'empty', items: [], total: 0 }),
}));

function renderTopBar(initialEntry = '/') {
  return render(
    <QueryClientProvider client={new QueryClient()}><ThemeProvider><AuthProvider>
    <MemoryRouter initialEntries={[initialEntry]}>
      <WorkspaceContextProvider>
      <Routes>
        <Route element={<TopBar />}>
          <Route path="/" element={<div>Overview page</div>} />
          <Route path="/agents" element={<div>Agents page</div>} />
          <Route path="/design-system" element={<div>Design system page</div>} />
        </Route>
      </Routes>
      </WorkspaceContextProvider>
    </MemoryRouter>
    </AuthProvider></ThemeProvider></QueryClientProvider>,
  );
}

describe('TopBar', () => {
  it('shows one connection indicator for the Control Plane', () => {
    overviewStatus.value = 'ready';
    const { unmount } = renderTopBar('/');
    expect(screen.getByText('Live data')).toBeInTheDocument();
    unmount();

    overviewStatus.value = 'degraded';
    renderTopBar('/');
    expect(screen.getByText('Partial data')).toBeInTheDocument();
    expect(screen.queryByText('Live data')).not.toBeInTheDocument();
    overviewStatus.value = 'ready';
  });

  it('keeps the topbar focused on search and notifications', () => {
    renderTopBar('/');

    expect(screen.getByRole('button', { name: /search commands or pages/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /interface language/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /switch to (light|dark) theme/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approvals/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^notifications$/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /account menu/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/current view/i)).not.toBeInTheDocument();
  });

  it('opens smart notifications without exposing a privileged action', () => {
    renderTopBar('/');
    fireEvent.click(screen.getByRole('button', { name: /^notifications$/i }));
    expect(screen.getByRole('dialog', { name: /smart notifications/i })).toBeInTheDocument();
    expect(screen.getByText(/control plane events only/i)).toBeInTheDocument();
    expect(screen.getByText(/privileged actions still require authorization/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /approve|deploy|delete/i })).not.toBeInTheDocument();
  });

  it('opens and focuses the command palette on Ctrl/Cmd + K', async () => {
    renderTopBar('/agents');

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = screen.getByRole('textbox', { name: /search commands/i });
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.getByText(/navigation does not grant authorization/i)).toBeInTheDocument();
  });

  it('focuses search with slash without hijacking typing fields', async () => {
    renderTopBar('/');
    fireEvent.keyDown(window, { key: '/' });
    await waitFor(() => expect(screen.getByRole('textbox', { name: /search commands/i })).toHaveFocus());
  });

  it('closes the command palette with Escape and restores focus to its trigger', async () => {
    renderTopBar('/');
    const trigger = screen.getByRole('button', { name: /search commands or pages/i });

    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('textbox', { name: /search commands/i })).toHaveFocus());
    fireEvent.keyDown(window, { key: 'Escape' });

    // Focus restoration happens on the next animation frame; wait for both the
    // dialog teardown and the focus to move back to the trigger before asserting.
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('does not expose admin-only destinations to a user without an admin role', () => {
    renderTopBar('/');
    fireEvent.click(screen.getByRole('button', { name: /search commands or pages/i }));

    expect(screen.queryByText('Platform admin')).not.toBeInTheDocument();
    expect(screen.queryByText('Security operations')).not.toBeInTheDocument();
  });

  it('offers categorized contextual search and an honest disconnected assistant state', () => {
    renderTopBar('/');
    fireEvent.click(screen.getByRole('button', { name: /search commands or pages/i }));

    expect(screen.getByRole('button', { name: 'All' })).toBeInTheDocument();
    expect(screen.getAllByText('Suggested').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: /workspace assistant/i }));
    expect(screen.getByText('NOT CONNECTED')).toBeInTheDocument();
    expect(screen.getByText(/assistant is advisory only/i)).toBeInTheDocument();
  });
});
