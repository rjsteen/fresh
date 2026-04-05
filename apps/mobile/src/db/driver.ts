/**
 * React Native SQLite driver using expo-sqlite with SQLCipher.
 *
 * expo-sqlite v14+ ships SQLCipher by default on iOS and Android.
 * The encryption passphrase is derived from a key stored in expo-secure-store
 * (backed by iOS Keychain / Android Keystore).
 */

import * as SQLite from 'expo-sqlite';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import type { SqliteDriver, QueryResult, DbRow } from '@fresh/core/db';

const DB_NAME = 'fresh.db';
const KEY_STORE_KEY = 'pf_sqlcipher_key';

async function getOrCreatePassphrase(): Promise<string> {
  const stored = await SecureStore.getItemAsync(KEY_STORE_KEY, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });

  if (stored) return stored;

  // Generate a 32-byte random passphrase (64 hex chars)
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
  private constructor(private readonly db: SQLite.SQLiteDatabase) {}

  static async create(): Promise<NativeSqliteDriver> {
    const passphrase = await getOrCreatePassphrase();

    // expo-sqlite v14 opens with SQLCipher when key is provided
    const db = await SQLite.openDatabaseAsync(DB_NAME, {
      useNewConnection: false,
    });

    // Set SQLCipher key — this must be the first pragma after open
    await db.execAsync(`PRAGMA key = '${passphrase}';`);
    await db.execAsync(`PRAGMA journal_mode = WAL;`);
    await db.execAsync(`PRAGMA foreign_keys = ON;`);

    return new NativeSqliteDriver(db);
  }

  async execute(sql: string, params: (string | number | null)[] = []): Promise<QueryResult> {
    const result = await this.db.runAsync(sql, params);
    return {
      rows: [],
      rowsAffected: result.changes,
      lastInsertId: result.lastInsertRowId,
    };
  }

  async query<T = DbRow>(sql: string, params: (string | number | null)[] = []): Promise<T[]> {
    return this.db.getAllAsync<T>(sql, params);
  }

  async transaction(fn: (tx: SqliteDriver) => Promise<void>): Promise<void> {
    await this.db.withTransactionAsync(async () => {
      await fn(this);
    });
  }

  async close(): Promise<void> {
    await this.db.closeAsync();
  }
}
