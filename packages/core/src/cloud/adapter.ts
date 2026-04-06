/**
 * CloudStorageAdapter — platform-agnostic interface for user-owned cloud storage.
 *
 * The encrypted SQLite file lives in the USER's own cloud account (Dropbox,
 * iCloud Drive, or Google Drive). Fresh servers never touch it. Each platform
 * provides a concrete implementation of this interface.
 *
 * Sync strategy:
 *   1. First hydration: pull the full encrypted blob, open DB from it.
 *   2. Subsequent loads: pull deltas since last cursor, apply to local DB.
 *   3. On writes: append to change_log, push deltas at configurable interval.
 *   4. Periodically (or on mobile background task): push full file as backup.
 */

export interface DbDelta {
  /** Logical clock / cursor from change_log.seq */
  cursor: string;
  /** ISO 8601 timestamp of the change */
  changed_at: string;
  /** Table the row belongs to */
  table_name: string;
  /** Row primary key */
  row_id: string;
  /** 'insert' | 'update' | 'delete' */
  operation: 'insert' | 'update' | 'delete';
  /** Full row as JSON (null for deletes) */
  payload: string | null;
}

export interface CloudStorageAdapter {
  /**
   * Pull the full encrypted SQLite blob.
   * Returns null if no backup exists yet.
   */
  pullFile(): Promise<ArrayBuffer | null>;

  /**
   * Push the full encrypted SQLite blob.
   * Called on initial backup and after significant schema changes.
   */
  pushFile(data: ArrayBuffer): Promise<void>;

  /**
   * Pull deltas written since the given cursor.
   * Returns an empty array if the remote is at the same cursor.
   */
  pullDeltas(sinceCursor: string): Promise<DbDelta[]>;

  /**
   * Push a batch of local deltas to cloud storage.
   */
  pushDeltas(deltas: DbDelta[]): Promise<void>;

  /**
   * Returns the cursor of the latest delta on the remote, or null if none.
   */
  getRemoteCursor(): Promise<string | null>;
}

/**
 * NoopCloudAdapter — used when the user has not connected cloud storage.
 * Reads/writes are silently dropped; the DB operates as a pure local store.
 */
export class NoopCloudAdapter implements CloudStorageAdapter {
  async pullFile(): Promise<ArrayBuffer | null> { return null; }
  async pushFile(_data: ArrayBuffer): Promise<void> {}
  async pullDeltas(_since: string): Promise<DbDelta[]> { return []; }
  async pushDeltas(_deltas: DbDelta[]): Promise<void> {}
  async getRemoteCursor(): Promise<string | null> { return null; }
}
