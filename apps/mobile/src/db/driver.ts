/**
 * React Native SQLite driver using op-sqlite with SQLCipher.
 *
 * op-sqlite (https://github.com/OP-Engineering/op-sqlite) ships SQLCipher
 * on both iOS and Android and is significantly faster than expo-sqlite
 * for large datasets (C++ JSI bindings, no bridge overhead).
 *
 * The encryption passphrase is derived from a key stored in expo-secure-store
 * (backed by iOS Keychain / Android Keystore).
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

export class NativeSqliteDriver implements SqliteDriver {
  private constructor(private readonly db: DB) {}

  static async create(): Promise<NativeSqliteDriver> {
    const passphrase = await getOrCreatePassphrase();

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
    return (result.rows?._array ?? []) as T[];
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
