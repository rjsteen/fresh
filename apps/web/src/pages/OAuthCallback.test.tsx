import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from 'styled-components';
import { OAuthCallback } from './OAuthCallback';
import { theme } from '../theme';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../cloud/oauth', () => ({
  exchangeDropboxCode: vi.fn(),
  exchangeGDriveCode: vi.fn(),
  getPendingProvider: vi.fn(),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

import { exchangeDropboxCode, exchangeGDriveCode, getPendingProvider } from '../cloud/oauth';
import type { Mock } from 'vitest';

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderCallback(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/oauth/callback${search}`]}>
      <ThemeProvider theme={theme}>
        <Routes>
          <Route path="/oauth/callback" element={<OAuthCallback />} />
        </Routes>
      </ThemeProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockNavigate.mockClear();
  (exchangeDropboxCode as Mock).mockReset();
  (exchangeGDriveCode as Mock).mockReset();
  (getPendingProvider as Mock).mockReset();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OAuthCallback', () => {
  it('shows connecting message while exchange is in progress', () => {
    (getPendingProvider as Mock).mockReturnValue('dropbox');
    (exchangeDropboxCode as Mock).mockReturnValue(new Promise(() => {})); // never resolves
    renderCallback('?code=abc&state=xyz');
    expect(screen.getByText(/connecting to cloud storage/i)).toBeInTheDocument();
  });

  it('navigates to /settings after a successful Dropbox exchange', async () => {
    (getPendingProvider as Mock).mockReturnValue('dropbox');
    (exchangeDropboxCode as Mock).mockResolvedValue(undefined);

    renderCallback('?code=mycode&state=mystate');

    await waitFor(() => {
      expect(exchangeDropboxCode).toHaveBeenCalledWith('mycode', 'mystate');
      expect(mockNavigate).toHaveBeenCalledWith('/settings', { replace: true });
    });
  });

  it('navigates to /settings after a successful Google Drive exchange', async () => {
    (getPendingProvider as Mock).mockReturnValue('gdrive');
    (exchangeGDriveCode as Mock).mockResolvedValue(undefined);

    renderCallback('?code=gcode&state=gstate');

    await waitFor(() => {
      expect(exchangeGDriveCode).toHaveBeenCalledWith('gcode', 'gstate');
      expect(mockNavigate).toHaveBeenCalledWith('/settings', { replace: true });
    });
  });

  it('shows an error when the provider denies access', () => {
    renderCallback('?error=access_denied');
    expect(screen.getByText(/provider denied access: access_denied/i)).toBeInTheDocument();
  });

  it('shows an error when code is missing from callback URL', () => {
    (getPendingProvider as Mock).mockReturnValue('dropbox');
    renderCallback('?state=xyz'); // missing code
    expect(screen.getByText(/missing code or state/i)).toBeInTheDocument();
  });

  it('shows an error when state is missing from callback URL', () => {
    (getPendingProvider as Mock).mockReturnValue('dropbox');
    renderCallback('?code=abc'); // missing state
    expect(screen.getByText(/missing code or state/i)).toBeInTheDocument();
  });

  it('shows an error when no pending provider is stored', () => {
    (getPendingProvider as Mock).mockReturnValue(null);
    renderCallback('?code=abc&state=xyz');
    expect(screen.getByText(/unknown provider/i)).toBeInTheDocument();
  });

  it('shows the exchange error message when the exchange throws', async () => {
    (getPendingProvider as Mock).mockReturnValue('dropbox');
    (exchangeDropboxCode as Mock).mockRejectedValue(new Error('OAuth state mismatch — possible CSRF'));

    renderCallback('?code=abc&state=bad');

    await waitFor(() => {
      expect(screen.getByText(/oauth state mismatch/i)).toBeInTheDocument();
    });
  });

  it('shows a generic message when exchange throws a non-Error', async () => {
    (getPendingProvider as Mock).mockReturnValue('gdrive');
    (exchangeGDriveCode as Mock).mockRejectedValue('unexpected');

    renderCallback('?code=abc&state=xyz');

    await waitFor(() => {
      expect(screen.getByText(/token exchange failed/i)).toBeInTheDocument();
    });
  });

  it('shows "Back to Settings" on error and it navigates on click', async () => {
    const user = userEvent.setup();
    renderCallback('?error=access_denied');

    const backBtn = screen.getByRole('button', { name: /back to settings/i });
    expect(backBtn).toBeInTheDocument();

    await user.click(backBtn);
    expect(mockNavigate).toHaveBeenCalledWith('/settings', { replace: true });
  });
});
