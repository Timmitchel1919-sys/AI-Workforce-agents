import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '../../../auth/AuthProvider';
import { ThemeProvider } from '../../../themes/ThemeProvider';
import TopBar from '../TopBar';
import { WorkspaceContextProvider } from '../../../features/workspaceContext';

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
  it('displays the active route title and global command trigger', () => {
    renderTopBar('/');

    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /search commands or pages/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /interface language/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /switch to (light|dark) theme/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /approvals/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /notifications.*not connected/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /account menu/i })).toBeInTheDocument();
  });

  it('account menu links to profile and preferences; sign out is styled as danger', () => {
    renderTopBar('/');
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.getByRole('menuitem', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Preferences' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toHaveClass('topbar__menu-button--danger');
  });

  it('opens and focuses the command palette on Ctrl/Cmd + K', async () => {
    renderTopBar('/agents');

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const input = screen.getByRole('textbox', { name: /search commands/i });
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.getByText(/navigation does not grant authorization/i)).toBeInTheDocument();
  });

  it('closes the command palette with Escape and restores focus to its trigger', async () => {
    renderTopBar('/');
    const trigger = screen.getByRole('button', { name: /search commands or pages/i });

    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByRole('textbox', { name: /search commands/i })).toHaveFocus());
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('does not expose admin-only destinations to a user without an admin role', () => {
    renderTopBar('/');
    fireEvent.click(screen.getByRole('button', { name: /search commands or pages/i }));

    expect(screen.queryByText('Platform admin')).not.toBeInTheDocument();
    expect(screen.queryByText('Security operations')).not.toBeInTheDocument();
  });
});
