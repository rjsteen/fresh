/**
 * All financial data queries. Called from both web and mobile via the shared DbClient.
 * Params are always positional (?) to work with both sql.js and expo-sqlite.
 */

import { v4 as uuidv4 } from 'uuid';
import type { SqliteDriver } from './client';
import type { Account, Transaction, AlertRule, RecurringPattern } from './schema';

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export async function getAccounts(db: SqliteDriver): Promise<Account[]> {
  const rows = await db.query<Account>(
    `SELECT *, (is_active = 1) as is_active
     FROM accounts
     WHERE is_active = 1
     ORDER BY display_order ASC, name ASC`
  );
  return rows;
}

export async function upsertAccount(
  db: SqliteDriver,
  account: Omit<Account, 'id' | 'created_at' | 'updated_at'> & { id?: string }
): Promise<Account> {
  const id = account.id ?? uuidv4();
  await db.execute(
    `INSERT INTO accounts
       (id, name, institution, type, currency, current_balance, available_balance,
        last_synced_at, connection_type, sync_token_ref, is_active, display_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       current_balance = excluded.current_balance,
       available_balance = excluded.available_balance,
       last_synced_at = excluded.last_synced_at,
       is_active = excluded.is_active,
       updated_at = datetime('now')`,
    [
      id,
      account.name,
      account.institution,
      account.type,
      account.currency,
      account.current_balance,
      account.available_balance ?? null,
      account.last_synced_at ?? null,
      account.connection_type,
      account.sync_token_ref ?? null,
      account.is_active ? 1 : 0,
      account.display_order ?? 0,
    ]
  );
  const rows = await db.query<Account>('SELECT * FROM accounts WHERE id = ?', [id]);
  return rows[0];
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export interface TransactionFilters {
  account_id?: string;
  category_id?: string;
  start_date?: string;
  end_date?: string;
  pending?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}

export async function getTransactions(
  db: SqliteDriver,
  filters: TransactionFilters = {}
): Promise<Transaction[]> {
  const conditions: string[] = [];
  const params: (string | number | null)[] = [];

  if (filters.account_id) {
    conditions.push('t.account_id = ?');
    params.push(filters.account_id);
  }
  if (filters.category_id) {
    conditions.push('t.category_id = ?');
    params.push(filters.category_id);
  }
  if (filters.start_date) {
    conditions.push('t.date >= ?');
    params.push(filters.start_date);
  }
  if (filters.end_date) {
    conditions.push('t.date <= ?');
    params.push(filters.end_date);
  }
  if (filters.pending !== undefined) {
    conditions.push('t.pending = ?');
    params.push(filters.pending ? 1 : 0);
  }
  if (filters.search) {
    conditions.push('(t.description LIKE ? OR t.merchant_name LIKE ? OR t.notes LIKE ?)');
    const like = `%${filters.search}%`;
    params.push(like, like, like);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit ?? 50;
  const offset = filters.offset ?? 0;

  type TransactionRow = Omit<Transaction, 'pending' | 'tags'> & { pending: 0 | 1; tags_json: string | null };
  const rows = await db.query<TransactionRow>(
    `SELECT t.*, json(t.tags) as tags_json
     FROM transactions t
     ${where}
     ORDER BY t.date DESC, t.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return rows.map((r) => ({
    ...r,
    pending: r.pending === 1,
    tags: r.tags_json ? JSON.parse(r.tags_json) : null,
  })) as Transaction[];
}

export async function upsertTransaction(
  db: SqliteDriver,
  tx: Omit<Transaction, 'id' | 'created_at' | 'updated_at'> & { id?: string }
): Promise<Transaction> {
  const id = tx.id ?? uuidv4();
  await db.execute(
    `INSERT INTO transactions
       (id, account_id, external_id, amount, currency, description, merchant_name,
        category_id, category_source, ml_confidence, date, posted_at, pending, notes, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       category_id = COALESCE(excluded.category_id, category_id),
       category_source = COALESCE(excluded.category_source, category_source),
       ml_confidence = COALESCE(excluded.ml_confidence, ml_confidence),
       merchant_name = COALESCE(excluded.merchant_name, merchant_name),
       pending = excluded.pending,
       notes = COALESCE(excluded.notes, notes),
       tags = COALESCE(excluded.tags, tags),
       updated_at = datetime('now')
     ON CONFLICT(account_id, external_id) DO UPDATE SET
       pending = excluded.pending,
       amount = excluded.amount,
       posted_at = excluded.posted_at,
       updated_at = datetime('now')`,
    [
      id,
      tx.account_id,
      tx.external_id ?? null,
      tx.amount,
      tx.currency,
      tx.description,
      tx.merchant_name ?? null,
      tx.category_id ?? null,
      tx.category_source ?? null,
      tx.ml_confidence ?? null,
      tx.date,
      tx.posted_at ?? null,
      tx.pending ? 1 : 0,
      tx.notes ?? null,
      tx.tags ? JSON.stringify(tx.tags) : null,
    ]
  );
  const rows = await db.query<Transaction>('SELECT * FROM transactions WHERE id = ?', [id]);
  return rows[0];
}

export async function categorizeTransaction(
  db: SqliteDriver,
  transactionId: string,
  categoryId: string,
  source: 'ml' | 'rule' | 'user',
  confidence?: number
): Promise<void> {
  await db.execute(
    `UPDATE transactions
     SET category_id = ?, category_source = ?, ml_confidence = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [categoryId, source, confidence ?? null, transactionId]
  );
}

// ---------------------------------------------------------------------------
// Budget queries
// ---------------------------------------------------------------------------

export interface BudgetSummary {
  budget_id: string;
  budget_name: string;
  line_id: string;
  line_name: string;
  category_id: string | null;
  limit_amount: number;
  spent: number;
  remaining: number;
  pct_used: number;
}

export async function getBudgetSummary(
  db: SqliteDriver,
  budgetId: string,
  periodStart: string,
  periodEnd: string
): Promise<BudgetSummary[]> {
  return db.query<BudgetSummary>(
    `SELECT
       b.id as budget_id,
       b.name as budget_name,
       bl.id as line_id,
       bl.name as line_name,
       bl.category_id,
       bl.limit_amount,
       COALESCE(ABS(SUM(CASE WHEN t.amount < 0 THEN t.amount ELSE 0 END)), 0) as spent,
       bl.limit_amount - COALESCE(ABS(SUM(CASE WHEN t.amount < 0 THEN t.amount ELSE 0 END)), 0) as remaining,
       ROUND(
         COALESCE(ABS(SUM(CASE WHEN t.amount < 0 THEN t.amount ELSE 0 END)), 0)
         / bl.limit_amount * 100, 1
       ) as pct_used
     FROM budgets b
     JOIN budget_lines bl ON bl.budget_id = b.id
     LEFT JOIN transactions t
       ON t.category_id = bl.category_id
       AND t.date BETWEEN ? AND ?
       AND t.pending = 0
     WHERE b.id = ?
     GROUP BY bl.id
     ORDER BY pct_used DESC`,
    [periodStart, periodEnd, budgetId]
  );
}

// ---------------------------------------------------------------------------
// Alert rules
// ---------------------------------------------------------------------------

export async function getEnabledAlertRules(db: SqliteDriver): Promise<AlertRule[]> {
  type AlertRuleRow = Omit<AlertRule, 'params' | 'enabled'> & { params: string; enabled: 0 | 1 };
  const rows = await db.query<AlertRuleRow>(
    `SELECT * FROM alert_rules WHERE enabled = 1 ORDER BY created_at ASC`
  );
  return rows.map((r) => ({
    ...r,
    enabled: true,
    params: JSON.parse(r.params),
  }));
}

export async function getAllAlertRules(db: SqliteDriver): Promise<AlertRule[]> {
  type AlertRuleRow = Omit<AlertRule, 'params' | 'enabled'> & { params: string; enabled: 0 | 1 };
  const rows = await db.query<AlertRuleRow>(
    `SELECT * FROM alert_rules ORDER BY created_at ASC`
  );
  return rows.map((r) => ({
    ...r,
    enabled: r.enabled === 1,
    params: JSON.parse(r.params),
  }));
}

export async function deleteAlertRule(db: SqliteDriver, id: string): Promise<void> {
  await db.execute('DELETE FROM alert_rules WHERE id = ?', [id]);
}

export async function upsertAlertRule(
  db: SqliteDriver,
  rule: Omit<AlertRule, 'id' | 'created_at' | 'updated_at'> & { id?: string }
): Promise<AlertRule> {
  const id = rule.id ?? uuidv4();
  await db.execute(
    `INSERT INTO alert_rules (id, name, rule_type, params, enabled, backend_token_ref)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       params = excluded.params,
       enabled = excluded.enabled,
       updated_at = datetime('now')`,
    [
      id,
      rule.name,
      rule.rule_type,
      JSON.stringify(rule.params),
      rule.enabled ? 1 : 0,
      rule.backend_token_ref ?? null,
    ]
  );
  type AlertRuleRow = Omit<AlertRule, 'params' | 'enabled'> & { params: string; enabled: 0 | 1 };
  const rows = await db.query<AlertRuleRow>('SELECT * FROM alert_rules WHERE id = ?', [id]);
  const r = rows[0];
  return { ...r, enabled: r.enabled === 1, params: JSON.parse(r.params) };
}

// ---------------------------------------------------------------------------
// Alert deduplication
// ---------------------------------------------------------------------------

/**
 * Returns true if this rule has already been recorded as fired for the given
 * transaction (or, for rules without a transaction context, within the last hour).
 */
export async function hasAlertFired(
  db: SqliteDriver,
  ruleId: string,
  transactionId: string | null
): Promise<boolean> {
  if (transactionId !== null) {
    const rows = await db.query<{ n: number }>(
      'SELECT COUNT(*) as n FROM fired_alerts WHERE rule_id = ? AND transaction_id = ?',
      [ruleId, transactionId]
    );
    return rows[0].n > 0;
  }
  // For balance/budget rules (no tx context), apply a 1-hour cooldown window
  const rows = await db.query<{ n: number }>(
    `SELECT COUNT(*) as n FROM fired_alerts
     WHERE rule_id = ? AND transaction_id IS NULL
       AND fired_at > datetime('now', '-1 hour')`,
    [ruleId]
  );
  return rows[0].n > 0;
}

/** Record that a rule fired so it won't re-fire for the same context. */
export async function recordAlertFired(
  db: SqliteDriver,
  ruleId: string,
  transactionId: string | null
): Promise<void> {
  await db.execute(
    'INSERT INTO fired_alerts (id, rule_id, transaction_id) VALUES (?, ?, ?)',
    [uuidv4(), ruleId, transactionId ?? null]
  );
}

// ---------------------------------------------------------------------------
// Recurring patterns
// ---------------------------------------------------------------------------

export async function getRecurringPatterns(db: SqliteDriver): Promise<RecurringPattern[]> {
  type Row = Omit<RecurringPattern, 'is_subscription'> & { is_subscription: 0 | 1 };
  const rows = await db.query<Row>(
    `SELECT * FROM recurring_patterns ORDER BY next_expected_at ASC NULLS LAST`
  );
  return rows.map((r) => ({ ...r, is_subscription: r.is_subscription === 1 }));
}

export async function upsertRecurringPattern(
  db: SqliteDriver,
  pattern: Omit<RecurringPattern, 'id' | 'created_at' | 'updated_at'>
): Promise<void> {
  const existing = await db.query<{ id: string }>(
    'SELECT id FROM recurring_patterns WHERE merchant_name = ?',
    [pattern.merchant_name]
  );

  if (existing.length > 0) {
    await db.execute(
      `UPDATE recurring_patterns
       SET category_id = ?, typical_amount = ?, amount_variance = ?,
           frequency_days = ?, last_seen_at = ?, next_expected_at = ?,
           is_subscription = ?, updated_at = datetime('now')
       WHERE id = ?`,
      [
        pattern.category_id ?? null,
        pattern.typical_amount ?? null,
        pattern.amount_variance ?? null,
        pattern.frequency_days,
        pattern.last_seen_at ?? null,
        pattern.next_expected_at ?? null,
        pattern.is_subscription ? 1 : 0,
        existing[0].id,
      ]
    );
  } else {
    await db.execute(
      `INSERT INTO recurring_patterns
         (id, merchant_name, category_id, typical_amount, amount_variance,
          frequency_days, last_seen_at, next_expected_at, is_subscription)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        pattern.merchant_name,
        pattern.category_id ?? null,
        pattern.typical_amount ?? null,
        pattern.amount_variance ?? null,
        pattern.frequency_days,
        pattern.last_seen_at ?? null,
        pattern.next_expected_at ?? null,
        pattern.is_subscription ? 1 : 0,
      ]
    );
  }
}

/**
 * Returns patterns whose next_expected_at has passed with no matching
 * transaction in a ±(frequency_days/2, min 3) day window around it.
 */
export async function getMissedRecurringCharges(
  db: SqliteDriver,
  asOfDate: string = new Date().toISOString().slice(0, 10)
): Promise<RecurringPattern[]> {
  type Row = Omit<RecurringPattern, 'is_subscription'> & { is_subscription: 0 | 1 };
  const overdue = await db.query<Row>(
    `SELECT * FROM recurring_patterns
     WHERE next_expected_at IS NOT NULL AND next_expected_at < ?`,
    [asOfDate]
  );

  const missed: RecurringPattern[] = [];
  for (const row of overdue) {
    const halfWindow = Math.max(3, Math.floor(row.frequency_days / 2));
    const windowStart = _isoAddDays(row.next_expected_at!, -halfWindow);
    const windowEnd = _isoAddDays(row.next_expected_at!, halfWindow);
    const [{ n }] = await db.query<{ n: number }>(
      `SELECT COUNT(*) as n FROM transactions
       WHERE merchant_name = ? AND pending = 0 AND date BETWEEN ? AND ?`,
      [row.merchant_name, windowStart, windowEnd]
    );
    if (n === 0) missed.push({ ...row, is_subscription: row.is_subscription === 1 });
  }
  return missed;
}

function _isoAddDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Spending analytics (no backend involved)
// ---------------------------------------------------------------------------

export interface SpendingByCategory {
  category_id: string | null;
  category_name: string | null;
  total: number;
  count: number;
  pct_of_total: number;
}

export async function getSpendingByCategory(
  db: SqliteDriver,
  startDate: string,
  endDate: string,
  accountIds?: string[]
): Promise<SpendingByCategory[]> {
  const accountFilter =
    accountIds && accountIds.length > 0
      ? `AND t.account_id IN (${accountIds.map(() => '?').join(',')})`
      : '';

  const params: (string | number | null)[] = [startDate, endDate];
  if (accountIds) params.push(...accountIds);

  return db.query<SpendingByCategory>(
    `WITH total AS (
       SELECT ABS(SUM(amount)) as grand_total
       FROM transactions
       WHERE amount < 0 AND pending = 0
         AND date BETWEEN ? AND ?
         ${accountFilter}
     )
     SELECT
       t.category_id,
       c.name as category_name,
       ABS(SUM(t.amount)) as total,
       COUNT(*) as count,
       ROUND(ABS(SUM(t.amount)) / (SELECT grand_total FROM total) * 100, 1) as pct_of_total
     FROM transactions t
     LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.amount < 0 AND t.pending = 0
       AND t.date BETWEEN ? AND ?
       ${accountFilter}
     GROUP BY t.category_id
     ORDER BY total DESC`,
    [...params, ...params]
  );
}
