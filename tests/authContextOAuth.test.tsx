// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

// The frontend side of oauth mode: AuthProvider hydrates its identity from
// GET /auth/me instead of the simulated roster, and gates children behind a
// real session. See docs/AUTH_INTEGRATION_PLAN.md §2c.
vi.mock('../src/config/apiClient', () => ({
  apiClient: { get: vi.fn(), post: vi.fn() },
}));
vi.mock('../src/config/envConfig', () => ({
  getAuthMode: () => 'oauth',
  getApiBaseUrl: () => '',
}));

import { apiClient } from '../src/config/apiClient';
import { AuthProvider } from '../src/context/AuthContext';
import { useAuth } from '../src/hooks/useAuth';

const ADMIN = {
  id: 'u1', name: 'Raúl García', email: 'raul.garcia@portal.com', role: 'Administrator',
  status: 'Active', brandIds: ['*'], departmentIds: ['*'], lastActive: 'via SSO',
  permissions: { manageRates: true, manageForwarding: true, manageClients: true, viewLogs: true, manageAiAgents: true, manageKnowledgeBase: true },
};

function Probe() {
  const auth = useAuth();
  return <div data-testid="probe">user:{auth?.currentUser?.name}|mode:{auth?.authMode}</div>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AuthProvider — oauth mode', () => {
  it('hydrates the identity from /auth/me and renders children', async () => {
    (apiClient.get as any).mockResolvedValue({ success: true, data: ADMIN });

    render(<AuthProvider><Probe /></AuthProvider>);

    await waitFor(() => expect(screen.getByTestId('probe')).toBeTruthy());
    expect(screen.getByTestId('probe').textContent).toBe('user:Raúl García|mode:oauth');
    expect(apiClient.get).toHaveBeenCalledWith('/auth/me');
  });

  it('gates children behind sign-in when /auth/me is unauthorized', async () => {
    (apiClient.get as any).mockResolvedValue({ success: false, error: { code: 'ERR_UNAUTHORIZED', message: 'no' } });

    render(<AuthProvider><Probe /></AuthProvider>);

    // The protected child never mounts; a sign-in affordance is shown instead.
    await waitFor(() => expect(screen.queryByText(/Continue to sign in/i)).toBeTruthy());
    expect(screen.queryByTestId('probe')).toBeNull();
  });
});
