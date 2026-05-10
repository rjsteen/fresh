/**
 * Budget page tests — uses a real in-memory SQLite database (via sql.js) with
 * the full schema applied. No SQL mocking; mutations and queries run against
 * actual SQLite so schema bugs and query regressions are caught here.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, type Mock } from 'vitest';
import { Budget } from './Budget';
import { renderWithProviders } from '../test/renderWithProviders';
import { makeTestDb } from '../test/makeTestDb';
import type { DbClient } from '@fresh/core/db';

// ---------------------------------------------------------------------------
// Mock only the React context hook — the real DbClient is injected per-test
// ---------------------------------------------------------------------------

vi.mock('../context', () => ({ useDb: vi.fn() }));

// Recharts uses ResizeObserver which jsdom doesn't provide
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

import { useDb } from '../context';

// ---------------------------------------------------------------------------
// Per-test DB setup
// ---------------------------------------------------------------------------

let client: DbClient;

beforeEach(async () => {
  const db = await makeTestDb();
  client = db.client;
  (useDb as Mock).mockReturnValue(client);
});

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedBudget(overrides: {
  id?: string;
  name?: string;
  period_type?: string;
} = {}) {
  const id = overrides.id ?? 'budget-1';
  await client.raw.execute(
    `INSERT INTO budgets (id, name, period_type, start_date, is_active)
     VALUES (?, ?, ?, ?, 1)`,
    [id, overrides.name ?? 'Monthly', overrides.period_type ?? 'monthly', '2026-04-01']
  );
  return id;
}

async function seedLine(budgetId: string, overrides: {
  id?: string;
  name?: string;
  limit_amount?: number;
  rollover?: number;
} = {}) {
  const id = overrides.id ?? 'line-1';
  await client.raw.execute(
    `INSERT INTO budget_lines (id, budget_id, name, limit_amount, rollover)
     VALUES (?, ?, ?, ?, ?)`,
    [id, budgetId, overrides.name ?? 'Groceries', overrides.limit_amount ?? 400, overrides.rollover ?? 0]
  );
  return id;
}

async function seedTransaction(accountId: string, categoryId: string | null, amount: number, date: string) {
  await client.raw.execute(
    `INSERT INTO accounts (id, name, institution, type, currency, connection_type)
     VALUES (?, 'Test Bank', 'Test', 'checking', 'USD', 'manual')
     ON CONFLICT(id) DO NOTHING`,
    [accountId]
  );
  await client.raw.execute(
    `INSERT INTO transactions (id, account_id, amount, currency, description, date, pending)
     VALUES (?, ?, ?, 'USD', 'test txn', ?, 0)`,
    [crypto.randomUUID(), accountId, amount, date]
  );
  if (categoryId) {
    await client.raw.execute(
      `INSERT INTO categories (id, name) VALUES (?, ?) ON CONFLICT(id) DO NOTHING`,
      [categoryId, 'Test Category']
    );
    await client.raw.execute(
      `UPDATE budget_lines SET category_id = ? WHERE budget_id IN (SELECT id FROM budgets) AND name = 'Groceries'`,
      [categoryId]
    );
    await client.raw.execute(
      `UPDATE transactions SET category_id = ? WHERE amount = ?`,
      [categoryId, amount]
    );
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Budget page', () => {
  // -------------------------------------------------------------------------
  describe('empty state', () => {
    it('shows empty state when no budgets exist', async () => {
      renderWithProviders(<Budget />);
      await waitFor(() => {
        expect(screen.getByText(/no budgets yet/i)).toBeInTheDocument();
      });
    });

    it('shows "Create your first budget" CTA', async () => {
      renderWithProviders(<Budget />);
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /create your first budget/i })
        ).toBeInTheDocument();
      });
    });

    it('always shows "+ New Budget" button in header', async () => {
      renderWithProviders(<Budget />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /new budget/i })).toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('overview card — seeded budget', () => {
    it('displays the budget name', async () => {
      await seedBudget({ name: 'April Spending' });
      renderWithProviders(<Budget />);
      await waitFor(() => {
        expect(screen.getByText('April Spending')).toBeInTheDocument();
      });
    });

    it('displays the period type badge', async () => {
      await seedBudget({ period_type: 'monthly' });
      renderWithProviders(<Budget />);
      await waitFor(() => {
        expect(screen.getByText('monthly')).toBeInTheDocument();
      });
    });

    it('renders Edit and Delete buttons', async () => {
      await seedBudget();
      renderWithProviders(<Budget />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('budget lines', () => {
    it('renders line name, spent/limit, and percentage', async () => {
      // Use a custom period covering a fixed date range so this test is not
      // sensitive to the current month.
      const budgetId = await seedBudget({ period_type: 'custom' });
      await client.raw.execute(
        `UPDATE budgets SET end_date = '2026-04-30' WHERE id = ?`,
        [budgetId]
      );
      await seedLine(budgetId, { name: 'Dining', limit_amount: 200 });
      // Seed a debit transaction linked to this line's category
      await seedTransaction('acc-1', 'cat-dining', -60, '2026-04-05');
      await client.raw.execute(
        `UPDATE budget_lines SET category_id = 'cat-dining' WHERE budget_id = ?`,
        [budgetId]
      );

      renderWithProviders(<Budget />);

      await waitFor(() => {
        expect(screen.getByText('Dining')).toBeInTheDocument();
        // Spent $60 of $200 → shown as $60 / $200
        expect(screen.getByText(/\$60\s*\/\s*\$200/)).toBeInTheDocument();
        expect(screen.getByText('30%')).toBeInTheDocument();
      });
    });

    it('shows "no spending data" when budget has lines but no matching transactions', async () => {
      const budgetId = await seedBudget();
      await seedLine(budgetId);
      // No transactions seeded — summary will be non-empty (lines exist) but spent = 0
      // The component only shows "no spending data" when summary array is empty (no lines).
      // With lines present the progress bars show 0% — verify 0% is shown instead.
      renderWithProviders(<Budget />);
      await waitFor(() => {
        expect(screen.getByText('0%')).toBeInTheDocument();
      });
    });

    it('renders rollover toggle button per line', async () => {
      const budgetId = await seedBudget();
      await seedLine(budgetId, { rollover: 0 });
      renderWithProviders(<Budget />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /rollover/i })).toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('budget selector tabs', () => {
    it('renders a tab per budget when multiple exist', async () => {
      await seedBudget({ id: 'b1', name: 'Monthly' });
      await seedBudget({ id: 'b2', name: 'Annual', period_type: 'annual' });
      renderWithProviders(<Budget />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Monthly' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Annual' })).toBeInTheDocument();
      });
    });

    it('does not render tabs for a single budget', async () => {
      await seedBudget({ name: 'Solo' });
      renderWithProviders(<Budget />);
      await waitFor(() => {
        // Budget name appears in the card heading but not as a tab button
        expect(screen.queryAllByRole('button', { name: 'Solo' })).toHaveLength(0);
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('create form', () => {
    it('opens the form when "+ New Budget" is clicked', async () => {
      const user = userEvent.setup();
      renderWithProviders(<Budget />);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /new budget/i })).toBeInTheDocument()
      );
      await user.click(screen.getByRole('button', { name: /new budget/i }));
      expect(screen.getByText(/new budget/i, { selector: 'h3' })).toBeInTheDocument();
    });

    it('shows name input, period select, and a line row', async () => {
      const user = userEvent.setup();
      renderWithProviders(<Budget />);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /new budget/i })).toBeInTheDocument()
      );
      await user.click(screen.getByRole('button', { name: /new budget/i }));
      expect(screen.getByLabelText(/budget name/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/period/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/category \/ line name/i)).toBeInTheDocument();
    });

    it('shows custom date fields only when period is "custom"', async () => {
      const user = userEvent.setup();
      renderWithProviders(<Budget />);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /new budget/i })).toBeInTheDocument()
      );
      await user.click(screen.getByRole('button', { name: /new budget/i }));
      expect(screen.queryByLabelText(/start date/i)).not.toBeInTheDocument();
      await user.selectOptions(screen.getByLabelText(/period/i), 'custom');
      expect(screen.getByLabelText(/start date/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/end date/i)).toBeInTheDocument();
    });

    it('"+ Add line" appends a new line row', async () => {
      const user = userEvent.setup();
      renderWithProviders(<Budget />);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /new budget/i })).toBeInTheDocument()
      );
      await user.click(screen.getByRole('button', { name: /new budget/i }));
      const before = screen.getAllByPlaceholderText(/category \/ line name/i).length;
      await user.click(screen.getByRole('button', { name: /add line/i }));
      expect(screen.getAllByPlaceholderText(/category \/ line name/i)).toHaveLength(before + 1);
    });

    it('shows a validation error when name is empty', async () => {
      const user = userEvent.setup();
      renderWithProviders(<Budget />);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /new budget/i })).toBeInTheDocument()
      );
      await user.click(screen.getByRole('button', { name: /new budget/i }));
      await user.click(screen.getByRole('button', { name: /save budget/i }));
      await waitFor(() => {
        expect(screen.getByText(/budget name is required/i)).toBeInTheDocument();
      });
    });

    it('shows a validation error when no valid lines are provided', async () => {
      const user = userEvent.setup();
      renderWithProviders(<Budget />);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /new budget/i })).toBeInTheDocument()
      );
      await user.click(screen.getByRole('button', { name: /new budget/i }));
      await user.type(screen.getByLabelText(/budget name/i), 'My Budget');
      // Line name and amount left blank
      await user.click(screen.getByRole('button', { name: /save budget/i }));
      await waitFor(() => {
        expect(screen.getByText(/at least one budget line/i)).toBeInTheDocument();
      });
    });

    it('persists a new budget and lines to the real DB on save', async () => {
      const user = userEvent.setup();
      renderWithProviders(<Budget />);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /new budget/i })).toBeInTheDocument()
      );
      await user.click(screen.getByRole('button', { name: /new budget/i }));
      await user.type(screen.getByLabelText(/budget name/i), 'Test Budget');
      await user.type(screen.getAllByPlaceholderText(/category \/ line name/i)[0], 'Food');
      await user.type(screen.getAllByPlaceholderText(/limit/i)[0], '300');
      await user.click(screen.getByRole('button', { name: /save budget/i }));

      await waitFor(async () => {
        const budgets = await client.raw.query('SELECT * FROM budgets WHERE name = ?', ['Test Budget']);
        expect(budgets).toHaveLength(1);
        const lines = await client.raw.query(
          'SELECT * FROM budget_lines WHERE budget_id = ?',
          [(budgets[0] as { id: string }).id]
        );
        expect(lines).toHaveLength(1);
        expect((lines[0] as { limit_amount: number }).limit_amount).toBe(300);

        // Category must be created so transactions can be tagged to it
        const cats = await client.raw.query<{ id: string; name: string }>(
          'SELECT id, name FROM categories WHERE name = ?',
          ['Food']
        );
        expect(cats).toHaveLength(1);
        expect((lines[0] as { category_id: string }).category_id).toBe(cats[0].id);
      });
    });

    it('shows a success banner and closes the form after save', async () => {
      const user = userEvent.setup();
      renderWithProviders(<Budget />);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /new budget/i })).toBeInTheDocument()
      );
      await user.click(screen.getByRole('button', { name: /new budget/i }));
      await user.type(screen.getByLabelText(/budget name/i), 'My Budget');
      await user.type(screen.getAllByPlaceholderText(/category \/ line name/i)[0], 'Bills');
      await user.type(screen.getAllByPlaceholderText(/limit/i)[0], '500');
      await user.click(screen.getByRole('button', { name: /save budget/i }));
      await waitFor(() => {
        expect(screen.getByText(/budget created/i)).toBeInTheDocument();
        expect(screen.queryByText(/new budget/i, { selector: 'h3' })).not.toBeInTheDocument();
      });
    });

    it('Cancel closes the form without writing to the DB', async () => {
      const user = userEvent.setup();
      renderWithProviders(<Budget />);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /new budget/i })).toBeInTheDocument()
      );
      await user.click(screen.getByRole('button', { name: /new budget/i }));
      await user.type(screen.getByLabelText(/budget name/i), 'Abandoned');
      await user.click(screen.getByRole('button', { name: /cancel/i }));
      expect(screen.queryByText(/new budget/i, { selector: 'h3' })).not.toBeInTheDocument();
      const rows = await client.raw.query('SELECT * FROM budgets WHERE name = ?', ['Abandoned']);
      expect(rows).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('rollover toggle', () => {
    it('flips rollover to true in the DB when toggled on', async () => {
      const user = userEvent.setup();
      const budgetId = await seedBudget();
      const lineId = await seedLine(budgetId, { rollover: 0 });
      renderWithProviders(<Budget />);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /rollover/i })).toBeInTheDocument()
      );
      await user.click(screen.getByRole('button', { name: /rollover/i }));
      await waitFor(async () => {
        const rows = await client.raw.query<{ rollover: number }>(
          'SELECT rollover FROM budget_lines WHERE id = ?',
          [lineId]
        );
        expect(rows[0].rollover).toBe(1);
      });
    });

    it('flips rollover back to false in the DB when toggled off', async () => {
      const user = userEvent.setup();
      const budgetId = await seedBudget();
      const lineId = await seedLine(budgetId, { rollover: 1 });
      renderWithProviders(<Budget />);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /↻ rollover/i })).toBeInTheDocument()
      );
      await user.click(screen.getByRole('button', { name: /↻ rollover/i }));
      await waitFor(async () => {
        const rows = await client.raw.query<{ rollover: number }>(
          'SELECT rollover FROM budget_lines WHERE id = ?',
          [lineId]
        );
        expect(rows[0].rollover).toBe(0);
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('delete budget', () => {
    it('removes budget and its lines from the DB when confirmed', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      const user = userEvent.setup();
      const budgetId = await seedBudget();
      await seedLine(budgetId);
      renderWithProviders(<Budget />);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
      );
      await user.click(screen.getByRole('button', { name: /delete/i }));
      await waitFor(async () => {
        const budgets = await client.raw.query('SELECT * FROM budgets WHERE id = ?', [budgetId]);
        expect(budgets).toHaveLength(0);
        // budget_lines cascade-delete
        const lines = await client.raw.query('SELECT * FROM budget_lines WHERE budget_id = ?', [budgetId]);
        expect(lines).toHaveLength(0);
      });
    });

    it('leaves the DB untouched when confirm is cancelled', async () => {
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      const user = userEvent.setup();
      const budgetId = await seedBudget();
      renderWithProviders(<Budget />);
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /delete/i })).toBeInTheDocument()
      );
      await user.click(screen.getByRole('button', { name: /delete/i }));
      const rows = await client.raw.query('SELECT * FROM budgets WHERE id = ?', [budgetId]);
      expect(rows).toHaveLength(1);
    });
  });
});
