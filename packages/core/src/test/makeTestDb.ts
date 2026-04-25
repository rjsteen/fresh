/**
 * Creates a real in-memory SQLite database (via sql.js) with the full schema
 * applied, for use in unit tests inside packages/core.
 */
import initSqlJs from 'sql.js';
import { DbClient } from '../db/client';
import type { SqliteDriver, QueryResult, DbRow } from '../db/client';

class InMemoryDriver implements SqliteDriver {
  constructor(private db: import('sql.js').Database) {}

  async execute(sql: string, params: (string | number | null)[] = []): Promise<QueryResult> {
    if (params.length === 0) {
      this.db.run(sql);
      return { rows: [], rowsAffected: this.db.getRowsModified() };
    }
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
  sqlDb.run('PRAGMA foreign_keys = ON');
  const driver = new InMemoryDriver(sqlDb);
  const client = new DbClient(driver);
  await client.runMigrations();
  return { client, driver };
}
