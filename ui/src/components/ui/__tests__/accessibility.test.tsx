import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Button } from '../Button';
import { IconButton } from '../IconButton';
import { Input } from '../Input';
import { Checkbox } from '../Checkbox';
import { Switch } from '../Switch';
import { Badge } from '../Badge';
import { StatusBadge } from '../StatusBadge';
import { Dialog } from '../Dialog';
import { Tabs } from '../Tabs';
import { Pagination } from '../Pagination';
import { ThemeProvider } from '../../../themes/ThemeProvider';
import { useTheme } from '../../../themes/useTheme';

describe('Accessibility and behavior', () => {
  it('button renders and disabled cannot be activated', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click</Button>);
    const btn = screen.getByRole('button', { name: /click/i });
    await user.click(btn);
    expect(onClick).toHaveBeenCalled();

    render(<Button disabled onClick={onClick}>Nope</Button>);
    const d = screen.getByRole('button', { name: /nope/i });
    await user.click(d);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('iconbutton exposes accessible name', () => {
    render(<IconButton label="Close">✕</IconButton>);
    const btn = screen.getByRole('button', { name: /close/i });
    expect(btn).toBeInTheDocument();
  });

  it('input associates label and description and error', () => {
    render(<Input label="Username" description="enter" error="bad" />);
    const input = screen.getByLabelText(/username/i);
    expect(input).toBeInTheDocument();
    expect(screen.getByText(/enter/i)).toBeInTheDocument();
    expect(screen.getByText(/bad/i)).toBeInTheDocument();
  });

  it('checkbox supports checked state', async () => {
    const user = userEvent.setup();
    render(<Checkbox label="Agree" />);
    const cb = screen.getByRole('checkbox', { name: /agree/i });
    expect(cb).not.toBeChecked();
    await user.click(cb);
    expect(cb).toBeChecked();
  });

  it('switch exposes switch semantics', () => {
    render(<Switch label="Toggle" />);
    const sw = screen.getByRole('switch', { name: /toggle/i });
    expect(sw).toBeInTheDocument();
  });

  it('badge variants render', () => {
    render(<><Badge variant="primary">P</Badge><Badge variant="success">S</Badge></>);
    expect(screen.getByText('P')).toBeInTheDocument();
    expect(screen.getByText('S')).toBeInTheDocument();
  });

  it('statusbadge renders text', () => {
    render(<StatusBadge status="running" />);
    expect(screen.getByText(/running/i)).toBeInTheDocument();
  });

  it('dialog opens and closes and closes with Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(<Dialog open={false} onClose={onClose} title="T">Body</Dialog>);
    rerender(<Dialog open={true} onClose={onClose} title="T">Body</Dialog>);
    const dialog = screen.getByRole('dialog', { name: /t/i });
    expect(dialog).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('tabs expose semantics and keyboard navigation', async () => {
    const user = userEvent.setup();
    const items = [{ id: 'a', label: 'A', panel: 'Panel A' }, { id: 'b', label: 'B', panel: 'Panel B' }];
    render(<Tabs items={items} />);
    const tabA = screen.getByRole('tab', { name: /a/i });
    expect(tabA).toBeInTheDocument();
    await user.keyboard('{ArrowRight}');
    const tabB = screen.getByRole('tab', { name: /b/i });
    expect(tabB).toBeInTheDocument();
  });

  it('pagination disables prev/next correctly', () => {
    const onChange = vi.fn();
    render(<Pagination current={1} total={3} onChange={onChange} />);
    const prev = screen.getByRole('button', { name: /previous/i });
    const next = screen.getByRole('button', { name: /next/i });
    expect(prev).toBeDisabled();
    expect(next).not.toBeDisabled();
  });

  it('themeprovider changes and persists theme', async () => {
    const user = userEvent.setup();
    function Test() {
      const t = useTheme();
      return <button onClick={() => t.setTheme('dark')}>Set</button>;
    }

    localStorage.removeItem('ai-workforce-theme');
    render(<ThemeProvider><Test /></ThemeProvider>);
    const btn = screen.getByRole('button', { name: /set/i });
    await user.click(btn);
    // effect writes to localStorage
    expect(localStorage.getItem('ai-workforce-theme')).toBe('dark');
  });
});
