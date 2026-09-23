import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '../../../auth/AuthProvider';
import { ThemeProvider } from '../../../themes/ThemeProvider';
import TopBar from '../TopBar';

function renderTopBar(initialEntry = '/') {
  return render(
    <ThemeProvider><AuthProvider>
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={<TopBar />}>
          <Route path="/" element={<div>Overview page</div>} />
          <Route path="/agents" element={<div>Agents page</div>} />
          <Route path="/design-system" element={<div>Design system page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
    </AuthProvider></ThemeProvider>,
  );
}

describe('TopBar', () => {
  it('displays the active route title and accessible command field', () => {
    renderTopBar('/');

    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: /search commands/i })).toBeInTheDocument();
    // No fabricated Control Plane status; the header offers theme + language quick controls instead.
    expect(screen.getByRole('group', { name: /interface language/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /switch to (light|dark) theme/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /account menu/i })).toBeInTheDocument();
  });

  it('focuses the command input on Ctrl/Cmd + K', () => {
    renderTopBar('/agents');

    const input = screen.getByRole('searchbox', { name: /search commands/i });
    expect(input).not.toHaveFocus();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(input).toHaveFocus();
  });
});
