/**
 * Batch decryption and sync-complete pipeline.
 *
 * Called when the device receives `sync:complete` from the Phoenix channel.
 * Decrypts the transaction batch with the device's local AES-256-GCM key,
 * upserts each transaction into the on-device SQLite DB, runs ONNX inference,
 * and acknowledges the server.
 *
 * PRIVACY CONTRACT: The server encrypts the batch with the device's registered
 * key before including it in the signal payload. Financial data is never stored
 * or processed in plaintext on the backend.
 */

import { upsertTransaction, upsertAccount, categorizeTransaction, hasAlertFired, recordAlertFired, getMissedRecurringCharges } from '../db/queries';
import type { SqliteDriver } from '../db/client';
import type { RecurringPattern } from '../db/schema';

export interface SyncedAccount {
  external_id: string;
  name: string;
  institution: string;
  currency: string;
  balance: number;
  available_balance: number | null;
  type: string;
}

// Wire format from the backend — uses account_external_id (bank's ID) instead of
// the local SQLite account_id. Resolved to account_id before DB insert.
export interface WireTransaction {
  account_external_id: string;
  external_id: string | null;
  amount: number;
  currency: string;
  description: string;
  merchant_name: string | null;
  date: string;
  posted_at: string | null;
  pending: boolean;
}

import type { SyncCompletePayload } from '../channels/socket';
import type { TransactionCategorizer, AnomalyDetector } from '../ml/inference';
import { ruleEngine } from '../budget/rules';
import { detectRecurringPatterns } from '../budget/recurring';

/**
 * Decrypt an AES-256-GCM encrypted batch of transactions.
 *
 * Wire format: first 12 bytes are the IV; the remainder is the GCM ciphertext.
 * The decrypted plaintext is a JSON-encoded `Transaction[]`.
 */
export async function decryptBatch(
  encryptedBatch: ArrayBuffer,
  deviceKey: CryptoKey
): Promise<WireTransaction[]> {
  const bytes = new Uint8Array(encryptedBatch);
  const iv = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    deviceKey,
    ciphertext
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as WireTransaction[];
}

export interface SyncBatchDeps {
  db: SqliteDriver;
  deviceKey: CryptoKey;
  /** Optional — skipped if not loaded */
  categorizer?: TransactionCategorizer;
  /** Optional — skipped if not loaded */
  anomalyDetector?: AnomalyDetector;
  ackSync: (accountTokenRef: string) => void;
  /** Optional — called with the rule's backend_token_ref when a rule fires */
  notifyAlertFired?: (tokenRef: string) => void;
  /** Optional — called for each recurring charge that was expected but not found */
  onMissedCharge?: (pattern: RecurringPattern) => void;
}

/**
 * Full sync-complete pipeline:
 *   1. Base64-decode and AES-256-GCM decrypt the encrypted batch
 *   2. Upsert each transaction into the local DB
 *   3. Run ONNX categorizer on uncategorized transactions; write result back
 *   4. Run ONNX anomaly detector on each transaction
 *   5. Send `sync:ack` to the backend
 *
 * Errors in ML inference are logged and skipped so a bad model never prevents
 * transactions from being saved or the ack from being sent.
 */
export async function processSyncBatch(
  payload: SyncCompletePayload,
  deps: SyncBatchDeps
): Promise<void> {
  const { account_token_ref, encrypted_batch, encrypted_accounts } = payload;
  const { db, deviceKey, categorizer, anomalyDetector, ackSync, notifyAlertFired, onMissedCharge } = deps;

  if (!encrypted_batch && !encrypted_accounts) {
    ackSync(account_token_ref);
    return;
  }

  // Upsert accounts first so transactions can reference them by account_id.
  // Build a map of external_id → local SQLite id for transaction resolution.
  const accountIdByExternalId = new Map<string, string>();

  if (encrypted_accounts) {
    const accountBytes = Uint8Array.from(atob(encrypted_accounts), c => c.charCodeAt(0));
    const accountIv = accountBytes.slice(0, 12);
    const accountCiphertext = accountBytes.slice(12);
    const accountPlaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: accountIv },
      deviceKey,
      accountCiphertext
    );
    const accounts = JSON.parse(new TextDecoder().decode(accountPlaintext)) as SyncedAccount[];
    for (const account of accounts) {
      console.log('[Sync] upserting account', JSON.stringify(account));
      const upserted = await upsertAccount(db, {
        name: account.name,
        institution: account.institution,
        type: account.type as 'checking' | 'savings' | 'credit' | 'investment' | 'cash',
        currency: account.currency,
        current_balance: account.balance,
        available_balance: account.available_balance,
        last_synced_at: new Date().toISOString(),
        connection_type: 'simplefin',
        sync_token_ref: account_token_ref,
        external_id: account.external_id,
        is_active: true,
      });
      accountIdByExternalId.set(account.external_id, upserted.id);
    }
  }

  if (!encrypted_batch) {
    ackSync(account_token_ref);
    return;
  }

  // base64 → ArrayBuffer
  const binary = atob(encrypted_batch);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  const wireTransactions = await decryptBatch(bytes.buffer, deviceKey);

  for (const tx of wireTransactions) {
    const account_id = accountIdByExternalId.get(tx.account_external_id);
    if (!account_id) {
      console.warn('[processSyncBatch] no local account for external_id', tx.account_external_id);
      continue;
    }
    console.log('[Sync] upserting tx', JSON.stringify({ account_id, ...tx }));
    const saved = await upsertTransaction(db, {
      account_id,
      external_id: tx.external_id,
      amount: tx.amount,
      currency: tx.currency,
      description: tx.description ?? '',
      merchant_name: tx.merchant_name ?? null,
      date: tx.date != null ? String(tx.date) : '',
      posted_at: tx.posted_at != null ? String(tx.posted_at) : null,
      pending: tx.pending ?? false,
      category_id: null,
      category_source: null,
      ml_confidence: null,
      notes: null,
      tags: null,
    });

    if (categorizer?.isLoaded && !saved.category_id) {
      try {
        const result = await categorizer.categorize(
          saved.description,
          saved.merchant_name,
          saved.amount,
          saved.date
        );
        await categorizeTransaction(db, saved.id, result.categoryId, 'ml', result.confidence);
      } catch (err) {
        console.warn('[processSyncBatch] categorizer failed for tx', saved.id, err);
      }
    }

    if (anomalyDetector?.isLoaded) {
      try {
        await anomalyDetector.score(
          saved.description,
          saved.merchant_name,
          saved.amount,
          saved.date
        );
      } catch (err) {
        console.warn('[processSyncBatch] anomaly detector failed for tx', saved.id, err);
      }
    }

    // Evaluate transaction-scoped alert rules (large_transaction, merchant only)
    try {
      const fired = await ruleEngine.evaluateForTransaction(db, saved);
      for (const event of fired) {
        const txId = event.transaction?.id ?? null;
        if (await hasAlertFired(db, event.rule.id, txId)) continue;
        await recordAlertFired(db, event.rule.id, txId);
        if (event.rule.backend_token_ref && notifyAlertFired) {
          notifyAlertFired(event.rule.backend_token_ref);
        }
      }
    } catch (err) {
      console.warn('[processSyncBatch] rule engine failed for tx', saved.id, err);
    }
  }

  // Evaluate balance/budget rules once after the full batch is settled
  try {
    const fired = await ruleEngine.evaluateBalanceRules(db);
    for (const event of fired) {
      if (await hasAlertFired(db, event.rule.id, null)) continue;
      await recordAlertFired(db, event.rule.id, null);
      if (event.rule.backend_token_ref && notifyAlertFired) {
        notifyAlertFired(event.rule.backend_token_ref);
      }
    }
  } catch (err) {
    console.warn('[processSyncBatch] balance rule evaluation failed', err);
  }

  // Detect recurring patterns and check for missed charges
  try {
    await detectRecurringPatterns(db);
    if (onMissedCharge) {
      const missed = await getMissedRecurringCharges(db);
      for (const pattern of missed) {
        onMissedCharge(pattern);
      }
    }
  } catch (err) {
    console.warn('[processSyncBatch] recurring pattern detection failed', err);
  }

  ackSync(account_token_ref);
}
