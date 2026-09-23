import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AuthProvider } from '../../../auth/AuthProvider';
import TopBar from '../TopBar';

function renderTopBar(initialEntry = '/') {
  return render(
    <AuthProvider>
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route element={<TopBar />}>
          <Route path="/" element={<div>Overview page</div>} />
          <Route path="/agents" element={<div>Agents page</div>} />
          <Route path="/design-system" element={<div>Design system page</div>} />
        </Route>
      </Routes>
    </MemoryRouter>
    </AuthProvider>,
  );
}

describe('TopBar', () => {
  it('displays the active route title and accessible command field', () => {
    renderTopBar('/');

    expect(screen.getByText('Overview')).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: /search commands/i })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: /control plane status/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /operator menu/i })).toBeInTheDocument();
  });

  it('focuses the command input on Ctrl/Cmd + K', () => {
    renderTopBar('/agents');

    const input = screen.getByRole('searchbox', { name: /search commands/i });
    expect(input).not.toHaveFocus();

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(input).toHaveFocus();
  });
});
