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
  getActiveBudgets,
  getBudgetProgress,
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
// getActiveBudgets
// ---------------------------------------------------------------------------

describe('getActiveBudgets', () => {
  it('returns empty when no budgets exist', async () => {
    expect(await getActiveBudgets(db, '2024-03-15')).toEqual([]);
  });

  it('returns active budget whose start_date <= today and end_date is null', async () => {
    await db.execute(
      `INSERT INTO budgets (id, name, period_type, start_date, is_active)
       VALUES ('b1', 'Monthly', 'monthly', '2024-01-01', 1)`
    );
    const result = await getActiveBudgets(db, '2024-03-15');
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('b1');
    expect(result[0].is_active).toBe(true);
  });

  it('returns active budget when today is within [start_date, end_date]', async () => {
    await db.execute(
      `INSERT INTO budgets (id, name, period_type, start_date, end_date, is_active)
       VALUES ('b2', 'Custom', 'custom', '2024-03-01', '2024-03-31', 1)`
    );
    expect(await getActiveBudgets(db, '2024-03-15')).toHaveLength(1);
    expect(await getActiveBudgets(db, '2024-03-31')).toHaveLength(1);
  });

  it('excludes budget whose end_date is before today', async () => {
    await db.execute(
      `INSERT INTO budgets (id, name, period_type, start_date, end_date, is_active)
       VALUES ('b3', 'Old', 'custom', '2024-01-01', '2024-02-28', 1)`
    );
    expect(await getActiveBudgets(db, '2024-03-15')).toHaveLength(0);
  });

  it('excludes budget whose start_date is in the future', async () => {
    await db.execute(
      `INSERT INTO budgets (id, name, period_type, start_date, is_active)
       VALUES ('b4', 'Future', 'monthly', '2024-04-01', 1)`
    );
    expect(await getActiveBudgets(db, '2024-03-15')).toHaveLength(0);
  });

  it('excludes inactive budget', async () => {
    await db.execute(
      `INSERT INTO budgets (id, name, period_type, start_date, is_active)
       VALUES ('b5', 'Inactive', 'monthly', '2024-01-01', 0)`
    );
    expect(await getActiveBudgets(db, '2024-03-15')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// getBudgetProgress
// ---------------------------------------------------------------------------

describe('getBudgetProgress', () => {
  const TODAY = '2024-03-15'; // Friday in March 2024

  beforeEach(async () => {
    await upsertAccount(db, baseAccount());
    await db.execute(`INSERT INTO categories (id, name) VALUES ('cat-food', 'Food')`);
    await db.execute(
      `INSERT INTO budgets (id, name, period_type, start_date, is_active)
       VALUES ('bud-1', 'Monthly', 'monthly', '2024-03-01', 1)`
    );
    await db.execute(
      `INSERT INTO budget_lines (id, budget_id, name, category_id, limit_amount, rollover)
       VALUES ('bl-1', 'bud-1', 'Food', 'cat-food', 300, 0)`
    );
  });

  it('returns empty array when budget not found', async () => {
    expect(await getBudgetProgress(db, 'no-such-budget', TODAY)).toEqual([]);
  });

  it('returns zero spent when no transactions in the current period', async () => {
    const progress = await getBudgetProgress(db, 'bud-1', TODAY);
    expect(progress).toHaveLength(1);
    expect(progress[0].spent).toBe(0);
    expect(progress[0].remaining).toBe(300);
    expect(progress[0].pct_used).toBe(0);
    expect(progress[0].rollover_amount).toBe(0);
    expect(progress[0].effective_limit).toBe(300);
  });

  it('aggregates spending for the current monthly period', async () => {
    await upsertTransaction(db, baseTx('acc-1', { amount: -100, category_id: 'cat-food', date: '2024-03-05' }));
    await upsertTransaction(db, baseTx('acc-1', { amount: -50, category_id: 'cat-food', date: '2024-03-12' }));
    // Previous month — should not count
    await upsertTransaction(db, baseTx('acc-1', { amount: -200, category_id: 'cat-food', date: '2024-02-15' }));

    const [line] = await getBudgetProgress(db, 'bud-1', TODAY);
    expect(line.spent).toBe(150);
    expect(line.remaining).toBe(150);
    expect(line.pct_used).toBe(50);
  });

  it('excludes pending transactions', async () => {
    await upsertTransaction(db, baseTx('acc-1', { amount: -100, category_id: 'cat-food', date: '2024-03-10', pending: true }));
    const [line] = await getBudgetProgress(db, 'bud-1', TODAY);
    expect(line.spent).toBe(0);
  });

  it('carries forward unspent amount from previous period when rollover=1', async () => {
    // Enable rollover on the line
    await db.execute(`UPDATE budget_lines SET rollover = 1 WHERE id = 'bl-1'`);
    // Previous month: spent $100 of $300 → $200 unspent → rollover $200
    await upsertTransaction(db, baseTx('acc-1', { amount: -100, category_id: 'cat-food', date: '2024-02-15' }));
    // Current month: spent $50
    await upsertTransaction(db, baseTx('acc-1', { amount: -50, category_id: 'cat-food', date: '2024-03-10' }));

    const [line] = await getBudgetProgress(db, 'bud-1', TODAY);
    expect(line.rollover_amount).toBe(200);
    expect(line.effective_limit).toBe(500); // 300 + 200
    expect(line.spent).toBe(50);
    expect(line.remaining).toBe(450);
    expect(line.pct_used).toBe(10);
  });

  it('does not carry forward when previous period was over budget', async () => {
    await db.execute(`UPDATE budget_lines SET rollover = 1 WHERE id = 'bl-1'`);
    // Previous month: spent $350 of $300 → over budget, no rollover
    await upsertTransaction(db, baseTx('acc-1', { amount: -350, category_id: 'cat-food', date: '2024-02-15' }));

    const [line] = await getBudgetProgress(db, 'bud-1', TODAY);
    expect(line.rollover_amount).toBe(0);
    expect(line.effective_limit).toBe(300);
  });

  it('does not carry forward when rollover=0 even if previous period has unspent', async () => {
    // rollover stays 0 (default)
    await upsertTransaction(db, baseTx('acc-1', { amount: -50, category_id: 'cat-food', date: '2024-02-15' }));
    const [line] = await getBudgetProgress(db, 'bud-1', TODAY);
    expect(line.rollover_amount).toBe(0);
    expect(line.effective_limit).toBe(300);
  });

  it('scopes monthly period to the month containing asOfDate (historical view)', async () => {
    // Selecting "Last month" passes ref.start = first of last month as asOfDate
    await upsertTransaction(db, baseTx('acc-1', { amount: -80, category_id: 'cat-food', date: '2024-02-10' }));
    // March transaction should not count when viewing February
    await upsertTransaction(db, baseTx('acc-1', { amount: -50, category_id: 'cat-food', date: '2024-03-05' }));

    const [line] = await getBudgetProgress(db, 'bud-1', '2024-02-01');
    expect(line.spent).toBe(80);
    expect(line.remaining).toBe(220);
  });
});

// ---------------------------------------------------------------------------
// getBudgetProgress — weekly period
// ---------------------------------------------------------------------------

describe('getBudgetProgress (weekly)', () => {
  // 2024-03-11 is a Monday. Week = March 11–17.
  const TODAY = '2024-03-15'; // Friday

  beforeEach(async () => {
    await upsertAccount(db, baseAccount());
    await db.execute(`INSERT INTO categories (id, name) VALUES ('cat-food', 'Food')`);
    await db.execute(
      `INSERT INTO budgets (id, name, period_type, start_date, is_active)
       VALUES ('bud-w', 'Weekly', 'weekly', '2024-03-11', 1)`
    );
    await db.execute(
      `INSERT INTO budget_lines (id, budget_id, name, category_id, limit_amount, rollover)
       VALUES ('bl-w', 'bud-w', 'Food', 'cat-food', 100, 0)`
    );
  });

  it('includes transactions within the current Mon–Sun week', async () => {
    await upsertTransaction(db, baseTx('acc-1', { amount: -40, category_id: 'cat-food', date: '2024-03-11' })); // Mon
    await upsertTransaction(db, baseTx('acc-1', { amount: -20, category_id: 'cat-food', date: '2024-03-14' })); // Thu
    // Previous week — should not count
    await upsertTransaction(db, baseTx('acc-1', { amount: -50, category_id: 'cat-food', date: '2024-03-10' })); // Sun prev week

    const [line] = await getBudgetProgress(db, 'bud-w', TODAY);
    expect(line.spent).toBe(60);
    expect(line.remaining).toBe(40);
  });

  it('includes Sunday as the last day of the week', async () => {
    await upsertTransaction(db, baseTx('acc-1', { amount: -30, category_id: 'cat-food', date: '2024-03-17' })); // Sun
    const [line] = await getBudgetProgress(db, 'bud-w', TODAY);
    expect(line.spent).toBe(30);
  });

  it('rolls over unspent from previous week', async () => {
    await db.execute(`UPDATE budget_lines SET rollover = 1 WHERE id = 'bl-w'`);
    // Previous week (March 4–10): spent $30 of $100 → $70 rollover
    await upsertTransaction(db, baseTx('acc-1', { amount: -30, category_id: 'cat-food', date: '2024-03-07' }));
    // This week: spent $20
    await upsertTransaction(db, baseTx('acc-1', { amount: -20, category_id: 'cat-food', date: '2024-03-12' }));

    const [line] = await getBudgetProgress(db, 'bud-w', TODAY);
    expect(line.rollover_amount).toBe(70);
    expect(line.effective_limit).toBe(170);
    expect(line.spent).toBe(20);
    expect(line.remaining).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// getBudgetProgress — annual period
// ---------------------------------------------------------------------------

describe('getBudgetProgress (annual)', () => {
  const TODAY = '2024-03-15';

  beforeEach(async () => {
    await upsertAccount(db, baseAccount());
    await db.execute(`INSERT INTO categories (id, name) VALUES ('cat-food', 'Food')`);
    await db.execute(
      `INSERT INTO budgets (id, name, period_type, start_date, is_active)
       VALUES ('bud-a', 'Annual', 'annual', '2024-01-01', 1)`
    );
    await db.execute(
      `INSERT INTO budget_lines (id, budget_id, name, category_id, limit_amount, rollover)
       VALUES ('bl-a', 'bud-a', 'Food', 'cat-food', 1200, 0)`
    );
  });

  it('includes transactions in the current calendar year', async () => {
    await upsertTransaction(db, baseTx('acc-1', { amount: -100, category_id: 'cat-food', date: '2024-01-15' }));
    await upsertTransaction(db, baseTx('acc-1', { amount: -200, category_id: 'cat-food', date: '2024-12-31' }));
    // Previous year — should not count
    await upsertTransaction(db, baseTx('acc-1', { amount: -500, category_id: 'cat-food', date: '2023-12-31' }));

    const [line] = await getBudgetProgress(db, 'bud-a', TODAY);
    expect(line.spent).toBe(300);
    expect(line.remaining).toBe(900);
  });
});

// ---------------------------------------------------------------------------
// getBudgetProgress — custom period
// ---------------------------------------------------------------------------

describe('getBudgetProgress (custom)', () => {
  beforeEach(async () => {
    await upsertAccount(db, baseAccount());
    await db.execute(`INSERT INTO categories (id, name) VALUES ('cat-food', 'Food')`);
    await db.execute(
      `INSERT INTO budgets (id, name, period_type, start_date, end_date, is_active)
       VALUES ('bud-c', 'Custom', 'custom', '2024-03-01', '2024-03-31', 1)`
    );
    await db.execute(
      `INSERT INTO budget_lines (id, budget_id, name, category_id, limit_amount, rollover)
       VALUES ('bl-c', 'bud-c', 'Food', 'cat-food', 500, 0)`
    );
  });

  it('uses start_date and end_date exactly, regardless of asOfDate', async () => {
    await upsertTransaction(db, baseTx('acc-1', { amount: -150, category_id: 'cat-food', date: '2024-03-10' }));
    // Outside range — should not count
    await upsertTransaction(db, baseTx('acc-1', { amount: -200, category_id: 'cat-food', date: '2024-02-28' }));
    await upsertTransaction(db, baseTx('acc-1', { amount: -200, category_id: 'cat-food', date: '2024-04-01' }));

    const [line] = await getBudgetProgress(db, 'bud-c', '2024-04-15');
    expect(line.spent).toBe(150);
    expect(line.remaining).toBe(350);
  });

  it('includes transactions on the boundary dates', async () => {
    await upsertTransaction(db, baseTx('acc-1', { amount: -50, category_id: 'cat-food', date: '2024-03-01' }));
    await upsertTransaction(db, baseTx('acc-1', { amount: -75, category_id: 'cat-food', date: '2024-03-31' }));

    const [line] = await getBudgetProgress(db, 'bud-c', '2024-03-15');
    expect(line.spent).toBe(125);
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
