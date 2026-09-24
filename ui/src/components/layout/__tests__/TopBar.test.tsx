import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '../../../auth/AuthProvider';
import { ThemeProvider } from '../../../themes/ThemeProvider';
import TopBar from '../TopBar';

function renderTopBar(initialEntry = '/') {
  return render(
    <QueryClientProvider client={new QueryClient()}><ThemeProvider><AuthProvider>
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={<TopBar />}>
          <Route path="/" element={<div>Overview page</div>} />
          <Route path="/agents" element={<div>Agents page</div>} />
          <Route path="/design-system" element={<div>Design system page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
    </AuthProvider></ThemeProvider></QueryClientProvider>,
  );
}

describe('TopBar', () => {
  it('displays the active route title and accessible command field', () => {
    renderTopBar('/');

    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: /search commands/i })).toBeInTheDocument();
    // Theme and language live on Profile → Preferences, not in the header.
    expect(screen.queryByRole('group', { name: /interface language/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /switch to (light|dark) theme/i })).toBeNull();
    expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /account menu/i })).toBeInTheDocument();
  });

  it('account menu links to profile and preferences; sign out is styled as danger', () => {
    renderTopBar('/');
    fireEvent.click(screen.getByRole('button', { name: /account menu/i }));
    expect(screen.getByRole('menuitem', { name: 'Profile' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Preferences' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toHaveClass('topbar__menu-button--danger');
  });

  it('focuses the command input on Ctrl/Cmd + K', () => {
    renderTopBar('/agents');

    const input = screen.getByRole('searchbox', { name: /search commands/i });
    expect(input).not.toHaveFocus();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(input).toHaveFocus();
  });
});
