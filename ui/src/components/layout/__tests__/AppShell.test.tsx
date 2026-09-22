import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import AppShell from '../AppShell';

describe('AppShell', () => {
  it('renders shell landmarks and nested route content', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<div>Overview page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByRole('navigation', { name: /primary navigation/i })).toBeInTheDocument();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByText('Overview page')).toBeInTheDocument();
  });

  it('opens and closes the mobile drawer and restores focus', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<AppShell />}>
            <Route index element={<div>Overview page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
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
});
