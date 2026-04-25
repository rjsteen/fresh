/**
 * Transactions page tests — uses a real in-memory SQLite database.
 *
 * fetchTxPage builds raw SQL queries against db.raw, so seeding the DB and
 * querying through the component exercises the full SQL path.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach, type Mock } from 'vitest';
import { format } from 'date-fns';
import { Transactions } from './Transactions';
import { renderWithProviders } from '../test/renderWithProviders';
import { makeTestDb } from '../test/makeTestDb';
import type { DbClient } from '@fresh/core/db';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../App', () => ({ useDb: vi.fn() }));

import { useDb } from '../App';

// ---------------------------------------------------------------------------
// Global fetch stub
// ---------------------------------------------------------------------------

beforeAll(() => {
  vi.stubGlobal('fetch', async () =>
    new Response(JSON.stringify({ jobs: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
});

afterAll(() => vi.unstubAllGlobals());

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
// The default filter range is [3 months ago, today], so we seed within that
// window so transactions are visible without overriding filters.
// ---------------------------------------------------------------------------

const TODAY = format(new Date(), 'yyyy-MM-dd');

async function seedAccount(id = 'acc-1') {
  await client.raw.execute(
    `INSERT INTO accounts (id, name, institution, type, currency, current_balance, connection_type)
     VALUES (?, 'Test Bank', 'Test', 'checking', 'USD', 0, 'manual')`,
    [id]
  );
}

async function seedCategory(id: string, name: string) {
  await client.raw.execute(
    `INSERT INTO categories (id, name) VALUES (?, ?)`,
    [id, name]
  );
}

async function seedTransaction(opts: {
  id?: string;
  accountId?: string;
  amount?: number;
  description?: string;
  merchantName?: string | null;
  categoryId?: string | null;
  date?: string;
  pending?: boolean;
  mlConfidence?: number | null;
  categorySource?: string | null;
}) {
  await client.raw.execute(
    `INSERT INTO transactions
       (id, account_id, amount, currency, description, merchant_name, category_id,
        category_source, ml_confidence, date, pending)
     VALUES (?, ?, ?, 'USD', ?, ?, ?, ?, ?, ?, ?)`,
    [
      opts.id ?? crypto.randomUUID(),
      opts.accountId ?? 'acc-1',
      opts.amount ?? -10,
      opts.description ?? 'Test transaction',
      opts.merchantName ?? null,
      opts.categoryId ?? null,
      opts.categorySource ?? null,
      opts.mlConfidence ?? null,
      opts.date ?? TODAY,
      opts.pending ? 1 : 0,
    ]
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Transactions', () => {
  describe('empty state', () => {
    it('shows "No transactions match your filters" when DB is empty', async () => {
      renderWithProviders(<Transactions />);
      await waitFor(() => {
        expect(screen.getByText(/no transactions match/i)).toBeInTheDocument();
      });
    });
  });

  describe('transaction list', () => {
    beforeEach(() => seedAccount());

    it('renders the page heading', async () => {
      renderWithProviders(<Transactions />);
      expect(screen.getByRole('heading', { name: /transactions/i })).toBeInTheDocument();
    });

    it('shows merchant_name when present', async () => {
      await seedTransaction({ merchantName: 'Blue Bottle Coffee' });
      renderWithProviders(<Transactions />);
      await waitFor(() => {
        expect(screen.getByText('Blue Bottle Coffee')).toBeInTheDocument();
      });
    });

    it('falls back to description when merchant_name is null', async () => {
      await seedTransaction({ description: 'Amazon Purchase', merchantName: null });
      renderWithProviders(<Transactions />);
      await waitFor(() => {
        expect(screen.getByText('Amazon Purchase')).toBeInTheDocument();
      });
    });

    it('shows category chip with category name', async () => {
      await seedCategory('cat-1', 'Food & Drink');
      await seedTransaction({ categoryId: 'cat-1' });
      renderWithProviders(<Transactions />);
      await waitFor(() => {
        expect(screen.getByText('Food & Drink')).toBeInTheDocument();
      });
    });

    it('shows "Uncategorized" chip when no category linked', async () => {
      await seedTransaction({ categoryId: null });
      renderWithProviders(<Transactions />);
      await waitFor(() => {
        expect(screen.getByText('Uncategorized')).toBeInTheDocument();
      });
    });

    it('shows a Pending badge for pending transactions', async () => {
      await seedTransaction({ pending: true });
      renderWithProviders(<Transactions />);
      await waitFor(() => {
        expect(screen.getByText('Pending')).toBeInTheDocument();
      });
    });

    it('shows debit amount with − prefix', async () => {
      await seedTransaction({ amount: -42.99, merchantName: 'Merchant A' });
      renderWithProviders(<Transactions />);
      await waitFor(() => {
        const amountCells = screen.getAllByRole('cell');
        const amountCell = amountCells.find((c) => c.textContent?.includes('42.99'));
        expect(amountCell?.textContent).toMatch(/−/);
      });
    });

    it('shows credit amount with + prefix', async () => {
      await seedTransaction({ amount: 500, merchantName: 'Salary' });
      renderWithProviders(<Transactions />);
      await waitFor(() => {
        const amountCells = screen.getAllByRole('cell');
        const amountCell = amountCells.find((c) => c.textContent?.includes('500'));
        expect(amountCell?.textContent).toMatch(/\+/);
      });
    });

    it('renders the Export CSV button', async () => {
      renderWithProviders(<Transactions />);
      expect(screen.getByRole('button', { name: /export csv/i })).toBeInTheDocument();
    });
  });

  describe('flow filter', () => {
    beforeEach(async () => {
      await seedAccount();
      await seedTransaction({ amount: -50, merchantName: 'Debit Merchant' });
      await seedTransaction({ amount: 200, merchantName: 'Credit Merchant' });
    });

    it('shows both debits and credits by default', async () => {
      renderWithProviders(<Transactions />);
      await waitFor(() => {
        expect(screen.getByText('Debit Merchant')).toBeInTheDocument();
        expect(screen.getByText('Credit Merchant')).toBeInTheDocument();
      });
    });

    it('shows only debits when Debits filter is selected', async () => {
      renderWithProviders(<Transactions />);
      await userEvent.click(await screen.findByRole('button', { name: /^debits$/i }));
      await waitFor(() => {
        expect(screen.getByText('Debit Merchant')).toBeInTheDocument();
        expect(screen.queryByText('Credit Merchant')).not.toBeInTheDocument();
      });
    });

    it('shows only credits when Credits filter is selected', async () => {
      renderWithProviders(<Transactions />);
      await userEvent.click(await screen.findByRole('button', { name: /^credits$/i }));
      await waitFor(() => {
        expect(screen.getByText('Credit Merchant')).toBeInTheDocument();
        expect(screen.queryByText('Debit Merchant')).not.toBeInTheDocument();
      });
    });
  });

  describe('date range filter', () => {
    beforeEach(async () => {
      await seedAccount();
      // Outside default range (older than 3 months)
      await seedTransaction({ merchantName: 'Old Transaction', date: '2020-01-01' });
      // Inside default range
      await seedTransaction({ merchantName: 'Recent Transaction', date: TODAY });
    });

    it('shows recent transaction and hides old one with default filters', async () => {
      renderWithProviders(<Transactions />);
      await waitFor(() => {
        expect(screen.getByText('Recent Transaction')).toBeInTheDocument();
        expect(screen.queryByText('Old Transaction')).not.toBeInTheDocument();
      });
    });

    it('shows old transaction when start date is set to include it', async () => {
      renderWithProviders(<Transactions />);
      const startInput = screen.getAllByDisplayValue(/\d{4}-\d{2}-\d{2}/)[0];
      await userEvent.clear(startInput);
      await userEvent.type(startInput, '2019-01-01');
      startInput.blur();
      await waitFor(() => {
        expect(screen.getByText('Old Transaction')).toBeInTheDocument();
      });
    });
  });

  describe('pagination', () => {
    beforeEach(async () => {
      await seedAccount();
    });

    it('Previous button is disabled on the first page', async () => {
      await seedTransaction({ merchantName: 'Tx 1' });
      renderWithProviders(<Transactions />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /← prev/i })).toBeDisabled();
      });
    });

    it('Next button is disabled when fewer than 50 transactions exist', async () => {
      await seedTransaction({ merchantName: 'Only Tx' });
      renderWithProviders(<Transactions />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /next →/i })).toBeDisabled();
      });
    });

    it('Next button is enabled when 51+ transactions are in the result set', async () => {
      for (let i = 0; i < 51; i++) {
        await seedTransaction({ merchantName: `Tx ${i}`, date: TODAY });
      }
      renderWithProviders(<Transactions />);
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /next →/i })).not.toBeDisabled();
      });
    });

    it('navigates to next page on Next click', async () => {
      for (let i = 0; i < 51; i++) {
        await seedTransaction({ merchantName: `Merchant ${String(i).padStart(3, '0')}`, date: TODAY });
      }
      renderWithProviders(<Transactions />);

      // Wait for initial load
      await waitFor(() => expect(screen.getByText(/showing 1–50/i)).toBeInTheDocument());
      await userEvent.click(screen.getByRole('button', { name: /next →/i }));

      await waitFor(() => {
        expect(screen.getByText(/showing 51/i)).toBeInTheDocument();
      });
    });
  });
});
