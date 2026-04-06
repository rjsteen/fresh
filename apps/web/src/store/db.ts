/**
 * DB + cloud sync singleton for the web app.
 *
 * Startup sequence:
 *   1. Open (or create) the OPFS-backed encrypted SQLite DB.
 *   2. Run migrations.
 *   3. Attempt cloud hydration via CloudSyncManager:
 *      - If a full file exists in cloud and local DB is empty → pull & reinitialize.
 *      - Otherwise → pull and apply deltas.
 *   4. Start periodic delta push (every 30s).
 */

import { DbClient } from '@fresh/core/db';
import { CloudSyncManager, NoopCloudAdapter } from '@fresh/core/cloud';
import type { CloudStorageAdapter } from '@fresh/core/cloud';
import { WebSqliteDriver } from '../db/driver';

let dbClientSingleton: DbClient | null = null;
let syncManagerSingleton: CloudSyncManager | null = null;

export async function initDb(
  cloudAdapter: CloudStorageAdapter = new NoopCloudAdapter(),
): Promise<DbClient> {
  if (dbClientSingleton) return dbClientSingleton;

  const driver = await WebSqliteDriver.create();
  const client = new DbClient(driver);

  // Attempt cloud hydration before running migrations so that a freshly
  // pulled full file already has the correct schema.
  const sync = new CloudSyncManager(driver, cloudAdapter);
  const status = await sync.hydrate();

  if (status === 'hydrated') {
    // Full file was pulled — reinitialize driver from the decrypted blob.
    // The cloud blob is plaintext after decryption; driver handles re-open.
    const blob = await cloudAdapter.pullFile();
    if (blob) {
      const plaintext = new Uint8Array(blob);
      await driver.reinitializeFrom(plaintext);
    }
  }

  await client.runMigrations();

  sync.startDeltaPush(30_000);
  syncManagerSingleton = sync;
  dbClientSingleton = client;
  return client;
}

export function getDb(): DbClient {
  if (!dbClientSingleton) throw new Error('DB not initialized — call initDb() first');
  return dbClientSingleton;
}

export function getSyncManager(): CloudSyncManager | null {
  return syncManagerSingleton;
}
