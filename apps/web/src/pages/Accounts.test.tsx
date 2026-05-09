/**
 * Accounts page tests — uses a real in-memory SQLite database.
 *
 * External dependencies (WebSocket channel, sync batch, DB key derivation,
 * and backend API) are stubbed so tests run without network or native APIs.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach, afterEach, type Mock } from 'vitest';
import { Accounts } from './Accounts';
import { renderWithProviders } from '../test/renderWithProviders';
import { makeTestDb } from '../test/makeTestDb';
import type { DbClient } from '@fresh/core/db';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../context', () => ({ useDb: vi.fn() }));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: true, token: 'test-token', storeToken: vi.fn(), logout: vi.fn() }),
}));

vi.mock('@fresh/core/channels', () => ({
  useFinanceSocket: () => ({ ackSync: vi.fn() }),
}));

vi.mock('@fresh/core/sync', () => ({
  processSyncBatch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../db/driver', () => ({
  getOrCreateDbKey: vi.fn().mockResolvedValue(new Uint8Array(32)),
}));

import { useDb } from '../context';

// ---------------------------------------------------------------------------
// Global fetch stub — returns empty sync jobs list by default
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string | URL | Request) => {
    const urlStr = String(url);
    if (urlStr.includes('/api/v1/sync/jobs')) {
      return new Response(JSON.stringify({ jobs: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
});

afterEach(() => vi.unstubAllGlobals());

// ---------------------------------------------------------------------------
// Per-test DB setup
// ---------------------------------------------------------------------------

let client: DbClient;

beforeEach(async () => {
  const db = await makeTestDb();
  client = db.client;
  (useDb as Mock).mockReturnValue(client);
});

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedAccount(opts: {
  id?: string;
  name?: string;
  type?: string;
  balance?: number;
  lastSynced?: string | null;
  syncTokenRef?: string | null;
} = {}) {
  const id = opts.id ?? 'acc-1';
  await client.raw.execute(
    `INSERT INTO accounts
       (id, name, institution, type, currency, current_balance, connection_type, last_synced_at, sync_token_ref)
     VALUES (?, ?, 'Test Bank', ?, 'USD', ?, 'manual', ?, ?)`,
    [
      id,
      opts.name ?? 'Test Account',
      opts.type ?? 'checking',
      opts.balance ?? 1234.56,
      opts.lastSynced ?? null,
      opts.syncTokenRef ?? null,
    ]
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Accounts', () => {
  describe('empty state (no accounts)', () => {
    it('does not render the "Your accounts" section', async () => {
      renderWithProviders(<Accounts />);
      await waitFor(() => {
        expect(screen.queryByText(/your accounts/i)).not.toBeInTheDocument();
      });
    });

    it('always shows the "Connect a bank" section', async () => {
      renderWithProviders(<Accounts />);
      await waitFor(() => {
        expect(screen.getByText(/connect a bank/i)).toBeInTheDocument();
      });
    });

    it('shows SimpleFIN and GoCardless provider cards', async () => {
      renderWithProviders(<Accounts />);
      await waitFor(() => {
        expect(screen.getByText('SimpleFIN')).toBeInTheDocument();
        expect(screen.getByText('GoCardless')).toBeInTheDocument();
      });
    });
  });

  describe('account list', () => {
    it('shows account name and balance when accounts exist', async () => {
      await seedAccount({ name: 'Chase Checking', balance: 2500 });
      renderWithProviders(<Accounts />);
      await waitFor(() => {
        expect(screen.getByText('Chase Checking')).toBeInTheDocument();
        expect(screen.getByText(/2,500/)).toBeInTheDocument();
      });
    });

    it('shows account type badge', async () => {
      await seedAccount({ type: 'savings' });
      renderWithProviders(<Accounts />);
      await waitFor(() => {
        expect(screen.getByText('savings')).toBeInTheDocument();
      });
    });

    it('shows "Never synced" when last_synced_at is null', async () => {
      await seedAccount({ lastSynced: null });
      renderWithProviders(<Accounts />);
      await waitFor(() => {
        expect(screen.getByText(/never synced/i)).toBeInTheDocument();
      });
    });

    it('shows idle sync badge when no active sync job', async () => {
      await seedAccount();
      renderWithProviders(<Accounts />);
      await waitFor(() => {
        expect(screen.getByText('Idle')).toBeInTheDocument();
      });
    });

    it('shows the Remove button for each account', async () => {
      await seedAccount();
      renderWithProviders(<Accounts />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument();
      });
    });
  });

  describe('Remove account', () => {
    it('deletes the account row from the DB on click', async () => {
      await seedAccount({ id: 'acc-del' });
      renderWithProviders(<Accounts />);

      const removeBtn = await screen.findByRole('button', { name: /remove/i });
      await userEvent.click(removeBtn);

      await waitFor(async () => {
        const rows = await client.raw.query('SELECT id FROM accounts WHERE id = ?', ['acc-del']);
        expect(rows).toHaveLength(0);
      });
    });
  });

  describe('SimpleFIN connection panel', () => {
    it('opens the SimpleFIN input panel when its card is clicked', async () => {
      renderWithProviders(<Accounts />);
      await userEvent.click(await screen.findByText('SimpleFIN'));
      expect(screen.getByLabelText(/setup token/i)).toBeInTheDocument();
    });

    it('Connect button is disabled when the token field is empty', async () => {
      renderWithProviders(<Accounts />);
      await userEvent.click(await screen.findByText('SimpleFIN'));
      const connectBtn = screen.getByRole('button', { name: /^connect$/i });
      expect(connectBtn).toBeDisabled();
    });

    it('Connect button is enabled after entering a token', async () => {
      renderWithProviders(<Accounts />);
      await userEvent.click(await screen.findByText('SimpleFIN'));
      await userEvent.type(screen.getByLabelText(/setup token/i), 'my-setup-token');
      expect(screen.getByRole('button', { name: /^connect$/i })).not.toBeDisabled();
    });

    it('Cancel button hides the SimpleFIN panel', async () => {
      renderWithProviders(<Accounts />);
      await userEvent.click(await screen.findByText('SimpleFIN'));
      await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
      await waitFor(() => {
        expect(screen.queryByLabelText(/setup token/i)).not.toBeInTheDocument();
      });
    });

    it('shows an error banner when the API returns an error', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
        const urlStr = String(url);
        if (urlStr.includes('/simplefin/claim')) {
          return new Response(
            JSON.stringify({ error: 'Invalid setup token' }),
            { status: 422, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (urlStr.includes('/sync/jobs')) {
          return new Response(JSON.stringify({ jobs: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }));

      renderWithProviders(<Accounts />);
      await userEvent.click(await screen.findByText('SimpleFIN'));
      await userEvent.type(screen.getByLabelText(/setup token/i), 'bad-token');
      await userEvent.click(screen.getByRole('button', { name: /^connect$/i }));

      await waitFor(() => {
        // Both top-level and panel-inline error banners show the same message
        expect(screen.getAllByText(/invalid setup token/i).length).toBeGreaterThan(0);
      });
    });

    it('shows a success banner when the API call succeeds', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => {
        const urlStr = String(url);
        if (urlStr.includes('/simplefin/claim')) {
          return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (urlStr.includes('/sync/jobs')) {
          return new Response(JSON.stringify({ jobs: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }));

      renderWithProviders(<Accounts />);
      await userEvent.click(await screen.findByText('SimpleFIN'));
      await userEvent.type(screen.getByLabelText(/setup token/i), 'valid-token');
      await userEvent.click(screen.getByRole('button', { name: /^connect$/i }));

      await waitFor(() => {
        expect(screen.getByText(/simplefin account connected/i)).toBeInTheDocument();
      });
    });
  });
});
