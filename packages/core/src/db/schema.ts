/**
 * SQLCipher schema for on-device financial data.
 *
 * This DB is the source of truth for ALL financial data.
 * The backend never receives, stores, or processes any of these values.
 */

export const SCHEMA_VERSION = 5;

export const CREATE_TABLES_SQL = `
-- Schema version tracking
CREATE TABLE IF NOT EXISTS schema_versions (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Linked bank accounts (credentials stored in OS keychain, not here)
CREATE TABLE IF NOT EXISTS accounts (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  institution     TEXT NOT NULL,
  type            TEXT NOT NULL CHECK(type IN ('checking','savings','credit','investment','cash')),
  currency        TEXT NOT NULL DEFAULT 'USD',
  current_balance REAL NOT NULL DEFAULT 0,
  available_balance REAL,
  last_synced_at  TEXT,
  connection_type TEXT NOT NULL CHECK(connection_type IN ('simplefin','gocardless','manual')),
  -- Opaque token used by backend to schedule syncs — not a credential
  sync_token_ref  TEXT,
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- All financial transactions
CREATE TABLE IF NOT EXISTS transactions (
  id              TEXT PRIMARY KEY,
  account_id      TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  external_id     TEXT,                          -- ID from bank/provider for dedup
  amount          REAL NOT NULL,                 -- Negative = debit, positive = credit
  currency        TEXT NOT NULL DEFAULT 'USD',
  description     TEXT NOT NULL,
  merchant_name   TEXT,
  category_id     TEXT REFERENCES categories(id),
  category_source TEXT CHECK(category_source IN ('ml','rule','user')),
  ml_confidence   REAL,                          -- 0.0–1.0 from ONNX model
  date            TEXT NOT NULL,                 -- ISO 8601 date
  posted_at       TEXT,
  pending         INTEGER NOT NULL DEFAULT 0,
  notes           TEXT,
  tags            TEXT,                          -- JSON array of strings
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_account_date
  ON transactions(account_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_category
  ON transactions(category_id);
CREATE INDEX IF NOT EXISTS idx_transactions_pending
  ON transactions(pending) WHERE pending = 1;

-- Categories (mix of built-in and user-defined)
CREATE TABLE IF NOT EXISTS categories (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  parent_id   TEXT REFERENCES categories(id),
  icon        TEXT,
  color       TEXT,
  is_system   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Budget periods
CREATE TABLE IF NOT EXISTS budgets (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  period_type TEXT NOT NULL CHECK(period_type IN ('monthly','weekly','annual','custom')),
  start_date  TEXT NOT NULL,
  end_date    TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-category budget limits
CREATE TABLE IF NOT EXISTS budget_lines (
  id          TEXT PRIMARY KEY,
  budget_id   TEXT NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
  category_id TEXT REFERENCES categories(id),
  name        TEXT NOT NULL,
  limit_amount REAL NOT NULL,
  rollover    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Anomaly events detected by on-device ML
CREATE TABLE IF NOT EXISTS anomalies (
  id              TEXT PRIMARY KEY,
  transaction_id  TEXT NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK(type IN ('unusual_amount','new_merchant','frequency','category_shift')),
  score           REAL NOT NULL,                 -- 0.0–1.0 anomaly score
  acknowledged    INTEGER NOT NULL DEFAULT 0,
  detected_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Local alert rule definitions (evaluated entirely on-device)
CREATE TABLE IF NOT EXISTS alert_rules (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  rule_type   TEXT NOT NULL,                     -- 'budget_threshold','large_transaction','merchant','balance_low'
  params      TEXT NOT NULL,                     -- JSON: rule-specific parameters
  enabled     INTEGER NOT NULL DEFAULT 1,
  -- backend_token_ref: opaque reference so backend can send push signal
  -- backend never knows the rule content, only that "alert N fired"
  backend_token_ref TEXT UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Device sync state (last successful sync per account)
CREATE TABLE IF NOT EXISTS sync_state (
  account_id      TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  last_cursor     TEXT,                          -- Provider-specific continuation cursor
  last_success_at TEXT,
  last_error      TEXT,
  retry_count     INTEGER NOT NULL DEFAULT 0
);
`;

export const MIGRATIONS: Record<number, string> = {
  1: CREATE_TABLES_SQL,
  2: `
    ALTER TABLE transactions ADD COLUMN receipt_uri TEXT;
    ALTER TABLE transactions ADD COLUMN split_of TEXT REFERENCES transactions(id);
  `,
  3: `
    CREATE TABLE IF NOT EXISTS recurring_patterns (
      id              TEXT PRIMARY KEY,
      merchant_name   TEXT NOT NULL,
      category_id     TEXT REFERENCES categories(id),
      typical_amount  REAL,
      amount_variance REAL,
      frequency_days  INTEGER NOT NULL,
      last_seen_at    TEXT,
      next_expected_at TEXT,
      is_subscription INTEGER NOT NULL DEFAULT 0,
      created_at      TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_recurring_next
      ON recurring_patterns(next_expected_at);
  `,
  4: `
    ALTER TABLE accounts ADD COLUMN display_order INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX IF NOT EXISTS idx_accounts_order ON accounts(display_order);
  `,

  5: `
    -- Tracks every write for delta sync to user cloud storage.
    -- Triggers populate this automatically (see below).
    -- 'pushed' is set to 1 after the delta is uploaded to cloud storage.
    CREATE TABLE IF NOT EXISTS change_log (
      seq        INTEGER PRIMARY KEY AUTOINCREMENT,
      changed_at TEXT    NOT NULL DEFAULT (datetime('now')),
      table_name TEXT    NOT NULL,
      row_id     TEXT    NOT NULL,
      operation  TEXT    NOT NULL CHECK(operation IN ('insert','update','delete')),
      payload    TEXT,
      pushed     INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_change_log_pushed ON change_log(pushed, seq);

    -- Key/value store for sync metadata (cloud cursor, provider, etc.)
    CREATE TABLE IF NOT EXISTS sync_meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `,
};

export type AccountType = 'checking' | 'savings' | 'credit' | 'investment' | 'cash';
export type ConnectionType = 'simplefin' | 'gocardless' | 'manual';
export type CategorySource = 'ml' | 'rule' | 'user';
export type PeriodType = 'monthly' | 'weekly' | 'annual' | 'custom';
export type AnomalyType = 'unusual_amount' | 'new_merchant' | 'frequency' | 'category_shift';
export type AlertRuleType = 'budget_threshold' | 'large_transaction' | 'merchant' | 'balance_low';

export interface Account {
  id: string;
  name: string;
  institution: string;
  type: AccountType;
  currency: string;
  current_balance: number;
  available_balance: number | null;
  last_synced_at: string | null;
  connection_type: ConnectionType;
  sync_token_ref: string | null;
  is_active: boolean;
  display_order?: number;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  account_id: string;
  external_id: string | null;
  amount: number;
  currency: string;
  description: string;
  merchant_name: string | null;
  category_id: string | null;
  category_source: CategorySource | null;
  ml_confidence: number | null;
  date: string;
  posted_at: string | null;
  pending: boolean;
  notes: string | null;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  name: string;
  parent_id: string | null;
  icon: string | null;
  color: string | null;
  is_system: boolean;
  created_at: string;
}

export interface Budget {
  id: string;
  name: string;
  period_type: PeriodType;
  start_date: string;
  end_date: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BudgetLine {
  id: string;
  budget_id: string;
  category_id: string | null;
  name: string;
  limit_amount: number;
  rollover: boolean;
  created_at: string;
  updated_at: string;
}

export interface AlertRule {
  id: string;
  name: string;
  rule_type: AlertRuleType;
  params: Record<string, unknown>;
  enabled: boolean;
  backend_token_ref: string | null;
  created_at: string;
  updated_at: string;
}
