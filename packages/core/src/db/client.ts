/**
 * Platform-agnostic SQLCipher DB client interface.
 *
 * Concrete implementations live in apps/web and apps/mobile because
 * the SQLite driver differs per platform (sql.js-httpvfs vs expo-sqlite).
 * This package exports the interface and migration runner only.
 */

import { MIGRATIONS, SCHEMA_VERSION } from './schema';

export interface DbRow {
  [column: string]: string | number | null;
}

export interface QueryResult<T = DbRow> {
  rows: T[];
  rowsAffected: number;
  lastInsertId?: number;
}

/** Minimal interface both platforms must implement */
export interface SqliteDriver {
  execute(sql: string, params?: (string | number | null)[]): Promise<QueryResult>;
  query<T = DbRow>(sql: string, params?: (string | number | null)[]): Promise<T[]>;
  transaction(fn: (tx: SqliteDriver) => Promise<void>): Promise<void>;
  close(): Promise<void>;
}

export class DbClient {
  constructor(private readonly driver: SqliteDriver) {}

  async runMigrations(): Promise<void> {
    // Ensure schema_versions table exists first
    await this.driver.execute(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        version    INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    const applied = await this.driver.query<{ version: number }>(
      'SELECT version FROM schema_versions ORDER BY version'
    );
    const appliedSet = new Set(applied.map((r) => r.version));

    for (const [versionStr, sql] of Object.entries(MIGRATIONS)) {
      const version = parseInt(versionStr, 10);
      if (appliedSet.has(version)) continue;

      await this.driver.transaction(async (tx) => {
        // SQLite doesn't support multiple statements in one execute call uniformly,
        // so we split on ';' and run each statement individually.
        const statements = sql
          .split(';')
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        for (const stmt of statements) {
          await tx.execute(stmt);
        }

        await tx.execute(
          'INSERT INTO schema_versions (version) VALUES (?)',
          [version]
        );
      });

      console.log(`[DB] Applied migration v${version}`);
    }

    const currentVersion = await this.driver.query<{ version: number }>(
      'SELECT MAX(version) as version FROM schema_versions'
    );

    if (currentVersion[0]?.version !== SCHEMA_VERSION) {
      throw new Error(
        `DB schema version mismatch: expected ${SCHEMA_VERSION}, got ${currentVersion[0]?.version}`
      );
    }
  }

  get raw(): SqliteDriver {
    return this.driver;
  }
}
