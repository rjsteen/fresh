import { describe, it, expect, beforeEach } from 'vitest';
import { BudgetRuleEngine } from './rules';
import { makeTestDb } from '../test/makeTestDb';
import type { SqliteDriver } from '../db/client';
import { v4 as uuidv4 } from 'uuid';

let driver: SqliteDriver;
let engine: BudgetRuleEngine;

beforeEach(async () => {
  const db = await makeTestDb();
  driver = db.driver;
  engine = new BudgetRuleEngine();

  // Insert a category and account needed by multiple tests
  await driver.execute(
    `INSERT INTO categories (id, name, is_system) VALUES ('cat-food', 'Food', 1)`
  );
  await driver.execute(
    `INSERT INTO accounts (id, name, institution, type, currency, current_balance, available_balance, connection_type)
     VALUES ('acct-1', 'Checking', 'Bank', 'checking', 'USD', 500, 500, 'manual')`
  );
});

// ---------------------------------------------------------------------------
// large_transaction
// ---------------------------------------------------------------------------

describe('large_transaction', () => {
  it('fires when transaction amount exceeds threshold', async () => {
    await driver.execute(
      `INSERT INTO alert_rules (id, name, rule_type, params, enabled)
       VALUES ('rule-1', 'Big spend', 'large_transaction', '{"threshold_amount":100}', 1)`
    );
    const tx = {
      id: uuidv4(),
      account_id: 'acct-1',
      external_id: null,
      amount: -150,
      currency: 'USD',
      description: 'Big purchase',
      merchant_name: 'Store',
      category_id: null,
      category_source: null,
      ml_confidence: null,
      date: '2026-04-01',
      posted_at: null,
      pending: false as const,
      notes: null,
      tags: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const fired = await engine.evaluateForTransaction(driver, tx);
    expect(fired).toHaveLength(1);
    expect(fired[0].rule.id).toBe('rule-1');
    expect(fired[0].severity).toBe('warning');
  });

  it('does not fire when transaction is below threshold', async () => {
    await driver.execute(
      `INSERT INTO alert_rules (id, name, rule_type, params, enabled)
       VALUES ('rule-2', 'Big spend', 'large_transaction', '{"threshold_amount":200}', 1)`
    );
    const tx = {
      id: uuidv4(),
      account_id: 'acct-1',
      external_id: null,
      amount: -50,
      currency: 'USD',
      description: 'Small purchase',
      merchant_name: null,
      category_id: null,
      category_source: null,
      ml_confidence: null,
      date: '2026-04-01',
      posted_at: null,
      pending: false as const,
      notes: null,
      tags: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const fired = await engine.evaluateForTransaction(driver, tx);
    expect(fired).toHaveLength(0);
  });

  it('does not fire when rule is disabled', async () => {
    await driver.execute(
      `INSERT INTO alert_rules (id, name, rule_type, params, enabled)
       VALUES ('rule-dis', 'Disabled', 'large_transaction', '{"threshold_amount":10}', 0)`
    );
    const tx = {
      id: uuidv4(),
      account_id: 'acct-1',
      external_id: null,
      amount: -500,
      currency: 'USD',
      description: 'Huge purchase',
      merchant_name: null,
      category_id: null,
      category_source: null,
      ml_confidence: null,
      date: '2026-04-01',
      posted_at: null,
      pending: false as const,
      notes: null,
      tags: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const fired = await engine.evaluateForTransaction(driver, tx);
    expect(fired).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// merchant
// ---------------------------------------------------------------------------

describe('merchant', () => {
  it('fires when merchant name matches a watched name', async () => {
    await driver.execute(
      `INSERT INTO alert_rules (id, name, rule_type, params, enabled)
       VALUES ('rule-m', 'Watch merchant', 'merchant', '{"merchant_names":["amazon","netflix"]}', 1)`
    );
    const tx = {
      id: uuidv4(),
      account_id: 'acct-1',
      external_id: null,
      amount: -14.99,
      currency: 'USD',
      description: 'NETFLIX.COM',
      merchant_name: 'Netflix',
      category_id: null,
      category_source: null,
      ml_confidence: null,
      date: '2026-04-01',
      posted_at: null,
      pending: false as const,
      notes: null,
      tags: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const fired = await engine.evaluateForTransaction(driver, tx);
    expect(fired).toHaveLength(1);
    expect(fired[0].severity).toBe('info');
    expect(fired[0].message).toContain('Netflix');
  });

  it('does not fire for unmatched merchant', async () => {
    await driver.execute(
      `INSERT INTO alert_rules (id, name, rule_type, params, enabled)
       VALUES ('rule-m2', 'Watch merchant', 'merchant', '{"merchant_names":["amazon"]}', 1)`
    );
    const tx = {
      id: uuidv4(),
      account_id: 'acct-1',
      external_id: null,
      amount: -5,
      currency: 'USD',
      description: 'Local coffee shop',
      merchant_name: 'Blue Bottle Coffee',
      category_id: null,
      category_source: null,
      ml_confidence: null,
      date: '2026-04-01',
      posted_at: null,
      pending: false as const,
      notes: null,
      tags: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const fired = await engine.evaluateForTransaction(driver, tx);
    expect(fired).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// balance_low
// ---------------------------------------------------------------------------

describe('balance_low', () => {
  it('fires when account balance drops below threshold', async () => {
    // Account has available_balance = 500 from beforeEach
    await driver.execute(
      `UPDATE accounts SET available_balance = 80 WHERE id = 'acct-1'`
    );
    await driver.execute(
      `INSERT INTO alert_rules (id, name, rule_type, params, enabled)
       VALUES ('rule-bal', 'Low balance', 'balance_low',
               '{"account_id":"acct-1","threshold_amount":100}', 1)`
    );

    const fired = await engine.evaluateBalanceRules(driver);
    expect(fired).toHaveLength(1);
    expect(fired[0].rule.id).toBe('rule-bal');
    expect(fired[0].severity).toBe('warning');
  });

  it('fires as critical when balance is negative', async () => {
    await driver.execute(
      `UPDATE accounts SET current_balance = -20, available_balance = -20 WHERE id = 'acct-1'`
    );
    await driver.execute(
      `INSERT INTO alert_rules (id, name, rule_type, params, enabled)
       VALUES ('rule-neg', 'Negative balance', 'balance_low',
               '{"account_id":"acct-1","threshold_amount":0}', 1)`
    );

    const fired = await engine.evaluateBalanceRules(driver);
    expect(fired).toHaveLength(1);
    expect(fired[0].severity).toBe('critical');
  });

  it('does not fire when balance is above threshold', async () => {
    await driver.execute(
      `INSERT INTO alert_rules (id, name, rule_type, params, enabled)
       VALUES ('rule-bal2', 'Low balance', 'balance_low',
               '{"account_id":"acct-1","threshold_amount":100}', 1)`
    );

    const fired = await engine.evaluateBalanceRules(driver);
    // available_balance is 500 > 100
    expect(fired).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// budget_threshold
// ---------------------------------------------------------------------------

describe('budget_threshold', () => {
  it('fires when spending exceeds threshold percentage of budget limit', async () => {
    await driver.execute(
      `INSERT INTO budgets (id, name, period_type, start_date, is_active)
       VALUES ('b1', 'April', 'monthly', '2026-04-01', 1)`
    );
    await driver.execute(
      `INSERT INTO budget_lines (id, budget_id, category_id, name, limit_amount)
       VALUES ('bl1', 'b1', 'cat-food', 'Food', 200)`
    );
    // Insert spending: $180 of $200 limit = 90%
    await driver.execute(
      `INSERT INTO transactions (id, account_id, amount, currency, description, category_id, date, pending)
       VALUES ('tx-sp', 'acct-1', -180, 'USD', 'Groceries', 'cat-food', '2026-04-10', 0)`
    );
    await driver.execute(
      `INSERT INTO alert_rules (id, name, rule_type, params, enabled)
       VALUES ('rule-bt', 'Budget alert', 'budget_threshold',
               '{"budget_line_id":"bl1","threshold_pct":80,"period_start":"2026-04-01","period_end":"2026-04-30"}',
               1)`
    );

    const fired = await engine.evaluateBalanceRules(driver);
    expect(fired).toHaveLength(1);
    expect(fired[0].rule.id).toBe('rule-bt');
    expect(fired[0].severity).toBe('warning');
    expect(fired[0].message).toContain('Food');
  });

  it('fires as critical when over 100% of budget', async () => {
    await driver.execute(
      `INSERT INTO budgets (id, name, period_type, start_date, is_active)
       VALUES ('b2', 'April', 'monthly', '2026-04-01', 1)`
    );
    await driver.execute(
      `INSERT INTO budget_lines (id, budget_id, category_id, name, limit_amount)
       VALUES ('bl2', 'b2', 'cat-food', 'Food', 100)`
    );
    await driver.execute(
      `INSERT INTO transactions (id, account_id, amount, currency, description, category_id, date, pending)
       VALUES ('tx-over', 'acct-1', -120, 'USD', 'Groceries', 'cat-food', '2026-04-10', 0)`
    );
    await driver.execute(
      `INSERT INTO alert_rules (id, name, rule_type, params, enabled)
       VALUES ('rule-bt2', 'Budget alert', 'budget_threshold',
               '{"budget_line_id":"bl2","threshold_pct":80,"period_start":"2026-04-01","period_end":"2026-04-30"}',
               1)`
    );

    const fired = await engine.evaluateBalanceRules(driver);
    expect(fired).toHaveLength(1);
    expect(fired[0].severity).toBe('critical');
  });

  it('does not fire when under threshold', async () => {
    await driver.execute(
      `INSERT INTO budgets (id, name, period_type, start_date, is_active)
       VALUES ('b3', 'April', 'monthly', '2026-04-01', 1)`
    );
    await driver.execute(
      `INSERT INTO budget_lines (id, budget_id, category_id, name, limit_amount)
       VALUES ('bl3', 'b3', 'cat-food', 'Food', 200)`
    );
    await driver.execute(
      `INSERT INTO transactions (id, account_id, amount, currency, description, category_id, date, pending)
       VALUES ('tx-low', 'acct-1', -50, 'USD', 'Snacks', 'cat-food', '2026-04-05', 0)`
    );
    await driver.execute(
      `INSERT INTO alert_rules (id, name, rule_type, params, enabled)
       VALUES ('rule-bt3', 'Budget alert', 'budget_threshold',
               '{"budget_line_id":"bl3","threshold_pct":80,"period_start":"2026-04-01","period_end":"2026-04-30"}',
               1)`
    );

    const fired = await engine.evaluateBalanceRules(driver);
    expect(fired).toHaveLength(0);
  });
});
