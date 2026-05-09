/**
 * Settings page tests — real in-memory SQLite for all local-DB operations.
 * Backend API calls (devices, profile PATCH, account DELETE) are stubbed via
 * vi.stubGlobal('fetch', …) / vi.spyOn since they cross the network boundary.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, type Mock } from 'vitest';
import { Settings } from './Settings';
import { renderWithProviders } from '../test/renderWithProviders';
import { makeTestDb } from '../test/makeTestDb';
import type { DbClient } from '@fresh/core/db';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../context', () => ({ useDb: vi.fn() }));
vi.mock('../hooks/useAuth', () => ({
  useAuth: vi.fn(() => ({ logout: vi.fn() })),
}));
vi.mock('../cloud/oauth', () => ({
  getStoredProvider: vi.fn(() => null),
  clearCloudAuth: vi.fn(),
  initiateDropboxOAuth: vi.fn(),
  initiateGDriveOAuth: vi.fn(),
}));

import { useDb } from '../context';
import { useAuth } from '../hooks/useAuth';
import {
  getStoredProvider,
  clearCloudAuth,
  initiateDropboxOAuth,
  initiateGDriveOAuth,
} from '../cloud/oauth';

// ---------------------------------------------------------------------------
// Per-test DB + fetch setup
// ---------------------------------------------------------------------------

let client: DbClient;
let mockFetch: Mock;

beforeEach(async () => {
  const db = await makeTestDb();
  client = db.client;
  (useDb as Mock).mockReturnValue(client);
  (useAuth as Mock).mockReturnValue({ logout: vi.fn() });

  // Default fetch: empty devices list
  mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => [],
  });
  vi.stubGlobal('fetch', mockFetch);

  // Silence localStorage warnings in jsdom
  localStorage.clear();
  localStorage.setItem('user_email', 'test@example.com');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedRule(overrides: {
  id?: string;
  name?: string;
  rule_type?: string;
  params?: string;
  enabled?: number;
} = {}) {
  const id = overrides.id ?? crypto.randomUUID();
  await client.raw.execute(
    `INSERT INTO alert_rules (id, name, rule_type, params, enabled)
     VALUES (?, ?, ?, ?, ?)`,
    [
      id,
      overrides.name ?? 'Test Rule',
      overrides.rule_type ?? 'large_transaction',
      overrides.params ?? JSON.stringify({ threshold_amount: 500 }),
      overrides.enabled ?? 1,
    ]
  );
  return id;
}

async function seedAccount(id = 'acc-1', name = 'Checking') {
  await client.raw.execute(
    `INSERT INTO accounts (id, name, institution, type, currency, connection_type)
     VALUES (?, ?, 'Test Bank', 'checking', 'USD', 'manual')
     ON CONFLICT(id) DO NOTHING`,
    [id, name]
  );
}

// ---------------------------------------------------------------------------
// Profile section
// ---------------------------------------------------------------------------

describe('Settings — profile section', () => {
  it('displays the user email', async () => {
    renderWithProviders(<Settings />);
    await waitFor(() => {
      expect(screen.getByText('test@example.com')).toBeInTheDocument();
    });
  });

  it('renders timezone and region selectors', async () => {
    renderWithProviders(<Settings />);
    await waitFor(() => {
      expect(screen.getByLabelText(/timezone/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/region/i)).toBeInTheDocument();
    });
  });

  it('shows "Change password" toggle', async () => {
    renderWithProviders(<Settings />);
    await waitFor(() => {
      expect(screen.getByText(/change password/i)).toBeInTheDocument();
    });
  });

  it('opens the password form when "Change password" is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await waitFor(() => expect(screen.getByText('Change password')).toBeInTheDocument());
    await user.click(screen.getByText('Change password'));
    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm new password')).toBeInTheDocument();
  });

  it('shows an error banner when passwords do not match', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    renderWithProviders(<Settings />);
    await waitFor(() => expect(screen.getByText('Change password')).toBeInTheDocument());
    await user.click(screen.getByText('Change password'));
    await user.type(screen.getByLabelText(/current password/i), 'oldpass');
    await user.type(screen.getByLabelText('New password'), 'newpass1');
    await user.type(screen.getByLabelText('Confirm new password'), 'different');
    await user.click(screen.getByRole('button', { name: /update password/i }));
    await waitFor(() => {
      expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    });
  });

  it('calls PATCH /api/v1/users/me on password change and closes the form', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    renderWithProviders(<Settings />);
    await waitFor(() => expect(screen.getByText('Change password')).toBeInTheDocument());
    await user.click(screen.getByText('Change password'));
    await user.type(screen.getByLabelText(/current password/i), 'oldpass');
    await user.type(screen.getByLabelText('New password'), 'newpass123');
    await user.type(screen.getByLabelText('Confirm new password'), 'newpass123');
    await user.click(screen.getByRole('button', { name: /update password/i }));
    // Form closes on success — absence of the password inputs confirms it
    await waitFor(() => {
      expect(screen.queryByLabelText(/current password/i)).not.toBeInTheDocument();
    });
    const patchCall = mockFetch.mock.calls.find(
      (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('/api/v1/users/me') && (c[1] as RequestInit).method === 'PATCH'
    );
    expect(patchCall).toBeTruthy();
    const body = JSON.parse((patchCall![1] as RequestInit).body as string);
    expect(body.current_password).toBe('oldpass');
    expect(body.new_password).toBe('newpass123');
  });

  it('calls PATCH /api/v1/users/me with timezone/region on profile save', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await waitFor(() => expect(screen.getByLabelText(/timezone/i)).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText(/timezone/i), 'Europe/London');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => {
      const patchCall = mockFetch.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && c[0].includes('/api/v1/users/me') && (c[1] as RequestInit).method === 'PATCH'
      );
      expect(patchCall).toBeTruthy();
      const body = JSON.parse((patchCall![1] as RequestInit).body as string);
      expect(body.timezone).toBe('Europe/London');
    });
  });
});

// ---------------------------------------------------------------------------
// Alert rules section
// ---------------------------------------------------------------------------

describe('Settings — alert rules', () => {
  it('shows empty state when no rules exist', async () => {
    renderWithProviders(<Settings />);
    await waitFor(() => {
      expect(screen.getByText(/no alert rules yet/i)).toBeInTheDocument();
    });
  });

  it('renders a seeded rule with name and type badge', async () => {
    await seedRule({ name: 'Big Spend', rule_type: 'large_transaction' });
    renderWithProviders(<Settings />);
    await waitFor(() => {
      expect(screen.getByText('Big Spend')).toBeInTheDocument();
      expect(screen.getByText(/large transaction/i)).toBeInTheDocument();
    });
  });

  it('renders a disabled rule with "off" badge', async () => {
    await seedRule({ name: 'Disabled Rule', enabled: 0 });
    renderWithProviders(<Settings />);
    await waitFor(() => {
      expect(screen.getByText('off')).toBeInTheDocument();
    });
  });

  it('opens the new rule form when "+ New rule" is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await waitFor(() => expect(screen.getByRole('button', { name: /new rule/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /new rule/i }));
    expect(screen.getByText(/new alert rule/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/rule name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/rule type/i)).toBeInTheDocument();
  });

  it('shows a validation error when name is empty on save', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await waitFor(() => expect(screen.getByRole('button', { name: /new rule/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /new rule/i }));
    await user.click(screen.getByRole('button', { name: /save rule/i }));
    await waitFor(() => {
      expect(screen.getByText(/rule name is required/i)).toBeInTheDocument();
    });
  });

  it('shows threshold field for large_transaction type', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await waitFor(() => expect(screen.getByRole('button', { name: /new rule/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /new rule/i }));
    await user.selectOptions(screen.getByLabelText(/rule type/i), 'large_transaction');
    expect(screen.getByLabelText(/threshold amount/i)).toBeInTheDocument();
  });

  it('shows merchant names field for merchant type', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await waitFor(() => expect(screen.getByRole('button', { name: /new rule/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /new rule/i }));
    await user.selectOptions(screen.getByLabelText(/rule type/i), 'merchant');
    expect(screen.getByLabelText(/merchant names/i)).toBeInTheDocument();
  });

  it('shows account dropdown for balance_low type', async () => {
    await seedAccount();
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await waitFor(() => expect(screen.getByRole('button', { name: /new rule/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /new rule/i }));
    await user.selectOptions(screen.getByLabelText(/rule type/i), 'balance_low');
    expect(screen.getByLabelText(/^account/i)).toBeInTheDocument();
  });

  it('persists a new large_transaction rule to the DB on save', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await waitFor(() => expect(screen.getByRole('button', { name: /new rule/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /new rule/i }));
    await user.type(screen.getByLabelText(/rule name/i), 'High Purchase');
    await user.selectOptions(screen.getByLabelText(/rule type/i), 'large_transaction');
    await user.type(screen.getByLabelText(/threshold amount/i), '1000');
    await user.click(screen.getByRole('button', { name: /save rule/i }));

    await waitFor(async () => {
      const rows = await client.raw.query<{ name: string; params: string }>(
        `SELECT name, params FROM alert_rules WHERE name = 'High Purchase'`
      );
      expect(rows).toHaveLength(1);
      const params = JSON.parse(rows[0].params);
      expect(params.threshold_amount).toBe(1000);
    });
  });

  it('persists a new merchant rule with parsed merchant_names array', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await waitFor(() => expect(screen.getByRole('button', { name: /new rule/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /new rule/i }));
    await user.type(screen.getByLabelText(/rule name/i), 'Watch Merchants');
    await user.selectOptions(screen.getByLabelText(/rule type/i), 'merchant');
    await user.type(screen.getByLabelText(/merchant names/i), 'Amazon, Netflix');
    await user.click(screen.getByRole('button', { name: /save rule/i }));

    await waitFor(async () => {
      const rows = await client.raw.query<{ params: string }>(
        `SELECT params FROM alert_rules WHERE name = 'Watch Merchants'`
      );
      expect(rows).toHaveLength(1);
      const params = JSON.parse(rows[0].params);
      expect(params.merchant_names).toEqual(['Amazon', 'Netflix']);
    });
  });

  it('shows a success banner after creating a rule', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await waitFor(() => expect(screen.getByRole('button', { name: /new rule/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /new rule/i }));
    await user.type(screen.getByLabelText(/rule name/i), 'My Rule');
    await user.selectOptions(screen.getByLabelText(/rule type/i), 'merchant');
    await user.type(screen.getByLabelText(/merchant names/i), 'Starbucks');
    await user.click(screen.getByRole('button', { name: /save rule/i }));
    await waitFor(() => {
      expect(screen.getByText(/rule created/i)).toBeInTheDocument();
    });
  });

  it('Cancel closes the form without writing to the DB', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await waitFor(() => expect(screen.getByRole('button', { name: /new rule/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /new rule/i }));
    await user.type(screen.getByLabelText(/rule name/i), 'Abandoned');
    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByText(/new alert rule/i)).not.toBeInTheDocument();
    const rows = await client.raw.query(`SELECT * FROM alert_rules WHERE name = 'Abandoned'`);
    expect(rows).toHaveLength(0);
  });

  it('opens edit form pre-populated with existing rule data', async () => {
    const id = await seedRule({ name: 'Watch Amazon', rule_type: 'merchant', params: JSON.stringify({ merchant_names: ['Amazon'] }) });
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await waitFor(() => expect(screen.getByText('Watch Amazon')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /edit rule/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/rule name/i)).toHaveValue('Watch Amazon');
      expect(screen.getByLabelText(/merchant names/i)).toHaveValue('Amazon');
    });
    // Ensure the rule id was used (upsert should not duplicate)
    const rows = await client.raw.query(`SELECT * FROM alert_rules WHERE id = ?`, [id]);
    expect(rows).toHaveLength(1);
  });

  it('toggles a rule enabled/disabled in the DB', async () => {
    const id = await seedRule({ name: 'Active Rule', enabled: 1 });
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await waitFor(() => expect(screen.getByRole('button', { name: /disable rule/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /disable rule/i }));
    await waitFor(async () => {
      const rows = await client.raw.query<{ enabled: number }>(
        `SELECT enabled FROM alert_rules WHERE id = ?`,
        [id]
      );
      expect(rows[0].enabled).toBe(0);
    });
  });

  it('deletes a rule from the DB when confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const id = await seedRule({ name: 'To Delete' });
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await waitFor(() => expect(screen.getByText('To Delete')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /delete rule/i }));
    await waitFor(async () => {
      const rows = await client.raw.query(`SELECT * FROM alert_rules WHERE id = ?`, [id]);
      expect(rows).toHaveLength(0);
    });
  });

  it('does not delete a rule when confirm is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    const id = await seedRule({ name: 'Keep Me' });
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await waitFor(() => expect(screen.getByText('Keep Me')).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /delete rule/i }));
    const rows = await client.raw.query(`SELECT * FROM alert_rules WHERE id = ?`, [id]);
    expect(rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Connected devices section
// ---------------------------------------------------------------------------

describe('Settings — connected devices', () => {
  it('renders a device returned by the API', async () => {
    const device = {
      id: 'dev-1',
      name: 'Chrome on Mac',
      platform: 'web',
      last_active_at: '2026-04-01T12:00:00Z',
      is_current: false,
    };
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [device],
    });
    renderWithProviders(<Settings />);
    await waitFor(() => {
      expect(screen.getByText('Chrome on Mac')).toBeInTheDocument();
    });
  });

  it('shows "This device" badge for the current device', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: 'dev-current',
          name: 'This Browser',
          platform: 'web',
          last_active_at: '2026-04-07T10:00:00Z',
          is_current: true,
        },
      ],
    });
    renderWithProviders(<Settings />);
    await waitFor(() => {
      expect(screen.getByText('This device')).toBeInTheDocument();
    });
  });

  it('hides the Revoke button for the current device', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 'dev-cur', name: 'Me', platform: 'web', last_active_at: '2026-04-07T10:00:00Z', is_current: true },
      ],
    });
    renderWithProviders(<Settings />);
    await waitFor(() => expect(screen.getByText('Me')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /revoke/i })).not.toBeInTheDocument();
  });

  it('calls DELETE /api/v1/devices/:id when revoke is confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const device = {
      id: 'dev-2',
      name: 'Firefox on Windows',
      platform: 'web',
      last_active_at: '2026-03-01T08:00:00Z',
      is_current: false,
    };
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [device] })
      .mockResolvedValueOnce({ ok: true, json: async () => null }) // DELETE
      .mockResolvedValueOnce({ ok: true, json: async () => [] }); // refetch

    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await waitFor(() => expect(screen.getByRole('button', { name: /revoke/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /revoke/i }));
    await waitFor(() => {
      const deleteCall = mockFetch.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('dev-2') &&
          (c[1] as RequestInit).method === 'DELETE'
      );
      expect(deleteCall).toBeTruthy();
    });
  });

  it('shows an error message when devices fail to load', async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) });
    renderWithProviders(<Settings />);
    await waitFor(() => {
      expect(screen.getByText(/could not load devices/i)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Data section
// ---------------------------------------------------------------------------

describe('Settings — data section', () => {
  it('renders Export and Wipe buttons', async () => {
    renderWithProviders(<Settings />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /wipe/i })).toBeInTheDocument();
    });
  });

  it('wipes all DB tables when confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    // Seed some data
    await seedAccount('acc-wipe');
    await seedRule({ name: 'Rule to Wipe' });

    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await waitFor(() => expect(screen.getByRole('button', { name: /wipe/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /wipe/i }));

    await waitFor(async () => {
      const accs = await client.raw.query('SELECT * FROM accounts');
      const rules = await client.raw.query('SELECT * FROM alert_rules');
      expect(accs).toHaveLength(0);
      expect(rules).toHaveLength(0);
    });
  });

  it('does not wipe the DB when confirm is cancelled', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    await seedAccount('acc-keep');
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await waitFor(() => expect(screen.getByRole('button', { name: /wipe/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /wipe/i }));
    const accs = await client.raw.query('SELECT * FROM accounts');
    expect(accs).toHaveLength(1);
  });

  it('shows success banner after wipe', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await waitFor(() => expect(screen.getByRole('button', { name: /wipe/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /wipe/i }));
    await waitFor(() => {
      expect(screen.getByText(/local data wiped/i)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Danger zone
// ---------------------------------------------------------------------------

describe('Settings — danger zone', () => {
  it('renders Sign out and Delete account buttons', async () => {
    renderWithProviders(<Settings />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /delete account/i })).toBeInTheDocument();
    });
  });

  it('calls logout when Sign out is clicked', async () => {
    const logoutFn = vi.fn();
    (useAuth as Mock).mockReturnValue({ logout: logoutFn });
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await waitFor(() => expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: /sign out/i }));
    expect(logoutFn).toHaveBeenCalledOnce();
  });

  it('opens a password modal when Delete account is clicked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /delete account/i })).toBeInTheDocument()
    );
    await user.click(screen.getByRole('button', { name: /delete account/i }));
    expect(screen.getByLabelText(/^password$/i)).toBeInTheDocument();
  });

  it('calls DELETE /api/v1/users/me with password and then logout when confirmed', async () => {
    const logoutFn = vi.fn();
    (useAuth as Mock).mockReturnValue({ logout: logoutFn });

    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] }) // devices
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => null }); // DELETE /users/me

    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /delete account/i })).toBeInTheDocument()
    );
    await user.click(screen.getByRole('button', { name: /delete account/i }));

    const modal = await screen.findByTestId('delete-account-modal');
    await user.type(within(modal).getByLabelText(/^password$/i), 'mypassword');
    await user.click(within(modal).getByRole('button', { name: /^delete account$/i }));

    await waitFor(() => {
      const deleteCall = mockFetch.mock.calls.find(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          c[0].includes('/api/v1/users/me') &&
          (c[1] as RequestInit).method === 'DELETE'
      );
      expect(deleteCall).toBeTruthy();
      const body = JSON.parse((deleteCall![1] as RequestInit).body as string);
      expect(body.password).toBe('mypassword');
      expect(logoutFn).toHaveBeenCalledOnce();
    });
  });

  it('shows an error when wrong password is entered', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => [] }) // devices
      .mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: 'invalid_password' }) });

    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /delete account/i })).toBeInTheDocument()
    );
    await user.click(screen.getByRole('button', { name: /delete account/i }));

    const modal = await screen.findByTestId('delete-account-modal');
    await user.type(within(modal).getByLabelText(/^password$/i), 'wrongpass');
    await user.click(within(modal).getByRole('button', { name: /^delete account$/i }));

    await waitFor(() => {
      expect(screen.getByText(/incorrect password/i)).toBeInTheDocument();
    });
  });

  it('does not call DELETE when modal is cancelled', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => [] });
    const user = userEvent.setup();
    renderWithProviders(<Settings />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /delete account/i })).toBeInTheDocument()
    );
    await user.click(screen.getByRole('button', { name: /delete account/i }));

    const modal = await screen.findByTestId('delete-account-modal');
    await user.click(within(modal).getByRole('button', { name: /cancel/i }));

    const deleteCall = mockFetch.mock.calls.find(
      (c: unknown[]) =>
        typeof c[0] === 'string' &&
        c[0].includes('/api/v1/users/me') &&
        (c[1] as RequestInit).method === 'DELETE'
    );
    expect(deleteCall).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Cloud backup section
// ---------------------------------------------------------------------------

describe('Settings — cloud backup', () => {
  it('shows "None" when no provider is connected', async () => {
    (getStoredProvider as Mock).mockReturnValue(null);
    renderWithProviders(<Settings />);
    await waitFor(() => {
      expect(
        screen.getByText(/none — your data is stored locally only/i)
      ).toBeInTheDocument();
    });
  });

  it('shows connect buttons when not connected', async () => {
    (getStoredProvider as Mock).mockReturnValue(null);
    renderWithProviders(<Settings />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /connect dropbox/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /connect google drive/i })).toBeInTheDocument();
    });
  });

  it('shows "Connected: Dropbox" and Disconnect button when dropbox is connected', async () => {
    (getStoredProvider as Mock).mockReturnValue('dropbox');
    renderWithProviders(<Settings />);
    await waitFor(() => {
      expect(screen.getByText(/connected: dropbox/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /connect dropbox/i })).not.toBeInTheDocument();
    });
  });

  it('shows "Connected: Google Drive" when gdrive is connected', async () => {
    (getStoredProvider as Mock).mockReturnValue('gdrive');
    renderWithProviders(<Settings />);
    await waitFor(() => {
      expect(screen.getByText(/connected: google drive/i)).toBeInTheDocument();
    });
  });

  it('clicking Disconnect calls clearCloudAuth and reverts UI to disconnected state', async () => {
    const user = userEvent.setup();
    (getStoredProvider as Mock).mockReturnValue('dropbox');
    renderWithProviders(<Settings />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /disconnect/i })).toBeInTheDocument()
    );
    await user.click(screen.getByRole('button', { name: /disconnect/i }));

    expect(clearCloudAuth).toHaveBeenCalled();
    await waitFor(() => {
      expect(
        screen.getByText(/none — your data is stored locally only/i)
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /disconnect/i })).not.toBeInTheDocument();
    });
  });

  it('shows error banner when Dropbox connect fails', async () => {
    const user = userEvent.setup();
    (getStoredProvider as Mock).mockReturnValue(null);
    (initiateDropboxOAuth as Mock).mockRejectedValue(
      new Error('VITE_DROPBOX_CLIENT_ID is not configured')
    );
    renderWithProviders(<Settings />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /connect dropbox/i })).toBeInTheDocument()
    );
    await user.click(screen.getByRole('button', { name: /connect dropbox/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/VITE_DROPBOX_CLIENT_ID is not configured/i)
      ).toBeInTheDocument();
    });
  });

  it('shows error banner when Google Drive connect fails', async () => {
    const user = userEvent.setup();
    (getStoredProvider as Mock).mockReturnValue(null);
    (initiateGDriveOAuth as Mock).mockRejectedValue(
      new Error('VITE_GDRIVE_CLIENT_ID is not configured')
    );
    renderWithProviders(<Settings />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /connect google drive/i })).toBeInTheDocument()
    );
    await user.click(screen.getByRole('button', { name: /connect google drive/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/VITE_GDRIVE_CLIENT_ID is not configured/i)
      ).toBeInTheDocument();
    });
  });
});
