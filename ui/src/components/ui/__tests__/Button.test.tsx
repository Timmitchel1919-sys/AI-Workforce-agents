import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { Button } from '../Button';

describe('Button', () => {
  it('renders label and responds to click', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Click me</Button>);
    const btn = screen.getByRole('button', { name: /click me/i });
    await user.click(btn);
    expect(onClick).toHaveBeenCalled();
  });
});
