import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Input } from '../Input';

describe('Input', () => {
  it('renders label and input', () => {
    render(<Input label="Username" placeholder="user" />);
    expect(screen.getByLabelText(/username/i)).toBeTruthy();
  });
});
