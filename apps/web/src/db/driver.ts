/**
 * Web SQLite driver using sql.js with SQLCipher-compatible encryption.
 *
 * In the browser we use sql.js (SQLite compiled to WASM).
 * For production, swap to @sqlitecloud/drivers or use the OPFS-backed
 * variant for persistence across page reloads.
 *
 * Note: True SQLCipher encryption requires the sqlcipher WASM build.
 * Use: https://github.com/wa-sqlite/wa-sqlite with the SQLCipher extension,
 * or store the DB file encrypted via SubtleCrypto before persisting to OPFS.
 */

import initSqlJs, { type Database } from 'sql.js';
import type { SqliteDriver, QueryResult, DbRow } from '@fresh/core/db';

const OPFS_FILE_NAME = 'fresh.db';
const DB_KEY_STORAGE = 'pf_db_key';

export async function getOrCreateDbKey(): Promise<CryptoKey> {
  const stored = localStorage.getItem(DB_KEY_STORAGE);
  if (stored) {
    const raw = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  }

  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ]);
  const raw = await crypto.subtle.exportKey('raw', key);
  localStorage.setItem(DB_KEY_STORAGE, btoa(String.fromCharCode(...new Uint8Array(raw))));
  return key;
}

async function encryptDb(data: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  const result = new Uint8Array(12 + encrypted.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(encrypted), 12);
  return result;
}

async function decryptDb(data: Uint8Array, key: CryptoKey): Promise<Uint8Array> {
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new Uint8Array(decrypted);
}

async function loadFromOpfs(key: CryptoKey): Promise<Uint8Array | null> {
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

async function saveToOpfs(db: Database, key: CryptoKey): Promise<void> {
  const data = db.export();
  const encrypted = await encryptDb(data, key);
  const root = await navigator.storage.getDirectory();
  const fileHandle = await root.getFileHandle(OPFS_FILE_NAME, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(encrypted);
  await writable.close();
}

export class WebSqliteDriver implements SqliteDriver {
  private db!: Database;
  private key!: CryptoKey;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  static async create(): Promise<WebSqliteDriver> {
    const driver = new WebSqliteDriver();
    const SQL = await initSqlJs({
      locateFile: (file) => `/sql-wasm/${file}`,
    });

    driver.key = await getOrCreateDbKey();
    const existing = await loadFromOpfs(driver.key);
    driver.db = new SQL.Database(existing ?? undefined);

    return driver;
  }

  async execute(sql: string, params: (string | number | null)[] = []): Promise<QueryResult> {
    const stmt = this.db.prepare(sql);
    stmt.run(params as any);
    const rowsAffected = this.db.getRowsModified();
    const lastInsertId = Number(this.db.exec('SELECT last_insert_rowid()')[0]?.values[0]?.[0] ?? 0);
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
    await saveToOpfs(this.db, this.key);
    this.db.close();
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    // Debounce saves — don't hit OPFS on every write
    this.saveTimer = setTimeout(() => {
      saveToOpfs(this.db, this.key).catch(console.error);
      this.saveTimer = null;
    }, 500);
  }
}
