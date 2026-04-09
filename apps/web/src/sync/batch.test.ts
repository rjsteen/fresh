/**
 * Tests for the sync batch decryption and processing pipeline.
 *
 * Uses a real in-memory SQLite DB (via sql.js) and the Web Crypto API
 * available in jsdom. ML deps are injected as mocks to isolate the pipeline
 * from ONNX runtime setup.
 */

import { vi, expect, describe, it, beforeEach } from 'vitest';
import { decryptBatch, processSyncBatch } from '@fresh/core/sync';
import type { Transaction } from '@fresh/core/db';
import type { TransactionCategorizer, AnomalyDetector } from '@fresh/core/ml';
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

async function encryptTransactions(
  txs: Transaction[],
  key: CryptoKey
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(txs));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
  const out = new Uint8Array(12 + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertext), 12);
  // ArrayBuffer → base64
  return btoa(String.fromCharCode(...out));
}

const ACCOUNT_ID = 'acc-test-1';

function makeTx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'tx-1',
    account_id: ACCOUNT_ID,
    external_id: 'ext-1',
    amount: -42.5,
    currency: 'USD',
    description: 'Coffee Shop',
    merchant_name: 'Blue Bottle',
    category_id: null,
    category_source: null,
    ml_confidence: null,
    date: '2026-04-08',
    posted_at: null,
    pending: false,
    notes: null,
    tags: null,
    created_at: '2026-04-08T10:00:00',
    updated_at: '2026-04-08T10:00:00',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// decryptBatch
// ---------------------------------------------------------------------------

describe('decryptBatch', () => {
  it('round-trips transactions through AES-256-GCM', async () => {
    const key = await makeAesKey();
    const txs = [makeTx(), makeTx({ id: 'tx-2', external_id: 'ext-2', amount: -10 })];

    const base64 = await encryptTransactions(txs, key);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const result = await decryptBatch(bytes.buffer, key);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('tx-1');
    expect(result[1].amount).toBe(-10);
  });

  it('throws on wrong key', async () => {
    const key = await makeAesKey();
    const wrongKey = await makeAesKey();
    const base64 = await encryptTransactions([makeTx()], key);
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

  beforeEach(async () => {
    const { driver: d } = await makeTestDb();
    driver = d;
    key = await makeAesKey();

    // Insert the account the transactions belong to
    await driver.execute(
      `INSERT INTO accounts (id, name, institution, type, currency, current_balance, connection_type, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [ACCOUNT_ID, 'Test Bank', 'Test', 'checking', 'USD', 0, 'manual', 1]
    );

    // Insert categories referenced in tests
    await driver.execute(
      `INSERT INTO categories (id, name, is_system) VALUES (?, ?, ?)`,
      ['cat-food', 'Food & Drink', 1]
    );
    await driver.execute(
      `INSERT INTO categories (id, name, is_system) VALUES (?, ?, ?)`,
      ['cat-existing', 'Existing', 1]
    );
  });

  it('upserts transactions and calls ackSync', async () => {
    const ackSync = vi.fn();
    const base64 = await encryptTransactions([makeTx()], key);

    await processSyncBatch(
      { account_token_ref: 'ref-1', transaction_count: 1, cursor: '', encrypted_batch: base64 },
      { db: driver, deviceKey: key, ackSync }
    );

    const rows = await driver.query<{ id: string }>('SELECT id FROM transactions');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('tx-1');
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

  it('calls categorizer for uncategorized transactions and writes result back', async () => {
    const ackSync = vi.fn();
    const categorize = vi.fn().mockResolvedValue({
      categoryId: 'cat-food',
      confidence: 0.92,
      topK: [{ categoryId: 'cat-food', score: 0.92 }],
    });

    const categorizer = {
      isLoaded: true,
      categorize,
    } as unknown as TransactionCategorizer;

    const base64 = await encryptTransactions([makeTx()], key);

    await processSyncBatch(
      { account_token_ref: 'ref-3', transaction_count: 1, cursor: '', encrypted_batch: base64 },
      { db: driver, deviceKey: key, categorizer, ackSync }
    );

    expect(categorize).toHaveBeenCalledOnce();
    expect(categorize).toHaveBeenCalledWith('Coffee Shop', 'Blue Bottle', -42.5, '2026-04-08');

    const rows = await driver.query<{ category_id: string; ml_confidence: number }>(
      'SELECT category_id, ml_confidence FROM transactions WHERE id = ?',
      ['tx-1']
    );
    expect(rows[0].category_id).toBe('cat-food');
    expect(rows[0].ml_confidence).toBeCloseTo(0.92);
    expect(ackSync).toHaveBeenCalledWith('ref-3');
  });

  it('skips categorizer for transactions that already have a category', async () => {
    const ackSync = vi.fn();
    const categorize = vi.fn();
    const categorizer = { isLoaded: true, categorize } as unknown as TransactionCategorizer;

    const alreadyCategorized = makeTx({ category_id: 'cat-existing', category_source: 'user' });
    const base64 = await encryptTransactions([alreadyCategorized], key);

    await processSyncBatch(
      { account_token_ref: 'ref-4', transaction_count: 1, cursor: '', encrypted_batch: base64 },
      { db: driver, deviceKey: key, categorizer, ackSync }
    );

    expect(categorize).not.toHaveBeenCalled();
    expect(ackSync).toHaveBeenCalledWith('ref-4');
  });

  it('calls anomaly detector for every transaction', async () => {
    const ackSync = vi.fn();
    const score = vi.fn().mockResolvedValue({ score: 0.1, isAnomaly: false, type: null });
    const anomalyDetector = { isLoaded: true, score } as unknown as AnomalyDetector;

    const txs = [makeTx(), makeTx({ id: 'tx-2', external_id: 'ext-2' })];
    const base64 = await encryptTransactions(txs, key);

    await processSyncBatch(
      { account_token_ref: 'ref-5', transaction_count: 2, cursor: '', encrypted_batch: base64 },
      { db: driver, deviceKey: key, anomalyDetector, ackSync }
    );

    expect(score).toHaveBeenCalledTimes(2);
    expect(ackSync).toHaveBeenCalledWith('ref-5');
  });

  it('still acks after a categorizer error', async () => {
    const ackSync = vi.fn();
    const categorize = vi.fn().mockRejectedValue(new Error('model exploded'));
    const categorizer = { isLoaded: true, categorize } as unknown as TransactionCategorizer;

    const base64 = await encryptTransactions([makeTx()], key);

    await processSyncBatch(
      { account_token_ref: 'ref-6', transaction_count: 1, cursor: '', encrypted_batch: base64 },
      { db: driver, deviceKey: key, categorizer, ackSync }
    );

    // Transaction was still written
    const rows = await driver.query('SELECT id FROM transactions');
    expect(rows).toHaveLength(1);
    // Ack was still sent
    expect(ackSync).toHaveBeenCalledWith('ref-6');
  });
});
