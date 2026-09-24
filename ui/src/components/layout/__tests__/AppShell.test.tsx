import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '../../../auth/AuthProvider';
import { ThemeProvider } from '../../../themes/ThemeProvider';
import AppShell from '../AppShell';

describe('AppShell', () => {
  it('renders shell landmarks and nested route content', () => {
    render(
      <QueryClientProvider client={new QueryClient()}><ThemeProvider><AuthProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<div>Overview page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
      </AuthProvider></ThemeProvider></QueryClientProvider>,
    );

    expect(screen.getByRole('navigation', { name: /primary navigation/i })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByText('Overview page')).toBeInTheDocument();
  });

  it('opens and closes the mobile drawer and restores focus', () => {
    render(
      <QueryClientProvider client={new QueryClient()}><ThemeProvider><AuthProvider>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<div>Overview page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
      </AuthProvider></ThemeProvider></QueryClientProvider>,
    );

    const trigger = screen.getByRole('button', { name: /open navigation/i });
    trigger.focus();
    fireEvent.click(trigger);

    const drawer = screen.getByRole('dialog', { name: /navigation drawer/i });
    expect(drawer).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close navigation/i })).toHaveFocus();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: /navigation drawer/i })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
  it('sidebar-edge notch follows the active module, including nested routes, and is purely decorative', () => {
    const renderAt = (path: string) =>
      render(
        <QueryClientProvider client={new QueryClient()}><ThemeProvider><AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/projects/*" element={<div>Projects page</div>} />
              <Route path="/agents" element={<div>Agents page</div>} />
              <Route path="/profile" element={<div>Profile page</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
        </AuthProvider></ThemeProvider></QueryClientProvider>,
      );

    const nested = renderAt('/projects/123/execution-plan');
    const sidebar = nested.container.querySelector('.app-shell__sidebar') as HTMLElement;
    expect(sidebar).toHaveAttribute('data-notch');
    expect(sidebar.style.getPropertyValue('--sidebar-notch-y')).toMatch(/px$/);
    const active = sidebar.querySelector('.sidebar__link.is-active');
    expect(active).toHaveTextContent('Projects');
    // No extra focusable/announced element: the notch is sidebar geometry.
    expect(sidebar.querySelector('[class*="notch"]')).toBeNull();
    nested.unmount();

    const none = renderAt('/profile');
    expect(none.container.querySelector('.app-shell__sidebar')).not.toHaveAttribute('data-notch');
    none.unmount();
  });
});
