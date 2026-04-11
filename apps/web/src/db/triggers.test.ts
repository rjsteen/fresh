/**
 * Verifies that migration 6 triggers correctly populate change_log for every
 * financial table on INSERT, UPDATE, and DELETE.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from '../test/makeTestDb';
import type { DbClient } from '@fresh/core/db';

let client: DbClient;

type ChangeLogRow = {
  table_name: string;
  row_id: string;
  operation: string;
  payload: string | null;
};

async function lastLog(table: string, op: string): Promise<ChangeLogRow | undefined> {
  const rows = await client.raw.query<ChangeLogRow>(
    `SELECT table_name, row_id, operation, payload
     FROM change_log
     WHERE table_name = ? AND operation = ?
     ORDER BY seq DESC LIMIT 1`,
    [table, op]
  );
  return rows[0];
}

beforeEach(async () => {
  ({ client } = await makeTestDb());
});

// ---------------------------------------------------------------------------
// Helper seed data
// ---------------------------------------------------------------------------

async function insertAccount(id = 'acc-1') {
  await client.raw.execute(
    `INSERT INTO accounts (id, name, institution, type, currency, connection_type)
     VALUES (?, 'Checking', 'Bank', 'checking', 'USD', 'manual')`,
    [id]
  );
  return id;
}

async function insertCategory(id = 'cat-1') {
  await client.raw.execute(
    `INSERT INTO categories (id, name) VALUES (?, 'Food')`,
    [id]
  );
  return id;
}

async function insertTransaction(id = 'txn-1', accountId = 'acc-1') {
  await client.raw.execute(
    `INSERT INTO transactions (id, account_id, amount, currency, description, date)
     VALUES (?, ?, -10.50, 'USD', 'Coffee', '2024-01-15')`,
    [id, accountId]
  );
  return id;
}

// ---------------------------------------------------------------------------
// accounts
// ---------------------------------------------------------------------------

describe('accounts triggers', () => {
  it('logs insert', async () => {
    await insertAccount('acc-1');
    const row = await lastLog('accounts', 'insert');
    expect(row?.row_id).toBe('acc-1');
    const payload = JSON.parse(row!.payload!);
    expect(payload.id).toBe('acc-1');
    expect(payload.name).toBe('Checking');
  });

  it('logs update', async () => {
    await insertAccount('acc-1');
    await client.raw.execute(`UPDATE accounts SET name = 'Updated' WHERE id = 'acc-1'`);
    const row = await lastLog('accounts', 'update');
    expect(row?.row_id).toBe('acc-1');
    expect(JSON.parse(row!.payload!).name).toBe('Updated');
  });

  it('logs delete with null payload', async () => {
    await insertAccount('acc-1');
    await client.raw.execute(`DELETE FROM accounts WHERE id = 'acc-1'`);
    const row = await lastLog('accounts', 'delete');
    expect(row?.row_id).toBe('acc-1');
    expect(row?.payload).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// transactions
// ---------------------------------------------------------------------------

describe('transactions triggers', () => {
  beforeEach(async () => {
    await insertAccount('acc-1');
  });

  it('logs insert', async () => {
    await insertTransaction('txn-1');
    const row = await lastLog('transactions', 'insert');
    expect(row?.row_id).toBe('txn-1');
    const payload = JSON.parse(row!.payload!);
    expect(payload.account_id).toBe('acc-1');
    expect(payload.amount).toBe(-10.5);
  });

  it('logs update', async () => {
    await insertTransaction('txn-1');
    await client.raw.execute(`UPDATE transactions SET notes = 'edited' WHERE id = 'txn-1'`);
    const row = await lastLog('transactions', 'update');
    expect(row?.row_id).toBe('txn-1');
    expect(JSON.parse(row!.payload!).notes).toBe('edited');
  });

  it('logs delete with null payload', async () => {
    await insertTransaction('txn-1');
    await client.raw.execute(`DELETE FROM transactions WHERE id = 'txn-1'`);
    const row = await lastLog('transactions', 'delete');
    expect(row?.row_id).toBe('txn-1');
    expect(row?.payload).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// categories
// ---------------------------------------------------------------------------

describe('categories triggers', () => {
  it('logs insert', async () => {
    await insertCategory('cat-1');
    const row = await lastLog('categories', 'insert');
    expect(row?.row_id).toBe('cat-1');
    expect(JSON.parse(row!.payload!).name).toBe('Food');
  });

  it('logs update', async () => {
    await insertCategory('cat-1');
    await client.raw.execute(`UPDATE categories SET name = 'Dining' WHERE id = 'cat-1'`);
    const row = await lastLog('categories', 'update');
    expect(JSON.parse(row!.payload!).name).toBe('Dining');
  });

  it('logs delete with null payload', async () => {
    await insertCategory('cat-1');
    await client.raw.execute(`DELETE FROM categories WHERE id = 'cat-1'`);
    const row = await lastLog('categories', 'delete');
    expect(row?.payload).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// budgets
// ---------------------------------------------------------------------------

describe('budgets triggers', () => {
  it('logs insert', async () => {
    await client.raw.execute(
      `INSERT INTO budgets (id, name, period_type, start_date) VALUES ('bud-1', 'Jan', 'monthly', '2024-01-01')`
    );
    const row = await lastLog('budgets', 'insert');
    expect(row?.row_id).toBe('bud-1');
    expect(JSON.parse(row!.payload!).period_type).toBe('monthly');
  });

  it('logs update', async () => {
    await client.raw.execute(
      `INSERT INTO budgets (id, name, period_type, start_date) VALUES ('bud-1', 'Jan', 'monthly', '2024-01-01')`
    );
    await client.raw.execute(`UPDATE budgets SET name = 'February' WHERE id = 'bud-1'`);
    const row = await lastLog('budgets', 'update');
    expect(JSON.parse(row!.payload!).name).toBe('February');
  });

  it('logs delete with null payload', async () => {
    await client.raw.execute(
      `INSERT INTO budgets (id, name, period_type, start_date) VALUES ('bud-1', 'Jan', 'monthly', '2024-01-01')`
    );
    await client.raw.execute(`DELETE FROM budgets WHERE id = 'bud-1'`);
    const row = await lastLog('budgets', 'delete');
    expect(row?.payload).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// budget_lines
// ---------------------------------------------------------------------------

describe('budget_lines triggers', () => {
  beforeEach(async () => {
    await client.raw.execute(
      `INSERT INTO budgets (id, name, period_type, start_date) VALUES ('bud-1', 'Jan', 'monthly', '2024-01-01')`
    );
  });

  it('logs insert', async () => {
    await client.raw.execute(
      `INSERT INTO budget_lines (id, budget_id, name, limit_amount) VALUES ('bl-1', 'bud-1', 'Groceries', 500)`
    );
    const row = await lastLog('budget_lines', 'insert');
    expect(row?.row_id).toBe('bl-1');
    expect(JSON.parse(row!.payload!).limit_amount).toBe(500);
  });

  it('logs update', async () => {
    await client.raw.execute(
      `INSERT INTO budget_lines (id, budget_id, name, limit_amount) VALUES ('bl-1', 'bud-1', 'Groceries', 500)`
    );
    await client.raw.execute(`UPDATE budget_lines SET limit_amount = 750 WHERE id = 'bl-1'`);
    const row = await lastLog('budget_lines', 'update');
    expect(row?.row_id).toBe('bl-1');
    expect(JSON.parse(row!.payload!).limit_amount).toBe(750);
  });

  it('logs delete with null payload', async () => {
    await client.raw.execute(
      `INSERT INTO budget_lines (id, budget_id, name, limit_amount) VALUES ('bl-1', 'bud-1', 'Groceries', 500)`
    );
    await client.raw.execute(`DELETE FROM budget_lines WHERE id = 'bl-1'`);
    const row = await lastLog('budget_lines', 'delete');
    expect(row?.payload).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// alert_rules
// ---------------------------------------------------------------------------

describe('alert_rules triggers', () => {
  it('logs insert', async () => {
    await client.raw.execute(
      `INSERT INTO alert_rules (id, name, rule_type, params) VALUES ('ar-1', 'Big spend', 'large_transaction', '{"threshold":100}')`
    );
    const row = await lastLog('alert_rules', 'insert');
    expect(row?.row_id).toBe('ar-1');
    expect(JSON.parse(row!.payload!).rule_type).toBe('large_transaction');
  });

  it('logs update', async () => {
    await client.raw.execute(
      `INSERT INTO alert_rules (id, name, rule_type, params) VALUES ('ar-1', 'Big spend', 'large_transaction', '{"threshold":100}')`
    );
    await client.raw.execute(`UPDATE alert_rules SET name = 'Huge spend' WHERE id = 'ar-1'`);
    const row = await lastLog('alert_rules', 'update');
    expect(row?.row_id).toBe('ar-1');
    expect(JSON.parse(row!.payload!).name).toBe('Huge spend');
  });

  it('logs delete with null payload', async () => {
    await client.raw.execute(
      `INSERT INTO alert_rules (id, name, rule_type, params) VALUES ('ar-1', 'Big spend', 'large_transaction', '{"threshold":100}')`
    );
    await client.raw.execute(`DELETE FROM alert_rules WHERE id = 'ar-1'`);
    const row = await lastLog('alert_rules', 'delete');
    expect(row?.payload).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// recurring_patterns
// ---------------------------------------------------------------------------

describe('recurring_patterns triggers', () => {
  it('logs insert', async () => {
    await client.raw.execute(
      `INSERT INTO recurring_patterns (id, merchant_name, frequency_days) VALUES ('rp-1', 'Netflix', 30)`
    );
    const row = await lastLog('recurring_patterns', 'insert');
    expect(row?.row_id).toBe('rp-1');
    expect(JSON.parse(row!.payload!).frequency_days).toBe(30);
  });

  it('logs update', async () => {
    await client.raw.execute(
      `INSERT INTO recurring_patterns (id, merchant_name, frequency_days) VALUES ('rp-1', 'Netflix', 30)`
    );
    await client.raw.execute(`UPDATE recurring_patterns SET frequency_days = 31 WHERE id = 'rp-1'`);
    const row = await lastLog('recurring_patterns', 'update');
    expect(row?.row_id).toBe('rp-1');
    expect(JSON.parse(row!.payload!).frequency_days).toBe(31);
  });

  it('logs delete with null payload', async () => {
    await client.raw.execute(
      `INSERT INTO recurring_patterns (id, merchant_name, frequency_days) VALUES ('rp-1', 'Netflix', 30)`
    );
    await client.raw.execute(`DELETE FROM recurring_patterns WHERE id = 'rp-1'`);
    const row = await lastLog('recurring_patterns', 'delete');
    expect(row?.payload).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// anomalies
// ---------------------------------------------------------------------------

describe('anomalies triggers', () => {
  beforeEach(async () => {
    await insertAccount('acc-1');
    await insertTransaction('txn-1');
  });

  it('logs insert', async () => {
    await client.raw.execute(
      `INSERT INTO anomalies (id, transaction_id, type, score) VALUES ('an-1', 'txn-1', 'unusual_amount', 0.95)`
    );
    const row = await lastLog('anomalies', 'insert');
    expect(row?.row_id).toBe('an-1');
    expect(JSON.parse(row!.payload!).score).toBe(0.95);
  });

  it('logs update', async () => {
    await client.raw.execute(
      `INSERT INTO anomalies (id, transaction_id, type, score) VALUES ('an-1', 'txn-1', 'unusual_amount', 0.95)`
    );
    await client.raw.execute(`UPDATE anomalies SET acknowledged = 1 WHERE id = 'an-1'`);
    const row = await lastLog('anomalies', 'update');
    expect(JSON.parse(row!.payload!).acknowledged).toBe(1);
  });

  it('logs delete with null payload', async () => {
    await client.raw.execute(
      `INSERT INTO anomalies (id, transaction_id, type, score) VALUES ('an-1', 'txn-1', 'unusual_amount', 0.95)`
    );
    await client.raw.execute(`DELETE FROM anomalies WHERE id = 'an-1'`);
    const row = await lastLog('anomalies', 'delete');
    expect(row?.payload).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// sync_state (PK = account_id)
// ---------------------------------------------------------------------------

describe('sync_state triggers', () => {
  beforeEach(async () => {
    await insertAccount('acc-1');
  });

  it('logs insert using account_id as row_id', async () => {
    await client.raw.execute(`INSERT INTO sync_state (account_id) VALUES ('acc-1')`);
    const row = await lastLog('sync_state', 'insert');
    expect(row?.row_id).toBe('acc-1');
    expect(JSON.parse(row!.payload!).account_id).toBe('acc-1');
  });

  it('logs update', async () => {
    await client.raw.execute(`INSERT INTO sync_state (account_id) VALUES ('acc-1')`);
    await client.raw.execute(`UPDATE sync_state SET retry_count = 3 WHERE account_id = 'acc-1'`);
    const row = await lastLog('sync_state', 'update');
    expect(JSON.parse(row!.payload!).retry_count).toBe(3);
  });

  it('logs delete with null payload', async () => {
    await client.raw.execute(`INSERT INTO sync_state (account_id) VALUES ('acc-1')`);
    await client.raw.execute(`DELETE FROM sync_state WHERE account_id = 'acc-1'`);
    const row = await lastLog('sync_state', 'delete');
    expect(row?.row_id).toBe('acc-1');
    expect(row?.payload).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// change_log and sync_meta must NOT have triggers (no recursion)
// ---------------------------------------------------------------------------

describe('no triggers on change_log or sync_meta', () => {
  it('inserting into change_log does not add another change_log row', async () => {
    await client.raw.execute(
      `INSERT INTO change_log (table_name, row_id, operation) VALUES ('manual', 'x', 'insert')`
    );
    const rows = await client.raw.query<{ c: number }>(
      `SELECT COUNT(*) as c FROM change_log WHERE table_name = 'change_log'`
    );
    expect(rows[0].c).toBe(0);
  });

  it('inserting into sync_meta does not add a change_log row', async () => {
    const before = await client.raw.query<{ c: number }>(`SELECT COUNT(*) as c FROM change_log`);
    await client.raw.execute(`INSERT INTO sync_meta (key, value) VALUES ('cursor', 'abc')`);
    const after = await client.raw.query<{ c: number }>(`SELECT COUNT(*) as c FROM change_log`);
    expect(after[0].c).toBe(before[0].c);
  });
});
