/**
 * Web SQLite driver — OPFS-backed, AES-256-GCM encrypted.
 *
 * Storage strategy (per architecture diagram):
 *   - First load on a new device: pull full encrypted blob from user cloud storage,
 *     write to OPFS, open DB. (CloudSyncManager.hydrate() handles this.)
 *   - Subsequent loads: open from OPFS, pull deltas from cloud.
 *   - On writes: log to change_log, push deltas on a timer.
 *
 * Encryption: AES-256-GCM via SubtleCrypto. The key never leaves the device
 * (stored in localStorage, should be migrated to IndexedDB in production).
 * The same encrypted blob is safe to store in user-owned cloud storage.
 *
 * sql.js is loaded as a global script tag (sql-wasm-browser.js) to avoid
 * Vite ESM/WASM interop issues.
 */

import type { Database, SqlJsStatic } from 'sql.js';
import type { SqliteDriver, QueryResult, DbRow } from '@fresh/core/db';

declare global {
  function initSqlJs(config?: object): Promise<SqlJsStatic>;
}

export const OPFS_FILE_NAME = 'fresh.db';
const DB_KEY_STORAGE = 'fresh_db_key';

// ---------------------------------------------------------------------------
// Key management
// ---------------------------------------------------------------------------

export async function getOrCreateDbKey(): Promise<CryptoKey> {
  const stored = localStorage.getItem(DB_KEY_STORAGE);
  if (stored) {
    const raw = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
  }
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt', 'decrypt',
  ]);
  const raw = await crypto.subtle.exportKey('raw', key);
  localStorage.setItem(DB_KEY_STORAGE, btoa(String.fromCharCode(...new Uint8Array(raw))));
  return key;
}

// ---------------------------------------------------------------------------
// Encrypt / decrypt
// ---------------------------------------------------------------------------

export async function encryptDb(data: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  const out = new Uint8Array(12 + encrypted.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(encrypted), 12);
  return out;
}

export async function decryptDb(data: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new Uint8Array(decrypted);
}

// ---------------------------------------------------------------------------
// OPFS helpers
// ---------------------------------------------------------------------------

export async function loadFromOpfs(key: CryptoKey): Promise<Uint8Array | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(OPFS_FILE_NAME);
    const file = await fileHandle.getFile();
    const encrypted = new Uint8Array(await file.arrayBuffer());
    if (encrypted.length === 0) return null;
    return decryptDb(encrypted, key);
  } catch {
    return null;
  }
}

export async function saveToOpfs(data: Uint8Array, key: CryptoKey): Promise<void> {
  const encrypted = await encryptDb(data, key);
  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(OPFS_FILE_NAME, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(encrypted);
  await writable.close();
}

/**
 * Write an externally-provided encrypted blob directly to OPFS.
 * Used when hydrating from cloud storage (the blob is already encrypted
 * with the same key).
 */
export async function writeEncryptedBlobToOpfs(encryptedBlob: ArrayBuffer): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(OPFS_FILE_NAME, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(encryptedBlob);
  await writable.close();
}

/**
 * Export the current DB as an encrypted blob suitable for cloud storage.
 */
export async function exportEncryptedBlob(db: Database, key: CryptoKey): Promise<ArrayBuffer> {
  const data = db.export();
  const encrypted = await encryptDb(data, key);
  return encrypted.buffer;
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export class WebSqliteDriver implements SqliteDriver {
  private db!: Database;
  key!: CryptoKey;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  static async create(): Promise<WebSqliteDriver> {
    const driver = new WebSqliteDriver();
    const SQL = await window.initSqlJs({ locateFile: (f: string) => `/sql-wasm/${f}` });

    driver.key = await getOrCreateDbKey();
    const existing = await loadFromOpfs(driver.key);
    driver.db = new SQL.Database(existing ?? undefined);

    return driver;
  }

  /** Re-initialize from an externally provided plaintext Uint8Array (post-cloud hydration). */
  async reinitializeFrom(plaintext: Uint8Array): Promise<void> {
    this.db.close();
    const SQL = await window.initSqlJs({ locateFile: (f: string) => `/sql-wasm/${f}` });
    this.db = new SQL.Database(plaintext);
    await saveToOpfs(plaintext, this.key);
  }

  /** Export the DB as an encrypted blob for cloud storage. */
  async exportEncrypted(): Promise<ArrayBuffer> {
    return exportEncryptedBlob(this.db, this.key);
  }

  async execute(sql: string, params: (string | number | null)[] = []): Promise<QueryResult> {
    const stmt = this.db.prepare(sql);
    stmt.run(params as any);
    const rowsAffected = this.db.getRowsModified();
    const lastInsertId = Number(
      this.db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] ?? 0
    );
    stmt.free();
    this.scheduleSave();
    return { rows: [], rowsAffected, lastInsertId };
  }

  async query<T = DbRow>(sql: string, params: (string | number | null)[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    stmt.bind(params as any);
    const rows: T[] = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject() as unknown as T);
    }
    stmt.free();
    return rows;
  }

  async transaction(fn: (tx: SqliteDriver) => Promise<void>): Promise<void> {
    this.db.run('BEGIN');
    try {
      await fn(this);
      this.db.run('COMMIT');
    } catch (err) {
      this.db.run('ROLLBACK');
      throw err;
    }
    this.scheduleSave();
  }

  async close(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    const data = this.db.export();
    await saveToOpfs(data, this.key);
    this.db.close();
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const data = this.db.export();
      saveToOpfs(data, this.key).catch(console.error);
      this.saveTimer = null;
    }, 500);
  }
}
