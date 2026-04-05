/**
 * On-device budget alert rule evaluation.
 *
 * Rules are evaluated entirely locally after new transactions are written to SQLCipher.
 * When a rule fires, the device optionally sends an opaque token_ref to the backend
 * so it can deliver a push notification — the backend never knows the rule's content.
 */

import type { SqliteDriver } from '../db/client';
import type { AlertRule, Transaction } from '../db/schema';
import { getEnabledAlertRules } from '../db/queries';

export interface RuleFiredEvent {
  rule: AlertRule;
  transaction: Transaction | null;
  message: string;
  severity: 'info' | 'warning' | 'critical';
}

type RuleEvaluator = (
  rule: AlertRule,
  db: SqliteDriver,
  transaction: Transaction | null
) => Promise<RuleFiredEvent | null>;

// ---------------------------------------------------------------------------
// Rule evaluators
// ---------------------------------------------------------------------------

const evaluateLargeTransaction: RuleEvaluator = async (rule, _db, transaction) => {
  if (!transaction) return null;
  const { threshold_amount } = rule.params as { threshold_amount: number };
  if (Math.abs(transaction.amount) < threshold_amount) return null;

  return {
    rule,
    transaction,
    message: `Large transaction: ${Math.abs(transaction.amount).toFixed(2)} at ${transaction.merchant_name ?? transaction.description}`,
    severity: 'warning',
  };
};

const evaluateBudgetThreshold: RuleEvaluator = async (rule, db, _transaction) => {
  const { budget_line_id, threshold_pct, period_start, period_end } = rule.params as {
    budget_line_id: string;
    threshold_pct: number;
    period_start: string;
    period_end: string;
  };

  const rows = await db.query<{ limit_amount: number; spent: number; name: string }>(
    `SELECT
       bl.limit_amount,
       bl.name,
       COALESCE(ABS(SUM(CASE WHEN t.amount < 0 THEN t.amount ELSE 0 END)), 0) as spent
     FROM budget_lines bl
     LEFT JOIN transactions t
       ON t.category_id = bl.category_id
       AND t.date BETWEEN ? AND ?
       AND t.pending = 0
     WHERE bl.id = ?
     GROUP BY bl.id`,
    [period_start, period_end, budget_line_id]
  );

  if (!rows.length) return null;
  const { limit_amount, spent, name } = rows[0];
  const pct = (spent / limit_amount) * 100;

  if (pct < threshold_pct) return null;

  return {
    rule,
    transaction: null,
    message: `Budget "${name}" at ${pct.toFixed(0)}% (${spent.toFixed(2)} / ${limit_amount.toFixed(2)})`,
    severity: pct >= 100 ? 'critical' : 'warning',
  };
};

const evaluateBalanceLow: RuleEvaluator = async (rule, db, _transaction) => {
  const { account_id, threshold_amount } = rule.params as {
    account_id: string;
    threshold_amount: number;
  };

  const rows = await db.query<{ available_balance: number | null; current_balance: number; name: string }>(
    'SELECT current_balance, available_balance, name FROM accounts WHERE id = ?',
    [account_id]
  );

  if (!rows.length) return null;
  const { current_balance, available_balance, name } = rows[0];
  const balance = available_balance ?? current_balance;

  if (balance > threshold_amount) return null;

  return {
    rule,
    transaction: null,
    message: `Low balance on "${name}": ${balance.toFixed(2)}`,
    severity: balance < 0 ? 'critical' : 'warning',
  };
};

const evaluateMerchantWatch: RuleEvaluator = async (rule, _db, transaction) => {
  if (!transaction) return null;
  const { merchant_names } = rule.params as { merchant_names: string[] };
  const txMerchant = (transaction.merchant_name ?? transaction.description).toLowerCase();
  const matched = merchant_names.some((m) => txMerchant.includes(m.toLowerCase()));
  if (!matched) return null;

  return {
    rule,
    transaction,
    message: `Transaction at watched merchant: ${transaction.merchant_name ?? transaction.description}`,
    severity: 'info',
  };
};

const EVALUATORS: Record<string, RuleEvaluator> = {
  large_transaction: evaluateLargeTransaction,
  budget_threshold: evaluateBudgetThreshold,
  balance_low: evaluateBalanceLow,
  merchant: evaluateMerchantWatch,
};

// ---------------------------------------------------------------------------
// Rule engine
// ---------------------------------------------------------------------------

export class BudgetRuleEngine {
  /**
   * Evaluate all enabled rules after a new transaction lands.
   * Pass `transaction = null` for rules that don't need a specific transaction (e.g. balance).
   */
  async evaluate(
    db: SqliteDriver,
    transaction: Transaction | null
  ): Promise<RuleFiredEvent[]> {
    const rules = await getEnabledAlertRules(db);
    const fired: RuleFiredEvent[] = [];

    for (const rule of rules) {
      const evaluator = EVALUATORS[rule.rule_type];
      if (!evaluator) {
        console.warn(`[RuleEngine] Unknown rule type: ${rule.rule_type}`);
        continue;
      }

      try {
        const event = await evaluator(rule, db, transaction);
        if (event) fired.push(event);
      } catch (err) {
        console.error(`[RuleEngine] Error evaluating rule ${rule.id}:`, err);
      }
    }

    return fired;
  }

  /** Run balance-based rules (no transaction context needed) */
  async evaluateBalanceRules(db: SqliteDriver): Promise<RuleFiredEvent[]> {
    return this.evaluate(db, null);
  }

  /** Run transaction-scoped rules after a new transaction is written */
  async evaluateForTransaction(
    db: SqliteDriver,
    transaction: Transaction
  ): Promise<RuleFiredEvent[]> {
    return this.evaluate(db, transaction);
  }
}

export const ruleEngine = new BudgetRuleEngine();
