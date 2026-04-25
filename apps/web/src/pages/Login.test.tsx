/**
 * Login page tests.
 *
 * Covers rendering, form validation, error state, and the full
 * login → device-register → navigate flow.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Login } from './Login';
import { renderWithProviders } from '../test/renderWithProviders';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockStoreToken = vi.fn();
vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({
    isAuthenticated: false,
    token: null,
    storeToken: mockStoreToken,
    logout: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Fetch stub helpers
// ---------------------------------------------------------------------------

type FetchStub = (url: string | URL | Request) => Promise<Response>;

function makeLoginStub(overrides?: { loginOk?: boolean; loginError?: string }): FetchStub {
  return async (url) => {
    const urlStr = String(url);
    if (urlStr.includes('/api/v1/auth/login')) {
      if (overrides?.loginOk === false) {
        return new Response(
          JSON.stringify({ error: overrides.loginError ?? 'Invalid credentials' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(
        JSON.stringify({ token: 'test-jwt-token' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (urlStr.includes('/api/v1/devices')) {
      return new Response('{}', { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn(makeLoginStub());
  vi.stubGlobal('fetch', fetchSpy);
  mockNavigate.mockReset();
  mockStoreToken.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fillAndSubmit(email = 'user@example.com', password = 'secret123') {
  return async () => {
    const user = userEvent.setup();
    renderWithProviders(<Login />);
    await user.type(screen.getByRole('textbox', { name: /email/i }), email);
    await user.type(screen.getByLabelText(/password/i), password);
    await user.click(screen.getByRole('button', { name: /sign in/i }));
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Login', () => {
  describe('rendering', () => {
    it('shows the Fresh brand heading', () => {
      renderWithProviders(<Login />);
      expect(screen.getByRole('heading', { name: /fresh/i })).toBeInTheDocument();
    });

    it('has an email input', () => {
      renderWithProviders(<Login />);
      expect(screen.getByRole('textbox', { name: /email/i })).toBeInTheDocument();
    });

    it('has a password input', () => {
      renderWithProviders(<Login />);
      expect(screen.getByLabelText(/password/i)).toHaveAttribute('type', 'password');
    });

    it('has a Sign in submit button', () => {
      renderWithProviders(<Login />);
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });

    it('has a link to /register', () => {
      renderWithProviders(<Login />);
      const link = screen.getByRole('link', { name: /sign up/i });
      expect(link).toHaveAttribute('href', '/register');
    });
  });

  describe('loading state', () => {
    it('shows "Signing in…" while the request is in flight', async () => {
      let resolve!: (v: Response) => void;
      vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { resolve = r; })));

      const user = userEvent.setup();
      renderWithProviders(<Login />);
      await user.type(screen.getByRole('textbox', { name: /email/i }), 'a@b.com');
      await user.type(screen.getByLabelText(/password/i), 'password');
      await user.click(screen.getByRole('button', { name: /sign in/i }));

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /signing in/i })).toBeDisabled();
      });

      // Unblock the pending request so the component unmounts cleanly
      resolve(new Response('{}', { status: 401, headers: { 'Content-Type': 'application/json' } }));
    });
  });

  describe('error handling', () => {
    it('shows error banner when login returns 401', async () => {
      fetchSpy.mockImplementation(makeLoginStub({ loginOk: false, loginError: 'Invalid credentials' }));
      await fillAndSubmit()();
      await waitFor(() => {
        expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument();
      });
    });

    it('shows error banner when login returns a plain 500 with no body error field', async () => {
      vi.stubGlobal('fetch', vi.fn(async () =>
        new Response(JSON.stringify({}), { status: 500, headers: { 'Content-Type': 'application/json' } })
      ));
      await fillAndSubmit()();
      await waitFor(() => {
        expect(screen.getByText(/login failed/i)).toBeInTheDocument();
      });
    });
  });

  describe('successful login flow', () => {
    it('calls storeToken with the returned JWT', async () => {
      await fillAndSubmit()();
      await waitFor(() => expect(mockStoreToken).toHaveBeenCalledWith('test-jwt-token', 'user@example.com'));
    });

    it('registers the device after a successful login', async () => {
      await fillAndSubmit()();
      await waitFor(() => {
        const deviceCall = fetchSpy.mock.calls.find(([url]) => String(url).includes('/api/v1/devices'));
        expect(deviceCall).toBeDefined();
        const [, init] = deviceCall!;
        expect(init?.method).toBe('POST');
        const body = JSON.parse(init?.body as string);
        expect(body.platform).toBe('web');
      });
    });

    it('navigates to /dashboard after login and device registration', async () => {
      await fillAndSubmit()();
      await waitFor(() =>
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true })
      );
    });
  });
});
