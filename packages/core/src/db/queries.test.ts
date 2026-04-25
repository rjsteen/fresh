/**
 * Unit tests for packages/core/src/db/queries.ts
 *
 * Uses a real in-memory SQLite database via sql.js — no SQL mocking.
 * Schema regressions, FK constraints, and COALESCE semantics are all exercised.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb } from '../test/makeTestDb';
import type { SqliteDriver } from '../db/client';
import {
  getAccounts,
  upsertAccount,
  getTransactions,
  upsertTransaction,
  categorizeTransaction,
  getBudgetSummary,
  getEnabledAlertRules,
  getAllAlertRules,
  upsertAlertRule,
  deleteAlertRule,
  hasAlertFired,
  recordAlertFired,
  getSpendingByCategory,
} from './queries';

let db: SqliteDriver;

beforeEach(async () => {
  const testDb = await makeTestDb();
  db = testDb.driver;
});

// ---------------------------------------------------------------------------
// Shared seed helpers
// ---------------------------------------------------------------------------

function baseAccount(id = 'acc-1', overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: 'Test Bank',
    institution: 'Test',
    type: 'checking' as const,
    currency: 'USD',
    current_balance: 0,
    available_balance: null,
    last_synced_at: null,
    connection_type: 'manual' as const,
    sync_token_ref: null,
    is_active: true,
    ...overrides,
  };
}

function baseTx(accountId = 'acc-1', overrides: Record<string, unknown> = {}) {
  return {
    account_id: accountId,
    external_id: null,
    amount: -10,
    currency: 'USD',
    description: 'Test transaction',
    merchant_name: null,
    category_id: null,
    category_source: null,
    ml_confidence: null,
    date: '2024-03-15',
    posted_at: null,
    pending: false,
    notes: null,
    tags: null,
    ...overrides,
  } as Parameters<typeof upsertTransaction>[1];
}

function baseRule(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Test Rule',
    rule_type: 'large_transaction' as const,
    params: { threshold: 500 },
    enabled: true,
    backend_token_ref: null,
    ...overrides,
  } as Parameters<typeof upsertAlertRule>[1];
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

describe('getAccounts', () => {
  it('returns empty array when no accounts exist', async () => {
    expect(await getAccounts(db)).toEqual([]);
  });

  it('returns inserted account', async () => {
    const account = await upsertAccount(db, baseAccount());
    const list = await getAccounts(db);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(account.id);
    expect(list[0].name).toBe('Test Bank');
  });

  it('excludes inactive accounts', async () => {
    await upsertAccount(db, baseAccount('acc-a', { name: 'Active', is_active: true }));
    await upsertAccount(db, baseAccount('acc-b', { name: 'Inactive', is_active: false }));
    const list = await getAccounts(db);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('Active');
  });

  it('orders by display_order ascending then name', async () => {
    await upsertAccount(db, baseAccount('acc-b', { name: 'B', display_order: 2 }));
    await upsertAccount(db, baseAccount('acc-a', { name: 'A', display_order: 1 }));
    const list = await getAccounts(db);
    expect(list[0].name).toBe('A');
    expect(list[1].name).toBe('B');
  });
});

describe('upsertAccount', () => {
  it('generates an id when none provided', async () => {
    const acc = await upsertAccount(db, {
      name: 'New', institution: 'X', type: 'savings', currency: 'USD',
      current_balance: 0, available_balance: null, last_synced_at: null,
      connection_type: 'manual', sync_token_ref: null, is_active: true,
    });
    expect(acc.id).toBeTruthy();
  });

  it('uses the provided id', async () => {
    const acc = await upsertAccount(db, baseAccount('fixed-id'));
    expect(acc.id).toBe('fixed-id');
  });

  it('updates balance and last_synced_at on conflict', async () => {
    await upsertAccount(db, baseAccount('acc-1', { name: 'Old', current_balance: 100 }));
    await upsertAccount(db, baseAccount('acc-1', {
      name: 'New', current_balance: 999, last_synced_at: '2024-01-01T00:00:00Z',
    }));
    const list = await getAccounts(db);
    expect(list[0].current_balance).toBe(999);
    expect(list[0].name).toBe('New');
    expect(list[0].last_synced_at).toBe('2024-01-01T00:00:00Z');
  });
});

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

describe('getTransactions', () => {
  beforeEach(() => upsertAccount(db, baseAccount()));

  it('returns empty array when no transactions', async () => {
    expect(await getTransactions(db)).toEqual([]);
  });

  it('returns inserted transaction', async () => {
    await upsertTransaction(db, baseTx('acc-1', { amount: -50, description: 'Coffee' }));
    const txns = await getTransactions(db);
    expect(txns).toHaveLength(1);
    expect(txns[0].description).toBe('Coffee');
    expect(txns[0].amount).toBe(-50);
    expect(txns[0].pending).toBe(false);
  });

  it('filters by account_id', async () => {
    await upsertAccount(db, baseAccount('acc-2'));
    await upsertTransaction(db, baseTx('acc-1', { description: 'A' }));
    await upsertTransaction(db, baseTx('acc-2', { description: 'B' }));
    const result = await getTransactions(db, { account_id: 'acc-1' });
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe('A');
  });

  it('filters by start_date and end_date', async () => {
    await upsertTransaction(db, baseTx('acc-1', { description: 'Before', date: '2024-01-01' }));
    await upsertTransaction(db, baseTx('acc-1', { description: 'In range', date: '2024-03-01' }));
    await upsertTransaction(db, baseTx('acc-1', { description: 'After', date: '2024-06-01' }));
    const result = await getTransactions(db, { start_date: '2024-02-01', end_date: '2024-04-30' });
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe('In range');
  });

  it('filters by pending', async () => {
    await upsertTransaction(db, baseTx('acc-1', { description: 'Posted', pending: false }));
    await upsertTransaction(db, baseTx('acc-1', { description: 'Pending', pending: true }));
    expect((await getTransactions(db, { pending: true }))[0].description).toBe('Pending');
    expect((await getTransactions(db, { pending: false }))[0].description).toBe('Posted');
  });

  it('searches description and merchant_name', async () => {
    await upsertTransaction(db, baseTx('acc-1', { description: 'Blue Bottle Coffee', merchant_name: 'Blue Bottle' }));
    await upsertTransaction(db, baseTx('acc-1', { description: 'Grocery store' }));
    const result = await getTransactions(db, { search: 'bottle' });
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe('Blue Bottle Coffee');
  });

  it('respects limit and offset', async () => {
    for (let i = 1; i <= 5; i++) {
      await upsertTransaction(db, baseTx('acc-1', { amount: -i, description: `Tx ${i}` }));
    }
    const page1 = await getTransactions(db, { limit: 2, offset: 0 });
    const page2 = await getTransactions(db, { limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    const ids = new Set([...page1, ...page2].map((t) => t.id));
    expect(ids.size).toBe(4);
  });
});

describe('upsertTransaction', () => {
  beforeEach(() => upsertAccount(db, baseAccount()));

  it('deduplicates on id — updates pending', async () => {
    const tx = await upsertTransaction(db, baseTx('acc-1', { id: 'tx-1', pending: true }));
    await upsertTransaction(db, baseTx('acc-1', { id: 'tx-1', pending: false }));
    const txns = await getTransactions(db);
    expect(txns).toHaveLength(1);
    expect(txns[0].id).toBe(tx.id);
    expect(txns[0].pending).toBe(false);
  });

  it('deduplicates on (account_id, external_id)', async () => {
    await upsertTransaction(db, baseTx('acc-1', { external_id: 'ext-001', pending: true }));
    await upsertTransaction(db, baseTx('acc-1', { external_id: 'ext-001', pending: false }));
    const txns = await getTransactions(db);
    expect(txns).toHaveLength(1);
    expect(txns[0].pending).toBe(false);
  });

  it('preserves category when COALESCE update omits category_id', async () => {
    await db.execute(`INSERT INTO categories (id, name) VALUES ('cat-1', 'Food')`);
    const tx = await upsertTransaction(db, baseTx('acc-1', { id: 'tx-x', category_id: 'cat-1', category_source: 'user' }));
    // Upsert again without category — COALESCE should preserve it
    await upsertTransaction(db, baseTx('acc-1', { id: tx.id }));
    const rows = await getTransactions(db);
    expect(rows[0].category_id).toBe('cat-1');
  });
});

describe('categorizeTransaction', () => {
  beforeEach(() => upsertAccount(db, baseAccount()));

  it('updates category_id, source, and confidence', async () => {
    await db.execute(`INSERT INTO categories (id, name) VALUES ('cat-2', 'Transport')`);
    const tx = await upsertTransaction(db, baseTx('acc-1', { description: 'Uber' }));
    await categorizeTransaction(db, tx.id, 'cat-2', 'ml', 0.92);
    const [row] = await db.query<{ category_id: string; category_source: string; ml_confidence: number }>(
      'SELECT category_id, category_source, ml_confidence FROM transactions WHERE id = ?', [tx.id]
    );
    expect(row.category_id).toBe('cat-2');
    expect(row.category_source).toBe('ml');
    expect(row.ml_confidence).toBeCloseTo(0.92);
  });
});

// ---------------------------------------------------------------------------
// Budget summary
// ---------------------------------------------------------------------------

describe('getBudgetSummary', () => {
  beforeEach(async () => {
    await upsertAccount(db, baseAccount());
    await db.execute(`INSERT INTO categories (id, name) VALUES ('cat-food', 'Food')`);
    await db.execute(
      `INSERT INTO budgets (id, name, period_type, start_date) VALUES ('bud-1', 'Monthly', 'monthly', '2024-03-01')`
    );
    await db.execute(
      `INSERT INTO budget_lines (id, budget_id, name, category_id, limit_amount)
       VALUES ('bl-1', 'bud-1', 'Food', 'cat-food', 200)`
    );
  });

  it('returns zero spent when no transactions', async () => {
    const summary = await getBudgetSummary(db, 'bud-1', '2024-03-01', '2024-03-31');
    expect(summary).toHaveLength(1);
    expect(summary[0].spent).toBe(0);
    expect(summary[0].remaining).toBe(200);
    expect(summary[0].pct_used).toBe(0);
  });

  it('aggregates debit spending against budget line', async () => {
    await upsertTransaction(db, baseTx('acc-1', { amount: -80, description: 'Groceries', category_id: 'cat-food', date: '2024-03-10' }));
    await upsertTransaction(db, baseTx('acc-1', { amount: -40, description: 'Restaurant', category_id: 'cat-food', date: '2024-03-15' }));
    const summary = await getBudgetSummary(db, 'bud-1', '2024-03-01', '2024-03-31');
    expect(summary[0].spent).toBe(120);
    expect(summary[0].remaining).toBe(80);
    expect(summary[0].pct_used).toBe(60);
  });

  it('excludes pending transactions', async () => {
    await upsertTransaction(db, baseTx('acc-1', { amount: -100, category_id: 'cat-food', date: '2024-03-10', pending: true }));
    const summary = await getBudgetSummary(db, 'bud-1', '2024-03-01', '2024-03-31');
    expect(summary[0].spent).toBe(0);
  });

  it('excludes transactions outside date range', async () => {
    await upsertTransaction(db, baseTx('acc-1', { amount: -50, category_id: 'cat-food', date: '2024-02-15' }));
    const summary = await getBudgetSummary(db, 'bud-1', '2024-03-01', '2024-03-31');
    expect(summary[0].spent).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Alert rules
// ---------------------------------------------------------------------------

describe('alert rules', () => {
  it('getEnabledAlertRules returns only enabled rules with parsed params', async () => {
    await upsertAlertRule(db, baseRule({ name: 'Large Tx', params: { threshold: 500 }, enabled: true }));
    await upsertAlertRule(db, baseRule({ name: 'Disabled', rule_type: 'merchant', params: { merchant: 'Foo' }, enabled: false }));
    const enabled = await getEnabledAlertRules(db);
    expect(enabled).toHaveLength(1);
    expect(enabled[0].name).toBe('Large Tx');
    expect(enabled[0].params).toEqual({ threshold: 500 });
    expect(enabled[0].enabled).toBe(true);
  });

  it('getAllAlertRules returns enabled and disabled rules', async () => {
    await upsertAlertRule(db, baseRule({ name: 'A', enabled: true }));
    await upsertAlertRule(db, baseRule({ name: 'B', enabled: false }));
    const all = await getAllAlertRules(db);
    expect(all).toHaveLength(2);
    expect(all.find((r) => r.name === 'B')?.enabled).toBe(false);
  });

  it('upsertAlertRule creates then updates', async () => {
    const rule = await upsertAlertRule(db, baseRule({ name: 'Balance Low', rule_type: 'balance_low', params: { threshold: 100 } }));
    expect(rule.id).toBeTruthy();

    await upsertAlertRule(db, baseRule({ id: rule.id, name: 'Balance Low Updated', rule_type: 'balance_low', params: { threshold: 200 }, enabled: false }));
    const all = await getAllAlertRules(db);
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe('Balance Low Updated');
    expect(all[0].params).toEqual({ threshold: 200 });
    expect(all[0].enabled).toBe(false);
  });

  it('deleteAlertRule removes the rule', async () => {
    const rule = await upsertAlertRule(db, baseRule({ name: 'To Delete' }));
    await deleteAlertRule(db, rule.id);
    expect(await getAllAlertRules(db)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Alert deduplication
// ---------------------------------------------------------------------------

describe('hasAlertFired / recordAlertFired', () => {
  // fired_alerts.rule_id has a FK constraint — pre-create the rule
  async function seedRule(id: string): Promise<void> {
    await db.execute(
      `INSERT INTO alert_rules (id, name, rule_type, params, enabled)
       VALUES (?, 'Test Rule', 'large_transaction', '{}', 1)`,
      [id]
    );
  }

  async function seedTx(id: string): Promise<void> {
    await db.execute(
      `INSERT OR IGNORE INTO accounts (id, name, institution, type, currency, current_balance, connection_type)
       VALUES ('acc-alert', 'Test', 'X', 'checking', 'USD', 0, 'manual')`
    );
    await db.execute(
      `INSERT INTO transactions (id, account_id, amount, currency, description, date, pending)
       VALUES (?, 'acc-alert', -10, 'USD', 'test', '2024-03-01', 0)`,
      [id]
    );
  }

  it('returns false before any record is created', async () => {
    expect(await hasAlertFired(db, 'rule-x', 'tx-x')).toBe(false);
  });

  it('returns true after recording a tx-scoped firing', async () => {
    await seedRule('rule-1');
    await seedTx('tx-1');
    await recordAlertFired(db, 'rule-1', 'tx-1');
    expect(await hasAlertFired(db, 'rule-1', 'tx-1')).toBe(true);
  });

  it('returns false for a different transaction', async () => {
    await seedRule('rule-1');
    await seedTx('tx-1');
    await recordAlertFired(db, 'rule-1', 'tx-1');
    expect(await hasAlertFired(db, 'rule-1', 'tx-2')).toBe(false);
  });

  it('returns false for a different rule', async () => {
    await seedRule('rule-1');
    await seedRule('rule-2');
    await seedTx('tx-1');
    await recordAlertFired(db, 'rule-1', 'tx-1');
    expect(await hasAlertFired(db, 'rule-2', 'tx-1')).toBe(false);
  });

  it('returns true for a null-tx firing within 1-hour window', async () => {
    await seedRule('balance-rule');
    await recordAlertFired(db, 'balance-rule', null);
    expect(await hasAlertFired(db, 'balance-rule', null)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Spending by category
// ---------------------------------------------------------------------------

describe('getSpendingByCategory', () => {
  beforeEach(async () => {
    await upsertAccount(db, baseAccount());
    await db.execute(`INSERT INTO categories (id, name) VALUES ('cat-food', 'Food'), ('cat-travel', 'Travel')`);
  });

  it('returns empty when no transactions', async () => {
    const result = await getSpendingByCategory(db, '2024-01-01', '2024-12-31');
    expect(result).toEqual([]);
  });

  it('groups spending by category with totals and percentages', async () => {
    await upsertTransaction(db, baseTx('acc-1', { amount: -100, category_id: 'cat-food', date: '2024-03-10' }));
    await upsertTransaction(db, baseTx('acc-1', { amount: -60, category_id: 'cat-food', date: '2024-03-11' }));
    await upsertTransaction(db, baseTx('acc-1', { amount: -40, category_id: 'cat-travel', date: '2024-03-12' }));

    const result = await getSpendingByCategory(db, '2024-03-01', '2024-03-31');
    expect(result).toHaveLength(2);
    expect(result[0].category_id).toBe('cat-food');
    expect(result[0].total).toBe(160);
    expect(result[0].count).toBe(2);
    expect(result[0].pct_of_total).toBeCloseTo(80, 0);
    expect(result[1].total).toBe(40);
    expect(result[1].pct_of_total).toBeCloseTo(20, 0);
  });

  it('excludes pending transactions', async () => {
    await upsertTransaction(db, baseTx('acc-1', { amount: -50, category_id: 'cat-food', date: '2024-03-10', pending: true }));
    const result = await getSpendingByCategory(db, '2024-03-01', '2024-03-31');
    expect(result).toEqual([]);
  });

  it('filters by account IDs when provided', async () => {
    await upsertAccount(db, baseAccount('acc-2'));
    await upsertTransaction(db, baseTx('acc-1', { amount: -100, category_id: 'cat-food', date: '2024-03-10' }));
    await upsertTransaction(db, baseTx('acc-2', { amount: -200, category_id: 'cat-food', date: '2024-03-10' }));
    const result = await getSpendingByCategory(db, '2024-03-01', '2024-03-31', ['acc-1']);
    expect(result[0].total).toBe(100);
  });
});
