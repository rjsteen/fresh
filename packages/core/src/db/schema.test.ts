import { describe, it, expect } from 'vitest';
import { makeTestDb } from '../test/makeTestDb';
import { MIGRATIONS } from './schema';

describe('migration v9 — unix timestamp date repair', () => {
  it('converts numeric date strings to yyyy-MM-dd and posted_at to ISO datetime', async () => {
    const { driver } = await makeTestDb();

    // Seed the minimum required rows to satisfy FK constraints
    await driver.execute(`
      INSERT INTO accounts (id, name, institution, type, currency, current_balance, connection_type, is_active, created_at, updated_at)
      VALUES ('acct-1', 'Test', 'Bank', 'checking', 'USD', 0, 'simplefin', 1, datetime('now'), datetime('now'))
    `);

    // Insert transactions with Unix timestamp strings as if synced before the backend fix
    await driver.execute(`
      INSERT INTO transactions (id, account_id, amount, currency, description, date, posted_at, pending, created_at, updated_at)
      VALUES
        ('tx-unix-1', 'acct-1', -10.0, 'USD', 'Coffee', '1705276800', '1705276800', 0, datetime('now'), datetime('now')),
        ('tx-unix-2', 'acct-1', -5.0,  'USD', 'Bus',    '1705190400', NULL,         0, datetime('now'), datetime('now')),
        ('tx-good',   'acct-1', -3.0,  'USD', 'Store',  '2024-01-15', '2024-01-15T00:00:00Z', 0, datetime('now'), datetime('now'))
    `);

    // Run the migration SQL directly (migration is already recorded, so we run the SQL manually)
    const migrationSql = MIGRATIONS[9];
    for (const stmt of migrationSql.split(';').map(s => s.trim()).filter(Boolean)) {
      await driver.execute(stmt);
    }

    const rows = await driver.query<{ id: string; date: string; posted_at: string | null }>(
      'SELECT id, date, posted_at FROM transactions ORDER BY id'
    );

    const byId = Object.fromEntries(rows.map(r => [r.id, r]));

    // Unix timestamp 1705276800 = 2024-01-15 00:00:00 UTC
    expect(byId['tx-unix-1'].date).toBe('2024-01-15');
    expect(byId['tx-unix-1'].posted_at).toBe('2024-01-15T00:00:00Z');

    // Unix timestamp 1705190400 = 2024-01-14 00:00:00 UTC
    expect(byId['tx-unix-2'].date).toBe('2024-01-14');
    expect(byId['tx-unix-2'].posted_at).toBeNull();

    // Already-valid dates must not be touched
    expect(byId['tx-good'].date).toBe('2024-01-15');
    expect(byId['tx-good'].posted_at).toBe('2024-01-15T00:00:00Z');
  });
});
