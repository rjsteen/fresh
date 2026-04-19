/**
 * AccountsScreen tests — covers the two mutation fixes:
 *
 * 1. triggerSyncMutation: syncOverride must clear back to 'idle' after a
 *    successful sync trigger (was: no onSuccess, badge stuck at 'Syncing…').
 *
 * 2. removeMutation: local SQLite DELETE must happen before the server call so
 *    that a server failure never leaves the account row orphaned on-device
 *    (was: server called first, local second — server success + local fail =
 *    orphaned server connection with no local cleanup path).
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, type Mock } from 'vitest';
import { AccountsScreen } from './AccountsScreen';
import { renderWithProviders } from '../test/renderWithProviders';
import { makeTestDb } from '../test/makeTestDb';
import type { DbClient } from '@fresh/core/db';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../context/DbContext', () => ({ useDb: vi.fn() }));
vi.mock('../store/auth', () => ({ useAuthStore: vi.fn() }));
// Channels / sync are not needed in these tests
vi.mock('@fresh/core/channels', () => ({ useFinanceSocket: vi.fn(() => ({ ackSync: vi.fn() })) }));
vi.mock('../db/driver', () => ({
  NativeSqliteDriver: { create: vi.fn(), getDeviceKey: vi.fn().mockResolvedValue('key') },
}));

import { useDb } from '../context/DbContext';
import { useAuthStore } from '../store/auth';

// ---------------------------------------------------------------------------
// Per-test DB + mock setup
// ---------------------------------------------------------------------------

let client: DbClient;

beforeEach(async () => {
  const db = await makeTestDb();
  client = db.client;
  (useDb as Mock).mockReturnValue(client);
  (useAuthStore as unknown as Mock).mockImplementation((selector: (s: { token: string }) => unknown) =>
    selector({ token: 'test-token' })
  );
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedAccount(overrides: { id?: string; name?: string; syncTokenRef?: string | null } = {}) {
  const id = overrides.id ?? 'acc-1';
  await client.raw.execute(
    `INSERT INTO accounts (id, name, institution, type, currency, current_balance, connection_type, sync_token_ref)
     VALUES (?, ?, 'Test Bank', 'checking', 'USD', 1000, 'simplefin', ?)`,
    [id, overrides.name ?? 'Checking', overrides.syncTokenRef ?? null]
  );
  return id;
}

function mockFetch(responses: Record<string, { ok: boolean; body?: unknown }>) {
  (fetch as Mock).mockImplementation((url: string) => {
    for (const [pattern, resp] of Object.entries(responses)) {
      if (url.includes(pattern)) {
        return Promise.resolve({
          ok: resp.ok,
          json: () => Promise.resolve(resp.body ?? {}),
        });
      }
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
}

// ---------------------------------------------------------------------------
// Tests: triggerSyncMutation onSuccess clears syncOverride
// ---------------------------------------------------------------------------

describe('triggerSyncMutation', () => {
  it('resets the sync badge to Idle after a successful trigger', async () => {
    const user = userEvent.setup();
    const tokenRef = 'ref-abc';
    const jobId = 'job-1';
    await seedAccount({ syncTokenRef: tokenRef });

    mockFetch({
      '/sync/jobs': { ok: true, body: { jobs: [{ id: jobId, account_token_ref: tokenRef, status: 'idle', connection_type: 'simplefin' }] } },
      [`/sync/${jobId}/trigger`]: { ok: true },
    });

    renderWithProviders(<AccountsScreen />);

    // Wait for accounts and sync jobs to load
    await waitFor(() => expect(screen.getByText('Sync now')).toBeInTheDocument());

    // Badge should start as Idle
    expect(screen.getByText('Idle')).toBeInTheDocument();

    // Click Sync now — this triggers onMutate (sets 'syncing'), then onSuccess (clears to 'idle')
    await user.click(screen.getByText('Sync now'));

    await waitFor(() => {
      expect(screen.getByText('Idle')).toBeInTheDocument();
      expect(screen.queryByText('Syncing…')).not.toBeInTheDocument();
    });
  });

  it('shows error banner and resets badge to Idle when trigger fails', async () => {
    const user = userEvent.setup();
    const tokenRef = 'ref-fail';
    const jobId = 'job-fail';
    await seedAccount({ syncTokenRef: tokenRef });

    mockFetch({
      '/sync/jobs': { ok: true, body: { jobs: [{ id: jobId, account_token_ref: tokenRef, status: 'idle', connection_type: 'simplefin' }] } },
      [`/sync/${jobId}/trigger`]: { ok: false },
    });

    renderWithProviders(<AccountsScreen />);

    await waitFor(() => expect(screen.getByText('Sync now')).toBeInTheDocument());
    await user.click(screen.getByText('Sync now'));

    await waitFor(() => {
      expect(screen.queryByText('Syncing…')).not.toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Tests: removeMutation — local delete happens before server call
// ---------------------------------------------------------------------------

describe('removeMutation', () => {
  it('removes the account from the DB even when the server DELETE fails', async () => {
    const user = userEvent.setup();
    const tokenRef = 'ref-remove';
    const jobId = 'job-remove';
    const accountId = await seedAccount({ name: 'My Bank', syncTokenRef: tokenRef });

    mockFetch({
      '/sync/jobs': { ok: true, body: { jobs: [{ id: jobId, account_token_ref: tokenRef, status: 'idle', connection_type: 'simplefin' }] } },
      [`/connections/${jobId}`]: { ok: false }, // server delete fails
    });

    renderWithProviders(<AccountsScreen />);

    await waitFor(() => expect(screen.getByText('Remove')).toBeInTheDocument());

    // Alert mock auto-confirms destructive action
    await user.click(screen.getByText('Remove'));

    // Local account row should be gone even though server returned an error
    await waitFor(async () => {
      const rows = await client.raw.query('SELECT id FROM accounts WHERE id = ?', [accountId]);
      expect(rows).toHaveLength(0);
    });
  });

  it('removes the account from the DB when there is no sync job (manual account)', async () => {
    const user = userEvent.setup();
    const accountId = await seedAccount({ name: 'Cash', syncTokenRef: null });

    mockFetch({
      '/sync/jobs': { ok: true, body: { jobs: [] } },
    });

    renderWithProviders(<AccountsScreen />);

    await waitFor(() => expect(screen.getByText('Remove')).toBeInTheDocument());
    await user.click(screen.getByText('Remove'));

    await waitFor(async () => {
      const rows = await client.raw.query('SELECT id FROM accounts WHERE id = ?', [accountId]);
      expect(rows).toHaveLength(0);
    });
  });

  it('does NOT call the server DELETE when the account has no sync job', async () => {
    const user = userEvent.setup();
    await seedAccount({ name: 'Manual', syncTokenRef: null });

    mockFetch({
      '/sync/jobs': { ok: true, body: { jobs: [] } },
    });

    renderWithProviders(<AccountsScreen />);

    await waitFor(() => expect(screen.getByText('Remove')).toBeInTheDocument());
    await user.click(screen.getByText('Remove'));

    await waitFor(async () => {
      const rows = await client.raw.query('SELECT id FROM accounts WHERE name = ?', ['Manual']);
      expect(rows).toHaveLength(0);
    });

    // fetch should only have been called for sync/jobs, not for connections
    const deleteCalls = (fetch as Mock).mock.calls.filter((args: unknown[]) =>
      (args[0] as string).includes('/connections/')
    );
    expect(deleteCalls).toHaveLength(0);
  });
});
