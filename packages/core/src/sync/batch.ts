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

import { upsertTransaction, categorizeTransaction } from '../db/queries';
import type { SqliteDriver } from '../db/client';
import type { Transaction } from '../db/schema';
import type { SyncCompletePayload } from '../channels/socket';
import type { TransactionCategorizer, AnomalyDetector } from '../ml/inference';

/**
 * Decrypt an AES-256-GCM encrypted batch of transactions.
 *
 * Wire format: first 12 bytes are the IV; the remainder is the GCM ciphertext.
 * The decrypted plaintext is a JSON-encoded `Transaction[]`.
 */
export async function decryptBatch(
  encryptedBatch: ArrayBuffer,
  deviceKey: CryptoKey
): Promise<Transaction[]> {
  const bytes = new Uint8Array(encryptedBatch);
  const iv = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    deviceKey,
    ciphertext
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as Transaction[];
}

export interface SyncBatchDeps {
  db: SqliteDriver;
  deviceKey: CryptoKey;
  /** Optional — skipped if not loaded */
  categorizer?: TransactionCategorizer;
  /** Optional — skipped if not loaded */
  anomalyDetector?: AnomalyDetector;
  ackSync: (accountTokenRef: string) => void;
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
  const { account_token_ref, encrypted_batch } = payload;
  const { db, deviceKey, categorizer, anomalyDetector, ackSync } = deps;

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

  const transactions = await decryptBatch(bytes.buffer, deviceKey);

  for (const tx of transactions) {
    const saved = await upsertTransaction(db, tx);

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
  }

  ackSync(account_token_ref);
}
