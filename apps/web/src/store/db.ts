/**
 * Global DB client singleton for the web app.
 * Initialized once at app startup, then passed via React context.
 */

import { DbClient } from '@privacyfinance/core/db';
import { WebSqliteDriver } from '../db/driver';

let dbClientSingleton: DbClient | null = null;

export async function initDb(): Promise<DbClient> {
  if (dbClientSingleton) return dbClientSingleton;

  const driver = await WebSqliteDriver.create();
  const client = new DbClient(driver);
  await client.runMigrations();

  dbClientSingleton = client;
  return client;
}

export function getDb(): DbClient {
  if (!dbClientSingleton) throw new Error('DB not initialized — call initDb() first');
  return dbClientSingleton;
}
