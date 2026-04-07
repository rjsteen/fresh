/**
 * Creates a real in-memory SQLite database (via sql.js) with the full schema
 * applied, for use in unit tests. No OPFS, no encryption, no browser APIs needed.
 */
import initSqlJs from 'sql.js';
import { DbClient } from '@fresh/core/db';
import type { SqliteDriver, QueryResult, DbRow } from '@fresh/core/db';

class InMemoryDriver implements SqliteDriver {
  constructor(private db: import('sql.js').Database) {}

  async execute(sql: string, params: (string | number | null)[] = []): Promise<QueryResult> {
    const stmt = this.db.prepare(sql);
    stmt.run(params as never[]);
    const rowsAffected = this.db.getRowsModified();
    stmt.free();
    return { rows: [], rowsAffected };
  }

  async query<T = DbRow>(sql: string, params: (string | number | null)[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    stmt.bind(params as never[]);
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
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

export async function makeTestDb(): Promise<{ client: DbClient; driver: SqliteDriver }> {
  const SQL = await initSqlJs();
  const sqlDb = new SQL.Database();
  // Foreign-key enforcement is off by default in SQLite; enable it so ON DELETE CASCADE
  // and other FK constraints actually fire — matching desired production behaviour.
  sqlDb.run('PRAGMA foreign_keys = ON');
  const driver = new InMemoryDriver(sqlDb);
  const client = new DbClient(driver);
  await client.runMigrations();
  return { client, driver };
}
