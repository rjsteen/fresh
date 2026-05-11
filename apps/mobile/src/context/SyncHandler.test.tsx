/**
 * Tests for the SyncHandler component in DbContext.
 *
 * SyncHandler wires useFinanceSocket → NativeSqliteDriver.getDeviceKey →
 * processSyncBatch. Uses a real in-memory SQL.js DB and real processSyncBatch
 * to keep the pipeline honest. Native modules are mocked at the module level
 * so jsdom can load DbContext without native binaries.
 */

import { vi, describe, it, beforeEach, afterEach, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import type { SyncCompletePayload } from '@fresh/core/channels';

// ---------------------------------------------------------------------------
// Module mocks — vi.mock calls are hoisted before any import
// ---------------------------------------------------------------------------

vi.mock('@fresh/core/channels', () => ({
  useFinanceSocket: vi.fn(),
}));

vi.mock('../db/driver', () => ({
  NativeSqliteDriver: {
    getDeviceKey: vi.fn(),
  },
}));

vi.mock('../store/auth', () => ({
  useAuthStore: vi.fn(),
}));

// DbContext.tsx imports these at module level — stub them so the file loads.
vi.mock('../store/cloud', () => ({
  useCloudStore: {
    getState: vi.fn(() => ({
      hydrate: vi.fn(),
      buildAdapter: vi.fn(() => null),
    })),
  },
}));

vi.mock('@fresh/core/cloud', () => ({
  CloudSyncManager: vi.fn().mockReturnValue({
    hydrate: vi.fn().mockResolvedValue('up_to_date'),
    pushFullFile: vi.fn(),
    startDeltaPush: vi.fn(),
    stopDeltaPush: vi.fn(),
    pushPendingDeltas: vi.fn(),
  }),
}));

vi.mock('expo-file-system', () => ({
  documentDirectory: '/tmp/fresh/',
  readAsStringAsync: vi.fn(),
  moveAsync: vi.fn(),
  deleteAsync: vi.fn(),
  EncodingType: { Base64: 'base64' },
}));

// ---------------------------------------------------------------------------
// Real imports (after mocks are registered)
// ---------------------------------------------------------------------------

import { SyncHandler } from './DbContext';
import { useFinanceSocket } from '@fresh/core/channels';
import { NativeSqliteDriver } from '../db/driver';
import { useAuthStore } from '../store/auth';
import { makeTestDb } from '../test/makeTestDb';
import type { SqliteDriver } from '@fresh/core/db';
import { DbClient } from '@fresh/core/db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

async function encryptJson(data: unknown, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  const out = new Uint8Array(12 + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertext), 12);
  return btoa(String.fromCharCode(...out));
}

const encryptBatch = (txs: unknown[], key: CryptoKey) => encryptJson(txs, key);

function makeAccount() {
  return {
    external_id: ACCOUNT_EXTERNAL_ID,
    name: 'Sync Test Bank',
    institution: 'Test',
    type: 'checking',
    currency: 'USD',
    balance: 0,
    available_balance: null,
  };
}

const ACCOUNT_ID = 'acc-sync-test';
const ACCOUNT_EXTERNAL_ID = 'ext-acct-1';

function makeTx(overrides: Record<string, unknown> = {}) {
  return {
    id: 'tx-1',
    account_external_id: ACCOUNT_EXTERNAL_ID,
    external_id: 'ext-1',
    amount: -12.5,
    currency: 'USD',
    description: 'Coffee',
    merchant_name: null,
    category_id: null,
    category_source: null,
    ml_confidence: null,
    date: '2026-04-25',
    posted_at: null,
    pending: false,
    notes: null,
    tags: null,
    created_at: '2026-04-25T10:00:00',
    updated_at: '2026-04-25T10:00:00',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SyncHandler', () => {
  let driver: SqliteDriver;
  let client: DbClient;
  let deviceKey: CryptoKey;
  let capturedOnSyncComplete: ((p: SyncCompletePayload) => void) | undefined;
  let mockAckSync: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    ({ driver, client } = await makeTestDb());
    deviceKey = await makeAesKey();

    await driver.execute(
      `INSERT INTO accounts (id, name, institution, type, currency, current_balance, connection_type, is_active, external_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [ACCOUNT_ID, 'Sync Test Bank', 'Test', 'checking', 'USD', 0, 'manual', 1, ACCOUNT_EXTERNAL_ID],
    );

    mockAckSync = vi.fn();

    vi.mocked(useFinanceSocket).mockImplementation((opts) => {
      capturedOnSyncComplete = opts.onSyncComplete;
      return {
        ackSync: mockAckSync as unknown as (accountTokenRef: string) => void,
        isConnected: false,
        deviceKey: null,
        registerAlertToken: vi.fn() as unknown as (ruleTokenRef: string) => void,
        deregisterAlertToken: vi.fn() as unknown as (ruleTokenRef: string) => void,
      };
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAuthStore).mockImplementation((selector: any) => selector({ token: 'device-token-abc' }));

    vi.mocked(NativeSqliteDriver.getDeviceKey).mockResolvedValue(deviceKey);
  });

  afterEach(async () => {
    await driver.close();
  });

  // -------------------------------------------------------------------------

  it('passes device token from useAuthStore to useFinanceSocket', () => {
    render(<SyncHandler db={client} />);

    expect(vi.mocked(useFinanceSocket)).toHaveBeenCalledWith(
      expect.objectContaining({ deviceToken: 'device-token-abc' }),
    );
  });

  it('calls NativeSqliteDriver.getDeviceKey on sync:complete', async () => {
    render(<SyncHandler db={client} />);

    const encrypted = await encryptBatch([makeTx()], deviceKey);
    capturedOnSyncComplete!({
      account_token_ref: 'ref-1',
      transaction_count: 1,
      cursor: '',
      encrypted_batch: encrypted,
    });

    await waitFor(() => expect(NativeSqliteDriver.getDeviceKey).toHaveBeenCalledOnce());
  });

  it('passes the device key and db to processSyncBatch (asserts on DB state)', async () => {
    render(<SyncHandler db={client} />);

    capturedOnSyncComplete!({
      account_token_ref: 'ref-2',
      transaction_count: 1,
      cursor: '',
      encrypted_accounts: await encryptJson([makeAccount()], deviceKey),
      encrypted_batch: await encryptBatch([makeTx()], deviceKey),
    });

    await waitFor(async () => {
      const rows = await driver.query<{ external_id: string }>('SELECT external_id FROM transactions');
      expect(rows).toHaveLength(1);
      expect(rows[0].external_id).toBe('ext-1');
    });
  });

  it('sends ack via ackSyncRef after batch processing', async () => {
    render(<SyncHandler db={client} />);

    const encrypted = await encryptBatch([makeTx()], deviceKey);
    capturedOnSyncComplete!({
      account_token_ref: 'ref-3',
      transaction_count: 1,
      cursor: '',
      encrypted_batch: encrypted,
    });

    await waitFor(() => {
      expect(mockAckSync).toHaveBeenCalledOnce();
      expect(mockAckSync).toHaveBeenCalledWith('ref-3');
    });
  });

  it('ackSyncRef uses the latest ackSync even when a stale onSyncComplete closure fires', async () => {
    // Simulate two distinct ackSync identities across renders.
    // The stale closure captured from the first render must still call the
    // ackSync that was current at processing time (ackSync_v2), not the one
    // that was current when the closure was created (ackSync_v1).
    const ackSync_v1 = vi.fn();
    const ackSync_v2 = vi.fn();
    let callCount = 0;

    vi.mocked(useFinanceSocket).mockImplementation((opts) => {
      capturedOnSyncComplete = opts.onSyncComplete;
      callCount++;
      const ackFn = callCount <= 1 ? ackSync_v1 : ackSync_v2;
      return {
        ackSync: ackFn as unknown as (accountTokenRef: string) => void,
        isConnected: false,
        deviceKey: null,
        registerAlertToken: vi.fn() as unknown as (ruleTokenRef: string) => void,
        deregisterAlertToken: vi.fn() as unknown as (ruleTokenRef: string) => void,
      };
    });

    const { rerender } = render(<SyncHandler db={client} />);

    // Save the onSyncComplete from the FIRST render — it's the stale closure
    const staleSyncComplete = capturedOnSyncComplete!;

    // Re-render (simulating a token change) → ackSync_v2 assigned to ackSyncRef
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useAuthStore).mockImplementation((selector: any) => selector({ token: 'updated-token' }));
    rerender(<SyncHandler db={client} />);

    const encrypted = await encryptBatch([makeTx()], deviceKey);

    // Fire the STALE closure (from before the re-render)
    staleSyncComplete({
      account_token_ref: 'ref-4',
      transaction_count: 1,
      cursor: '',
      encrypted_batch: encrypted,
    });

    await waitFor(() => {
      expect(ackSync_v1).not.toHaveBeenCalled();
      expect(ackSync_v2).toHaveBeenCalledWith('ref-4');
    });
  });

  it('catches and logs errors from getDeviceKey without crashing', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(NativeSqliteDriver.getDeviceKey).mockRejectedValue(new Error('secure store locked'));

    render(<SyncHandler db={client} />);

    capturedOnSyncComplete!({
      account_token_ref: 'ref-5',
      transaction_count: 1,
      cursor: '',
      encrypted_batch: await encryptBatch([makeTx()], deviceKey),
    });

    await waitFor(() =>
      expect(consoleSpy).toHaveBeenCalledWith(
        '[DbProvider] sync batch failed:',
        expect.any(Error),
      )
    );

    const rows = await driver.query('SELECT id FROM transactions');
    expect(rows).toHaveLength(0);

    consoleSpy.mockRestore();
  });

  it('catches and logs decryption errors from processSyncBatch without crashing', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // getDeviceKey returns the WRONG key — decryption inside processSyncBatch will throw
    const wrongKey = await makeAesKey();
    vi.mocked(NativeSqliteDriver.getDeviceKey).mockResolvedValue(wrongKey);

    render(<SyncHandler db={client} />);

    const encrypted = await encryptBatch([makeTx()], deviceKey); // encrypted with deviceKey
    capturedOnSyncComplete!({
      account_token_ref: 'ref-6',
      transaction_count: 1,
      cursor: '',
      encrypted_batch: encrypted,
    });

    await waitFor(() =>
      expect(consoleSpy).toHaveBeenCalledWith(
        '[DbProvider] sync batch failed:',
        expect.any(Error),
      )
    );

    consoleSpy.mockRestore();
  });
});
