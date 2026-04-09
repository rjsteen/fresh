/**
 * React Native SQLite driver using op-sqlite with SQLCipher.
 *
 * op-sqlite (https://github.com/OP-Engineering/op-sqlite) ships SQLCipher
 * on both iOS and Android and is significantly faster than expo-sqlite
 * for large datasets (C++ JSI bindings, no bridge overhead).
 *
 * ## Key derivation & storage
 *
 * A 32-byte random passphrase is generated via `expo-crypto` on first run and
 * stored in the platform secure enclave via `expo-secure-store`:
 *   - iOS: Keychain (accessible only when device is unlocked, this device only)
 *   - Android: Android Keystore-backed EncryptedSharedPreferences
 *
 * The same 32 raw bytes are re-imported as an AES-256-GCM `CryptoKey` via
 * `getDeviceKey()` for decrypting transaction batches sent by the backend.
 * This means the device registers a single key with the backend — one key
 * protects both the on-disk DB and inbound sync batches.
 *
 * ## Encrypted-at-rest migration
 *
 * Older app versions used plain SQLite (no SQLCipher). On first run after
 * upgrade, `NativeSqliteDriver.create()` detects the unencrypted file and
 * re-encrypts it in place using SQLCipher's `ATTACH ... KEY / sqlcipher_export`
 * mechanism before opening the DB normally.
 *
 * Cloud sync:
 *   The DB file path is exposed so CloudSyncManager can read the raw bytes
 *   for full-file backup to user-owned cloud storage (Dropbox/iCloud/GDrive).
 */

import { open, type DB } from '@op-engineering/op-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system';
import type { SqliteDriver, QueryResult, DbRow } from '@fresh/core/db';

export const DB_NAME = 'fresh.db';
const KEY_STORE_KEY = 'fresh_sqlcipher_key';

async function getOrCreatePassphrase(): Promise<string> {
  const stored = await SecureStore.getItemAsync(KEY_STORE_KEY, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  if (stored) return stored;

  const randomBytes = await Crypto.getRandomBytesAsync(32);
  const passphrase = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  await SecureStore.setItemAsync(KEY_STORE_KEY, passphrase, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return passphrase;
}

// ---------------------------------------------------------------------------
// Plaintext-to-encrypted migration
// ---------------------------------------------------------------------------

/**
 * Returns true if the named DB file is an unencrypted SQLite database.
 * Opens without a key and runs a benign query; if it succeeds the file is
 * plaintext (SQLCipher would fail the query for an encrypted file opened
 * without the correct key).
 */
async function isPlaintextSqlite(dbName: string): Promise<boolean> {
  try {
    const testDb = open({ name: dbName });
    await testDb.execute('SELECT count(*) FROM sqlite_master');
    testDb.close();
    return true;
  } catch {
    return false;
  }
}

/**
 * expo-file-system returns `file://` URIs; SQLite ATTACH needs a POSIX path.
 */
function toFsPath(uri: string): string {
  return uri.startsWith('file://') ? uri.slice(7) : uri;
}

/**
 * Re-encrypt a plaintext SQLite DB in place using SQLCipher.
 *
 * Strategy: open the plain DB, ATTACH an empty encrypted sibling, use
 * `sqlcipher_export()` to copy all pages, DETACH, then atomically replace
 * the original file with the encrypted copy.
 */
async function migrateToEncrypted(dbName: string, passphrase: string): Promise<void> {
  const migrationName = `${dbName}.migrating`;
  const baseDir = toFsPath(FileSystem.documentDirectory!);
  const encryptedPath = `${baseDir}${migrationName}`;

  // ATTACH DATABASE does not support bind parameters for the path or key.
  // Validate both values are safe to interpolate before building the SQL.
  // passphrase is always 64 hex chars produced by getOrCreatePassphrase().
  if (!/^[0-9a-f]+$/i.test(passphrase)) {
    throw new Error('Passphrase contains unexpected characters');
  }
  // Escape any single quotes in the path (standard SQL literal escaping).
  const safePath = encryptedPath.replace(/'/g, "''");

  const originalUri = `${FileSystem.documentDirectory}${dbName}`;
  const encryptedUri = `${FileSystem.documentDirectory}${migrationName}`;

  const plainDb = open({ name: dbName });
  try {
    await plainDb.execute(
      `ATTACH DATABASE '${safePath}' AS encrypted KEY '${passphrase}'`,
    );
    await plainDb.execute("SELECT sqlcipher_export('encrypted')");
    await plainDb.execute('DETACH DATABASE encrypted');
  } finally {
    plainDb.close();
  }

  // Atomically replace the plaintext original with the encrypted copy.
  // On failure, clean up the partial migration file so the next launch
  // can retry cleanly.
  try {
    await FileSystem.moveAsync({ from: encryptedUri, to: originalUri });
  } catch (err) {
    await FileSystem.deleteAsync(encryptedUri, { idempotent: true }).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

export class NativeSqliteDriver implements SqliteDriver {
  private constructor(private readonly db: DB) {}

  static async create(): Promise<NativeSqliteDriver> {
    const passphrase = await getOrCreatePassphrase();

    // Migrate an unencrypted DB from a pre-SQLCipher app version.
    // A freshly installed app has no DB file so isPlaintextSqlite() returns
    // false immediately — this check is a no-op for new installs.
    if (await isPlaintextSqlite(DB_NAME)) {
      await migrateToEncrypted(DB_NAME, passphrase);
    }

    const db = open({
      name: DB_NAME,
      encryptionKey: passphrase,
    });

    await db.execute('PRAGMA journal_mode = WAL;');
    await db.execute('PRAGMA foreign_keys = ON;');

    return new NativeSqliteDriver(db);
  }

  /**
   * Full path to the DB file — used by cloud backup to read raw bytes.
   */
  static get dbPath(): string {
    return `${FileSystem.documentDirectory}${DB_NAME}`;
  }

  /**
   * Derive an AES-256-GCM CryptoKey from the stored SQLCipher passphrase.
   * The passphrase is 64 hex chars (32 raw bytes) — exactly the right size for
   * AES-256. Both the DB key and the batch decryption key share this material
   * so the device has a single key registered with the backend.
   *
   * Requires globalThis.crypto.subtle — available in Expo SDK 52+ via the
   * expo-crypto global polyfill.
   */
  static async getDeviceKey(): Promise<CryptoKey> {
    const passphrase = await SecureStore.getItemAsync(KEY_STORE_KEY, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    if (!passphrase) throw new Error('No device key in secure store');

    const raw = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      raw[i] = parseInt(passphrase.slice(i * 2, i * 2 + 2), 16);
    }

    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['decrypt']);
  }

  async execute(sql: string, params: (string | number | null)[] = []): Promise<QueryResult> {
    const result = await this.db.execute(sql, params);
    return {
      rows: [],
      rowsAffected: result.rowsAffected ?? 0,
      lastInsertId: result.insertId,
    };
  }

  async query<T = DbRow>(sql: string, params: (string | number | null)[] = []): Promise<T[]> {
    const result = await this.db.execute(sql, params);
    return (result.rows ?? []) as T[];
  }

  async transaction(fn: (tx: SqliteDriver) => Promise<void>): Promise<void> {
    await this.db.transaction(async () => {
      await fn(this);
    });
  }

  async close(): Promise<void> {
    this.db.close();
  }
}
