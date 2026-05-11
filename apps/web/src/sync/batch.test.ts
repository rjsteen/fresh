/**
 * Tests for the sync batch decryption and processing pipeline.
 *
 * Uses a real in-memory SQLite DB (via sql.js) and the Web Crypto API
 * available in jsdom. Categorization is rule-based and runs against the
 * real DB — no mocks needed for the categorizer.
 */

import { vi, expect, describe, it, beforeEach } from 'vitest';
import { decryptBatch, processSyncBatch } from '@fresh/core/sync';
import type { WireTransaction, SyncedAccount } from '@fresh/core/sync';
import { makeTestDb } from '../test/makeTestDb';
import type { SqliteDriver } from '@fresh/core/db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function makeAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
}

async function encryptData(data: unknown, key: CryptoKey): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(data));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  const out = new Uint8Array(12 + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertext), 12);
  return btoa(String.fromCharCode(...out));
}

const ACCOUNT_EXTERNAL_ID = 'ext-acct-1';

function makeWireTx(overrides: Partial<WireTransaction> = {}): WireTransaction {
  return {
    account_external_id: ACCOUNT_EXTERNAL_ID,
    external_id: 'ext-1',
    amount: -42.5,
    currency: 'USD',
    description: 'Coffee Shop',
    merchant_name: 'Blue Bottle',
    date: '2026-04-08',
    posted_at: null,
    pending: false,
    ...overrides,
  };
}

function makeWireAccount(overrides: Partial<SyncedAccount> = {}): SyncedAccount {
  return {
    external_id: ACCOUNT_EXTERNAL_ID,
    name: 'Test Bank',
    institution: 'Test Institution',
    currency: 'USD',
    balance: 100,
    available_balance: null,
    type: 'checking',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// decryptBatch
// ---------------------------------------------------------------------------

describe('decryptBatch', () => {
  it('round-trips transactions through AES-256-GCM', async () => {
    const key = await makeAesKey();
    const txs = [makeWireTx(), makeWireTx({ external_id: 'ext-2', amount: -10 })];

    const base64 = await encryptData(txs, key);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const result = await decryptBatch(bytes.buffer, key);

    expect(result).toHaveLength(2);
    expect(result[0].external_id).toBe('ext-1');
    expect(result[1].amount).toBe(-10);
  });

  it('throws on wrong key', async () => {
    const key = await makeAesKey();
    const wrongKey = await makeAesKey();
    const base64 = await encryptData([makeWireTx()], key);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    await expect(decryptBatch(bytes.buffer, wrongKey)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// processSyncBatch
// ---------------------------------------------------------------------------

describe('processSyncBatch', () => {
  let driver: SqliteDriver;
  let key: CryptoKey;
  let encrypted_accounts: string;

  beforeEach(async () => {
    const { driver: d } = await makeTestDb();
    driver = d;
    key = await makeAesKey();
    encrypted_accounts = await encryptData([makeWireAccount()], key);

    await driver.execute(
      `INSERT INTO categories (id, name, is_system) VALUES (?, ?, ?)`,
      ['cat-food', 'Food & Drink', 1]
    );
    await driver.execute(
      `INSERT INTO categories (id, name, is_system) VALUES (?, ?, ?)`,
      ['cat-coffee', 'Coffee', 1]
    );
  });

  it('upserts transactions and calls ackSync', async () => {
    const ackSync = vi.fn();
    const encrypted_batch = await encryptData([makeWireTx()], key);

    await processSyncBatch(
      { account_token_ref: 'ref-1', transaction_count: 1, cursor: '', encrypted_batch, encrypted_accounts },
      { db: driver, deviceKey: key, ackSync }
    );

    const rows = await driver.query<{ external_id: string }>('SELECT external_id FROM transactions');
    expect(rows).toHaveLength(1);
    expect(rows[0].external_id).toBe('ext-1');
    expect(ackSync).toHaveBeenCalledOnce();
    expect(ackSync).toHaveBeenCalledWith('ref-1');
  });

  it('acks immediately when encrypted_batch is absent', async () => {
    const ackSync = vi.fn();

    await processSyncBatch(
      { account_token_ref: 'ref-2', transaction_count: 0, cursor: '' },
      { db: driver, deviceKey: key, ackSync }
    );

    const rows = await driver.query('SELECT id FROM transactions');
    expect(rows).toHaveLength(0);
    expect(ackSync).toHaveBeenCalledWith('ref-2');
  });

  it('applies a matching categorization rule and writes category back', async () => {
    const ackSync = vi.fn();

    await driver.execute(
      `INSERT INTO categorization_rules (id, priority, conditions, category_id, is_auto)
       VALUES (?, ?, ?, ?, ?)`,
      ['rule-1', 10, JSON.stringify([{ field: 'payee', op: 'equals', value: 'blue bottle' }]), 'cat-coffee', 0]
    );

    const encrypted_batch = await encryptData([makeWireTx()], key);

    await processSyncBatch(
      { account_token_ref: 'ref-3', transaction_count: 1, cursor: '', encrypted_batch, encrypted_accounts },
      { db: driver, deviceKey: key, ackSync }
    );

    const rows = await driver.query<{ category_id: string; category_source: string }>(
      'SELECT category_id, category_source FROM transactions WHERE external_id = ?',
      ['ext-1']
    );
    expect(rows[0].category_id).toBe('cat-coffee');
    expect(rows[0].category_source).toBe('rule');
    expect(ackSync).toHaveBeenCalledWith('ref-3');
  });

  it('skips categorization when no rules exist', async () => {
    const ackSync = vi.fn();
    const encrypted_batch = await encryptData([makeWireTx()], key);

    await processSyncBatch(
      { account_token_ref: 'ref-4', transaction_count: 1, cursor: '', encrypted_batch, encrypted_accounts },
      { db: driver, deviceKey: key, ackSync }
    );

    const rows = await driver.query<{ category_id: string | null }>(
      'SELECT category_id FROM transactions WHERE external_id = ?',
      ['ext-1']
    );
    expect(rows[0].category_id).toBeNull();
    expect(ackSync).toHaveBeenCalledWith('ref-4');
  });

  it('skips categorization for transactions that already have a category', async () => {
    const ackSync = vi.fn();

    await driver.execute(
      `INSERT INTO categorization_rules (id, priority, conditions, category_id, is_auto)
       VALUES (?, ?, ?, ?, ?)`,
      ['rule-2', 10, JSON.stringify([{ field: 'payee', op: 'contains', value: 'blue bottle' }]), 'cat-food', 0]
    );

    // First sync — gets categorized
    const encrypted_batch = await encryptData([makeWireTx()], key);
    await processSyncBatch(
      { account_token_ref: 'ref-5a', transaction_count: 1, cursor: '', encrypted_batch, encrypted_accounts },
      { db: driver, deviceKey: key, ackSync }
    );

    // Manually override to a different category
    await driver.execute(
      `UPDATE transactions SET category_id = 'cat-coffee', category_source = 'user' WHERE external_id = ?`,
      ['ext-1']
    );

    // Second sync — same external_id; upsert should not overwrite the user category
    const encrypted_batch2 = await encryptData([makeWireTx({ amount: -43 })], key);
    await processSyncBatch(
      { account_token_ref: 'ref-5b', transaction_count: 1, cursor: '', encrypted_batch: encrypted_batch2, encrypted_accounts },
      { db: driver, deviceKey: key, ackSync }
    );

    const rows = await driver.query<{ category_id: string; category_source: string }>(
      'SELECT category_id, category_source FROM transactions WHERE external_id = ?',
      ['ext-1']
    );
    expect(rows[0].category_id).toBe('cat-coffee');
    expect(rows[0].category_source).toBe('user');
  });

  it('still acks after a categorizer error', async () => {
    const ackSync = vi.fn();

    // Insert a rule with an invalid regex that will throw during eval
    await driver.execute(
      `INSERT INTO categorization_rules (id, priority, conditions, category_id, is_auto)
       VALUES (?, ?, ?, ?, ?)`,
      ['rule-bad', 10, JSON.stringify([{ field: 'payee', op: 'regex', value: '(?invalid' }]), 'cat-food', 0]
    );

    const encrypted_batch = await encryptData([makeWireTx()], key);

    await processSyncBatch(
      { account_token_ref: 'ref-6', transaction_count: 1, cursor: '', encrypted_batch, encrypted_accounts },
      { db: driver, deviceKey: key, ackSync }
    );

    const rows = await driver.query('SELECT id FROM transactions');
    expect(rows).toHaveLength(1);
    expect(ackSync).toHaveBeenCalledWith('ref-6');
  });
});
