/**
 * Dashboard page tests — uses a real in-memory SQLite database via sql.js.
 * No SQL mocking; queries run against actual SQLite so schema regressions are caught.
 */
import { screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach, type Mock } from 'vitest';
import { format, startOfMonth, subDays } from 'date-fns';
import { Dashboard } from './Dashboard';
import { renderWithProviders } from '../test/renderWithProviders';
import { makeTestDb } from '../test/makeTestDb';
import type { DbClient } from '@fresh/core/db';

// ---------------------------------------------------------------------------
// Mock only the React context hook — real DbClient is injected per-test
// ---------------------------------------------------------------------------

vi.mock('../App', () => ({ useDb: vi.fn() }));

// Stub fetch so the sync-jobs API call never fires network requests in tests
beforeAll(() => {
  vi.stubGlobal('fetch', async () => ({
    ok: true,
    json: async () => ({ jobs: [] }),
  }));
});

afterAll(() => {
  vi.unstubAllGlobals();
});

import { useDb } from '../App';

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

async function seedAccount(id: string, balance: number) {
  await client.raw.execute(
    `INSERT INTO accounts (id, name, institution, type, currency, current_balance, connection_type)
     VALUES (?, 'Test Bank', 'Test', 'checking', 'USD', ?, 'manual')`,
    [id, balance]
  );
}

async function seedTransaction(
  accountId: string,
  amount: number,
  date: string,
  opts: { merchantName?: string; categoryId?: string; pending?: boolean } = {}
) {
  await client.raw.execute(
    `INSERT INTO transactions
       (id, account_id, amount, currency, description, merchant_name, category_id, date, pending)
     VALUES (?, ?, ?, 'USD', 'test txn', ?, ?, ?, ?)`,
    [
      crypto.randomUUID(),
      accountId,
      amount,
      opts.merchantName ?? null,
      opts.categoryId ?? null,
      date,
      opts.pending ? 1 : 0,
    ]
  );
}

async function seedCategory(id: string, name: string) {
  await client.raw.execute(
    `INSERT INTO categories (id, name) VALUES (?, ?)`,
    [id, name]
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Dashboard', () => {

  // -------------------------------------------------------------------------
  describe('empty state', () => {
    it('shows "No accounts yet" heading when DB has no accounts', async () => {
      renderWithProviders(<Dashboard />);
      await waitFor(() => {
        expect(screen.getByText(/no accounts yet/i)).toBeInTheDocument();
      });
    });

    it('shows a "Connect a bank" link pointing to /accounts', async () => {
      renderWithProviders(<Dashboard />);
      await waitFor(() => {
        const link = screen.getByRole('link', { name: /connect a bank/i });
        expect(link).toBeInTheDocument();
        expect(link).toHaveAttribute('href', '/accounts');
      });
    });

    it('shows dashes in all three summary cards when no accounts', async () => {
      renderWithProviders(<Dashboard />);
      await waitFor(() => {
        expect(screen.getByTestId('net-worth')).toHaveTextContent('—');
        expect(screen.getByTestId('month-spend')).toHaveTextContent('—');
        expect(screen.getByTestId('account-count')).toHaveTextContent('—');
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('summary cards', () => {
    it('shows account count from the local DB', async () => {
      await seedAccount('acc-1', 0);
      await seedAccount('acc-2', 0);
      renderWithProviders(<Dashboard />);
      await waitFor(() => {
        expect(screen.getByTestId('account-count')).toHaveTextContent('2');
      });
    });

    it('shows net worth as sum of current_balance across all accounts', async () => {
      await seedAccount('acc-1', 1000);
      await seedAccount('acc-2', 500.50);
      renderWithProviders(<Dashboard />);
      await waitFor(() => {
        // formatCurrency produces something like "$1,500.50"
        expect(screen.getByTestId('net-worth').textContent).toMatch(/1[,.]?500/);
      });
    });

    it('shows net worth of zero when all balances are 0', async () => {
      await seedAccount('acc-1', 0);
      renderWithProviders(<Dashboard />);
      await waitFor(() => {
        expect(screen.getByTestId('net-worth').textContent).toMatch(/0\.00|0,00/);
      });
    });

    it('sums only non-pending debits from the current month for month spend', async () => {
      await seedAccount('acc-1', 0);
      const today = format(new Date(), 'yyyy-MM-dd');
      const monthStart = format(startOfMonth(new Date()), 'yyyy-MM-dd');
      const lastMonth = format(subDays(startOfMonth(new Date()), 1), 'yyyy-MM-dd');

      await seedTransaction('acc-1', -50, today);                         // counts
      await seedTransaction('acc-1', -30, monthStart);                    // counts
      await seedTransaction('acc-1', -20, lastMonth);                     // excluded: last month
      await seedTransaction('acc-1', 100, today);                         // excluded: credit
      await seedTransaction('acc-1', -15, today, { pending: true });      // excluded: pending

      renderWithProviders(<Dashboard />);
      await waitFor(() => {
        // sum = 50 + 30 = 80
        expect(screen.getByTestId('month-spend').textContent).toMatch(/80/);
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('recent transactions table', () => {
    it('shows the "Recent Transactions" section (not empty state) when accounts exist', async () => {
      await seedAccount('acc-1', 0);
      renderWithProviders(<Dashboard />);
      await waitFor(() => {
        expect(screen.queryByText(/no accounts yet/i)).not.toBeInTheDocument();
        // SectionHeading always renders when accounts exist
        expect(screen.getByText(/recent transactions/i)).toBeInTheDocument();
      });
    });

    it('shows "No transactions yet" when accounts exist but no transactions', async () => {
      await seedAccount('acc-1', 0);
      renderWithProviders(<Dashboard />);
      await waitFor(() => {
        expect(screen.getByText(/no transactions yet/i)).toBeInTheDocument();
      });
    });

    it('shows merchant_name when present', async () => {
      await seedAccount('acc-1', 0);
      await seedTransaction('acc-1', -12.50, format(new Date(), 'yyyy-MM-dd'), {
        merchantName: 'Blue Bottle Coffee',
      });
      renderWithProviders(<Dashboard />);
      await waitFor(() => {
        expect(screen.getByText('Blue Bottle Coffee')).toBeInTheDocument();
      });
    });

    it('falls back to description when merchant_name is null', async () => {
      await seedAccount('acc-1', 0);
      // description defaults to 'test txn' in seedTransaction
      await seedTransaction('acc-1', -8, format(new Date(), 'yyyy-MM-dd'));
      renderWithProviders(<Dashboard />);
      await waitFor(() => {
        expect(screen.getByText('test txn')).toBeInTheDocument();
      });
    });

    it('shows the formatted amount for a debit', async () => {
      await seedAccount('acc-1', 500);
      await seedTransaction('acc-1', -42.99, format(new Date(), 'yyyy-MM-dd'), {
        merchantName: 'Grocery',
      });
      renderWithProviders(<Dashboard />);
      await waitFor(() => {
        // The Amount span renders with a Unicode minus prefix — unique to the table column
        // (the month-spend card would show $42.99 but NOT the '−' prefix)
        const amountEl = screen.getByText((_, el) =>
          el?.tagName === 'SPAN' && (el.textContent ?? '').includes('42.99')
        );
        expect(amountEl).toBeInTheDocument();
      });
    });

    it('shows category name when a category is linked', async () => {
      await seedAccount('acc-1', 0);
      await seedCategory('cat-food', 'Food & Drink');
      await seedTransaction('acc-1', -20, format(new Date(), 'yyyy-MM-dd'), {
        categoryId: 'cat-food',
      });
      renderWithProviders(<Dashboard />);
      await waitFor(() => {
        expect(screen.getByText('Food & Drink')).toBeInTheDocument();
      });
    });

    it('shows a dash for category when none is linked', async () => {
      await seedAccount('acc-1', 0);
      await seedTransaction('acc-1', -5, format(new Date(), 'yyyy-MM-dd'));
      renderWithProviders(<Dashboard />);
      await waitFor(() => {
        // The uncategorized dash in the category column
        expect(screen.getByRole('cell', { name: '—' })).toBeInTheDocument();
      });
    });

    it('limits recent transactions to 10 rows', async () => {
      await seedAccount('acc-1', 0);
      const today = format(new Date(), 'yyyy-MM-dd');
      for (let i = 0; i < 12; i++) {
        await seedTransaction('acc-1', -(i + 1), today, { merchantName: `Merchant ${i + 1}` });
      }
      renderWithProviders(<Dashboard />);
      await waitFor(() => {
        // 10 rows + 1 header row = 11 tr elements
        const rows = screen.getAllByRole('row');
        // header + 10 data rows
        expect(rows.length).toBe(11);
      });
    });
  });
});
