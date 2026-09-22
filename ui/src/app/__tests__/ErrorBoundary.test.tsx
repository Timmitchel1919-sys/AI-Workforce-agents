import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ErrorBoundary from '../ErrorBoundary';

function ThrowingComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Boom');
  }

  return <div>Safe content</div>;
}

describe('ErrorBoundary', () => {
  it('renders a safe fallback when a child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent shouldThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('allows reset after recovery', async () => {
    const RecoveryHarness = ({ shouldThrow, resetKey }: { shouldThrow: boolean; resetKey?: number }) => (
      <ErrorBoundary resetKey={resetKey}>
        <ThrowingComponent shouldThrow={shouldThrow} />
      </ErrorBoundary>
    );

    const { rerender } = render(<RecoveryHarness shouldThrow resetKey={0} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));

    await waitFor(() => {
      rerender(<RecoveryHarness shouldThrow={false} resetKey={1} />);
      expect(screen.getByText('Safe content')).toBeInTheDocument();
    });
  });
});
