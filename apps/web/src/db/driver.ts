/**
 * Web SQLite driver — OPFS-backed, AES-256-GCM encrypted.
 *
 * Storage strategy (per architecture diagram):
 *   - First load on a new device: pull full encrypted blob from user cloud storage,
 *     write to OPFS, open DB. (CloudSyncManager.hydrate() handles this.)
 *   - Subsequent loads: open from OPFS, pull deltas from cloud.
 *   - On writes: log to change_log, push deltas on a timer.
 *
 * ## Key derivation & storage
 *
 * A 256-bit AES-GCM key is generated once per device via `crypto.subtle.generateKey`
 * and stored as a non-extractable `CryptoKey` object in IndexedDB (origin-scoped,
 * persistent across sessions). The key never leaves the device as raw bytes.
 *
 * On first run after upgrading from an older app version that stored the key as
 * raw base64 in `localStorage`, `getOrCreateDbKey` automatically migrates the key
 * into IDB and clears the old localStorage entry.
 *
 * ## Encrypted-at-rest migration
 *
 * Older app versions wrote a plaintext SQLite file to OPFS. On first open,
 * `loadFromOpfs` detects the SQLite magic header, re-encrypts the file in place,
 * and returns the plaintext bytes for this session.
 *
 * sql.js is loaded as a global script tag (sql-wasm-browser.js) to avoid
 * Vite ESM/WASM interop issues.
 */

import type { Database, SqlJsStatic } from 'sql.js';
import type { SqliteDriver, QueryResult, DbRow } from '@fresh/core/db';

// sql.js is loaded as a script tag; the global is already typed by @types/sql.js
// but we access it via window to make the runtime call explicit.
const _initSqlJs = () =>
  (window as unknown as { initSqlJs: (cfg?: object) => Promise<SqlJsStatic> }).initSqlJs;

export const OPFS_FILE_NAME = 'fresh.db';

// ---------------------------------------------------------------------------
// IDB key store
// ---------------------------------------------------------------------------

const IDB_NAME = 'fresh-keys';
const IDB_STORE = 'keys';
const IDB_KEY_NAME = 'db-key';
/** localStorage key used by pre-IDB versions — kept only for the migration path. */
const LEGACY_LS_KEY = 'fresh_db_key';

function openKeyStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function loadKeyFromIDB(): Promise<CryptoKey | null> {
  const idb = await openKeyStore();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(IDB_KEY_NAME);
    req.onsuccess = () => { resolve((req.result as CryptoKey | undefined) ?? null); idb.close(); };
    req.onerror = () => { reject(req.error); idb.close(); };
  });
}

async function storeKeyInIDB(key: CryptoKey): Promise<void> {
  const idb = await openKeyStore();
  return new Promise((resolve, reject) => {
    const tx = idb.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).put(key, IDB_KEY_NAME);
    req.onsuccess = () => { resolve(); idb.close(); };
    req.onerror = () => { reject(req.error); idb.close(); };
  });
}

// ---------------------------------------------------------------------------
// Key management
// ---------------------------------------------------------------------------

/**
 * Returns the AES-256-GCM device key, creating it on first run.
 *
 * Resolution order:
 *   1. IDB (non-extractable CryptoKey object — preferred)
 *   2. Legacy localStorage migration (old app versions stored raw key bytes)
 *   3. Generate a fresh non-extractable key and persist it to IDB
 */
export async function getOrCreateDbKey(): Promise<CryptoKey> {
  const idbKey = await loadKeyFromIDB();
  if (idbKey) return idbKey;

  // Migrate from legacy localStorage: re-import raw bytes as non-extractable
  // so they no longer live in JS-readable storage.
  const stored = localStorage.getItem(LEGACY_LS_KEY);
  if (stored) {
    const raw = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, [
      'encrypt',
      'decrypt',
    ]);
    await storeKeyInIDB(key);
    localStorage.removeItem(LEGACY_LS_KEY);
    return key;
  }

  // First time on this device — generate a fresh non-extractable key.
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false, // non-extractable: JS cannot call exportKey on this handle
    ['encrypt', 'decrypt'],
  );
  await storeKeyInIDB(key);
  return key;
}

// ---------------------------------------------------------------------------
// Encrypt / decrypt
// ---------------------------------------------------------------------------

export async function encryptDb(data: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data as unknown as ArrayBuffer);
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
// Plaintext SQLite detection
// ---------------------------------------------------------------------------

/**
 * "SQLite format 3\0" — the magic bytes at the start of every SQLite 3 file.
 * Used to detect an unencrypted DB file that needs to be migrated.
 */
// prettier-ignore
const SQLITE_MAGIC = new Uint8Array([
  0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66,
  0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00,
]);

export function isSqliteMagic(data: Uint8Array): boolean {
  if (data.length < 16) return false;
  return SQLITE_MAGIC.every((b, i) => b === data[i]);
}

// ---------------------------------------------------------------------------
// OPFS helpers
// ---------------------------------------------------------------------------

export async function loadFromOpfs(key: CryptoKey): Promise<Uint8Array | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(OPFS_FILE_NAME);
    const file = await fileHandle.getFile();
    const data = new Uint8Array(await file.arrayBuffer());
    if (data.length === 0) return null;

    // Migrate: file is plaintext SQLite from a pre-encryption app version.
    // Re-encrypt in place so future loads go through the normal path.
    if (isSqliteMagic(data)) {
      await saveToOpfs(data, key);
      return data;
    }

    return await decryptDb(data, key);
  } catch {
    return null;
  }
}

export async function saveToOpfs(data: Uint8Array, key: CryptoKey): Promise<void> {
  const encrypted = await encryptDb(data, key);
  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(OPFS_FILE_NAME, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(encrypted as unknown as ArrayBuffer);
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
  return encrypted.buffer as ArrayBuffer;
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
    const SQL = await _initSqlJs()({ locateFile: (f: string) => `/sql-wasm/${f}` });

    driver.key = await getOrCreateDbKey();
    const existing = await loadFromOpfs(driver.key);
    driver.db = new SQL.Database(existing ?? undefined);
    // Enable FK enforcement so ON DELETE CASCADE / ON DELETE RESTRICT fire correctly
    driver.db.run('PRAGMA foreign_keys = ON');

    return driver;
  }

  /** Re-initialize from an externally provided plaintext Uint8Array (post-cloud hydration). */
  async reinitializeFrom(plaintext: Uint8Array): Promise<void> {
    this.db.close();
    const SQL = await _initSqlJs()({ locateFile: (f: string) => `/sql-wasm/${f}` });
    this.db = new SQL.Database(plaintext);
    await saveToOpfs(plaintext, this.key);
  }

  /** Export the DB as an encrypted blob for cloud storage. */
  async exportEncrypted(): Promise<ArrayBuffer> {
    return exportEncryptedBlob(this.db, this.key);
  }

  async execute(sql: string, params: (string | number | null)[] = []): Promise<QueryResult> {
    const stmt = this.db.prepare(sql);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sql.js BindParams type doesn't accept (string|number|null)[]
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- sql.js BindParams type doesn't accept (string|number|null)[]
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
