import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AgentsPage from '../AgentsPage';

import { AuthProvider } from '../../../auth/AuthProvider';

describe('AgentsPage', () => {
  it('renders the agent registry and summary metrics', async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    render(
      <AuthProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/agents']}>
            <Routes>
              <Route path="/agents" element={<AgentsPage />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </AuthProvider>,
    );

    expect(await screen.findByText(/Total Agents/i)).toBeInTheDocument();
    expect(await screen.findByText(/Research Agent/i)).toBeInTheDocument();
  });
});
