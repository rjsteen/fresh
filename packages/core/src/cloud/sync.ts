/**
 * CloudSyncManager — orchestrates hydration and delta sync between
 * the local SQLite DB and the user's cloud storage.
 *
 * Usage:
 *   const sync = new CloudSyncManager(driver, adapter);
 *   await sync.hydrate();          // call once at startup
 *   sync.startDeltaPush(30_000);   // push deltas every 30s
 *   sync.stopDeltaPush();
 */

import type { SqliteDriver } from '../db/client';
import type { CloudStorageAdapter, DbDelta } from './adapter';

export type HydrateStatus =
  | 'no_cloud'        // no adapter / noop — local only
  | 'first_sync'      // no remote backup found, this is a new device
  | 'hydrated'        // loaded full file from cloud
  | 'delta_applied';  // applied deltas, no full pull needed

export class CloudSyncManager {
  private pushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly driver: SqliteDriver,
    private readonly adapter: CloudStorageAdapter,
  ) {}

  /**
   * Called at app startup.
   * - If the DB is empty (first load on a new device): pull full file from cloud.
   * - Otherwise: pull and apply deltas since the stored cursor.
   */
  async hydrate(): Promise<HydrateStatus> {
    const remoteCursor = await this.adapter.getRemoteCursor();
    if (remoteCursor === null) return 'no_cloud';

    const localCursor = await this.getLocalCursor();

    if (localCursor === null) {
      // No local data — pull full file (first hydration)
      const blob = await this.adapter.pullFile();
      if (!blob) return 'first_sync';

      // Caller is responsible for reinitializing the driver from this blob
      // (platform-specific: replace OPFS file, reopen DB handle)
      await this.driver.execute(
        "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('cloud_cursor', ?)",
        [remoteCursor],
      );
      return 'hydrated';
    }

    if (localCursor === remoteCursor) return 'delta_applied';

    // Pull and apply deltas
    const deltas = await this.adapter.pullDeltas(localCursor);
    if (deltas.length > 0) {
      await this.applyDeltas(deltas);
      const newCursor = deltas[deltas.length - 1].cursor;
      await this.driver.execute(
        "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('cloud_cursor', ?)",
        [newCursor],
      );
    }

    return 'delta_applied';
  }

  /**
   * Push any unpushed change_log entries as deltas to cloud storage.
   */
  async pushPendingDeltas(): Promise<void> {
    const rows = await this.driver.query<DbDelta>(
      `SELECT seq AS cursor, changed_at, table_name, row_id, operation, payload
       FROM change_log WHERE pushed = 0 ORDER BY seq ASC LIMIT 200`
    );

    if (rows.length === 0) return;

    await this.adapter.pushDeltas(rows);

    const maxSeq = rows[rows.length - 1].cursor;
    await this.driver.execute(
      'UPDATE change_log SET pushed = 1 WHERE seq <= ?',
      [maxSeq],
    );

    await this.driver.execute(
      "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('cloud_cursor', ?)",
      [maxSeq],
    );
  }

  /** Push full encrypted file to cloud (call after initial setup or schema migration). */
  async pushFullFile(encryptedBlob: ArrayBuffer): Promise<void> {
    await this.adapter.pushFile(encryptedBlob);
  }

  /** Start pushing deltas on a timer (interval in ms). */
  startDeltaPush(intervalMs = 30_000): void {
    if (this.pushTimer) return;
    this.pushTimer = setInterval(() => {
      this.pushPendingDeltas().catch(console.error);
    }, intervalMs);
  }

  stopDeltaPush(): void {
    if (this.pushTimer) {
      clearInterval(this.pushTimer);
      this.pushTimer = null;
    }
  }

  private async getLocalCursor(): Promise<string | null> {
    const rows = await this.driver.query<{ value: string }>(
      "SELECT value FROM sync_meta WHERE key = 'cloud_cursor'"
    );
    return rows[0]?.value ?? null;
  }

  private async applyDeltas(deltas: DbDelta[]): Promise<void> {
    await this.driver.transaction(async (tx) => {
      for (const delta of deltas) {
        if (delta.operation === 'delete') {
          await tx.execute(
            `DELETE FROM ${delta.table_name} WHERE id = ?`,
            [delta.row_id],
          );
        } else if (delta.payload) {
          const row = JSON.parse(delta.payload) as Record<string, unknown>;
          const cols = Object.keys(row);
          const placeholders = cols.map(() => '?').join(', ');
          const updates = cols.map((c) => `${c} = excluded.${c}`).join(', ');
          await tx.execute(
            `INSERT INTO ${delta.table_name} (${cols.join(', ')})
             VALUES (${placeholders})
             ON CONFLICT(id) DO UPDATE SET ${updates}`,
            cols.map((c) => row[c] as string | number | null),
          );
        }
      }
    });
  }
}
