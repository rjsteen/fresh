/**
 * Register page tests.
 *
 * Covers rendering, client-side validation (zod schema), server-side error
 * surfaces, and the successful register → device-register → navigate flow.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Register } from './Register';
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

function makeRegisterStub(overrides?: {
  ok?: boolean;
  error?: string;
  fieldErrors?: Record<string, string[]>;
}): typeof fetch {
  return vi.fn(async (url: string | URL | Request) => {
    const urlStr = String(url);
    if (urlStr.includes('/api/v1/auth/register')) {
      if (overrides?.ok === false) {
        const body = overrides.fieldErrors
          ? { errors: overrides.fieldErrors }
          : { error: overrides.error ?? 'Registration failed' };
        return new Response(JSON.stringify(body), {
          status: 422,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ token: 'reg-jwt-token' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (urlStr.includes('/api/v1/devices')) {
      return new Response('{}', { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  vi.stubGlobal('fetch', makeRegisterStub());
  mockNavigate.mockReset();
  mockStoreToken.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helper: fill the form with valid data and optionally submit
// ---------------------------------------------------------------------------

async function fillForm(opts: {
  email?: string;
  password?: string;
  confirmPassword?: string;
  submit?: boolean;
} = {}) {
  const user = userEvent.setup();
  renderWithProviders(<Register />);

  const email = opts.email ?? 'user@example.com';
  const password = opts.password ?? 'strongpassword1';
  const confirmPassword = opts.confirmPassword ?? password;

  await user.type(screen.getByRole('textbox', { name: /email/i }), email);

  const passwordInputs = screen.getAllByLabelText(/password/i);
  await user.type(passwordInputs[0], password);
  await user.type(passwordInputs[1], confirmPassword);

  if (opts.submit) {
    await user.click(screen.getByRole('button', { name: /create account/i }));
  }

  return user;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Register', () => {
  describe('rendering', () => {
    it('shows the Fresh heading', () => {
      renderWithProviders(<Register />);
      expect(screen.getByRole('heading', { name: /fresh/i })).toBeInTheDocument();
    });

    it('has email, password, and confirm-password inputs', () => {
      renderWithProviders(<Register />);
      expect(screen.getByRole('textbox', { name: /email/i })).toBeInTheDocument();
      const passwordInputs = screen.getAllByLabelText(/password/i);
      expect(passwordInputs.length).toBeGreaterThanOrEqual(2);
    });

    it('has a region selector', () => {
      renderWithProviders(<Register />);
      expect(screen.getByRole('combobox', { name: /region/i })).toBeInTheDocument();
    });

    it('has a link back to /login', () => {
      renderWithProviders(<Register />);
      const link = screen.getByRole('link', { name: /sign in/i });
      expect(link).toHaveAttribute('href', '/login');
    });
  });

  describe('client-side validation', () => {
    it('shows email error for invalid address', async () => {
      const user = userEvent.setup();
      renderWithProviders(<Register />);
      await user.type(screen.getByRole('textbox', { name: /email/i }), 'not-an-email');
      const passwords = screen.getAllByLabelText(/password/i);
      await user.type(passwords[0], 'strongpassword1');
      await user.type(passwords[1], 'strongpassword1');
      await user.click(screen.getByRole('button', { name: /create account/i }));
      await waitFor(() => {
        expect(screen.getByText(/valid email/i)).toBeInTheDocument();
      });
    });

    it('shows password too short error', async () => {
      const user = userEvent.setup();
      renderWithProviders(<Register />);
      await user.type(screen.getByRole('textbox', { name: /email/i }), 'a@b.com');
      const passwords = screen.getAllByLabelText(/password/i);
      await user.type(passwords[0], 'short');
      await user.type(passwords[1], 'short');
      await user.click(screen.getByRole('button', { name: /create account/i }));
      await waitFor(() => {
        expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
      });
    });

    it('shows passwords do not match error', async () => {
      const user = userEvent.setup();
      renderWithProviders(<Register />);
      await user.type(screen.getByRole('textbox', { name: /email/i }), 'a@b.com');
      const passwords = screen.getAllByLabelText(/password/i);
      await user.type(passwords[0], 'strongpassword1');
      await user.type(passwords[1], 'differentpassword');
      await user.click(screen.getByRole('button', { name: /create account/i }));
      await waitFor(() => {
        expect(screen.getByText(/do not match/i)).toBeInTheDocument();
      });
    });

    it('does not call fetch when validation fails', async () => {
      const spy = vi.fn();
      vi.stubGlobal('fetch', spy);
      await fillForm({ email: 'bad', submit: true });
      await waitFor(() => expect(screen.getByText(/valid email/i)).toBeInTheDocument());
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('server errors', () => {
    it('shows a field error from the server response', async () => {
      vi.stubGlobal('fetch', makeRegisterStub({ ok: false, fieldErrors: { email: ['has already been taken'] } }));
      await fillForm({ submit: true });
      await waitFor(() => {
        expect(screen.getByText(/has already been taken/i)).toBeInTheDocument();
      });
    });

    it('shows generic error banner on non-field server error', async () => {
      vi.stubGlobal('fetch', makeRegisterStub({ ok: false, error: 'Service unavailable' }));
      await fillForm({ submit: true });
      await waitFor(() => {
        expect(screen.getByText(/service unavailable/i)).toBeInTheDocument();
      });
    });
  });

  describe('successful registration flow', () => {
    it('calls storeToken with the returned JWT', async () => {
      await fillForm({ submit: true });
      await waitFor(() => expect(mockStoreToken).toHaveBeenCalledWith('reg-jwt-token', 'user@example.com'));
    });

    it('registers the device after successful account creation', async () => {
      const fetchSpy = makeRegisterStub();
      vi.stubGlobal('fetch', fetchSpy);
      await fillForm({ submit: true });
      await waitFor(() => {
        const deviceCall = (fetchSpy as ReturnType<typeof vi.fn>).mock.calls.find((args: unknown[]) => String(args[0]).includes('/api/v1/devices'));
        expect(deviceCall).toBeDefined();
      });
    });

    it('navigates to /dashboard after registration', async () => {
      await fillForm({ submit: true });
      await waitFor(() =>
        expect(mockNavigate).toHaveBeenCalledWith('/dashboard', { replace: true })
      );
    });
  });
});
