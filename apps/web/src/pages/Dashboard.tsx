import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { format, startOfMonth } from 'date-fns';
import { API, authHeaders } from '../utils/api';
import { useDb } from '../App';
import { getAccounts } from '@fresh/core/db';
import type { Account } from '@fresh/core/db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SyncJob {
  id: string;
  connection_type: string;
  status: string;
  last_synced_at: string | null;
  sync_schedule: string;
}

interface RecentTx {
  id: string;
  date: string;
  merchant_name: string | null;
  description: string;
  amount: number;
  currency: string;
  pending: number;
  category_name: string | null;
}

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Page = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space[6]};
  max-width: 860px;
`;

const PageTitle = styled.h2`
  font-size: ${({ theme }) => theme.font.size.xl};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  color: ${({ theme }) => theme.color.text};
`;

const CardRow = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: ${({ theme }) => theme.space[4]};
`;

const Card = styled.div`
  background: ${({ theme }) => theme.color.surface};
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: ${({ theme }) => theme.space[5]};
`;

const CardLabel = styled.div`
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  color: ${({ theme }) => theme.color.textMuted};
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: ${({ theme }) => theme.space[2]};
`;

const CardValue = styled.div`
  font-size: ${({ theme }) => theme.font.size['2xl']};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  color: ${({ theme }) => theme.color.text};
  letter-spacing: -0.5px;
`;

const EmptyState = styled.div`
  background: ${({ theme }) => theme.color.green50};
  border: 1px solid ${({ theme }) => theme.color.green100};
  border-radius: ${({ theme }) => theme.radius.xl};
  padding: ${({ theme }) => theme.space[8]};
  text-align: center;
`;

const EmptyStateTitle = styled.h3`
  font-size: ${({ theme }) => theme.font.size.lg};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.color.text};
  margin-bottom: ${({ theme }) => theme.space[2]};
`;

const EmptyStateBody = styled.p`
  font-size: ${({ theme }) => theme.font.size.base};
  color: ${({ theme }) => theme.color.textMuted};
  max-width: 420px;
  margin: 0 auto ${({ theme }) => theme.space[5]};
  line-height: ${({ theme }) => theme.font.lineHeight.relaxed};
`;

const CTALink = styled(Link)`
  display: inline-block;
  background: ${({ theme }) => theme.color.green500};
  color: ${({ theme }) => theme.color.textInvert};
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  padding: ${({ theme }) => `${theme.space[2]} ${theme.space[5]}`};
  border-radius: ${({ theme }) => theme.radius.md};
  text-decoration: none;

  &:hover {
    background: ${({ theme }) => theme.color.green600};
  }
`;

const SectionHeading = styled.div`
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.semibold};
  color: ${({ theme }) => theme.color.textMuted};
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: ${({ theme }) => theme.space[3]};
`;

const DataTable = styled.table`
  width: 100%;
  border-collapse: collapse;

  th {
    font-size: ${({ theme }) => theme.font.size.xs};
    font-weight: ${({ theme }) => theme.font.weight.semibold};
    color: ${({ theme }) => theme.color.textMuted};
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: ${({ theme }) => `${theme.space[2]} ${theme.space[3]}`};
    text-align: left;
    border-bottom: 1.5px solid ${({ theme }) => theme.color.border};
  }

  td {
    padding: ${({ theme }) => `${theme.space[3]} ${theme.space[3]}`};
    font-size: ${({ theme }) => theme.font.size.sm};
    color: ${({ theme }) => theme.color.text};
    border-bottom: 1px solid ${({ theme }) => theme.color.border};
  }

  tbody tr:last-child td {
    border-bottom: none;
  }
`;

const Amount = styled.span<{ $negative: boolean }>`
  font-weight: ${({ theme }) => theme.font.weight.medium};
  color: ${({ $negative, theme }) =>
    $negative ? theme.color.danger : theme.color.green600};
`;

const StatusBadge = styled.span<{ $status: string }>`
  display: inline-block;
  padding: 2px ${({ theme }) => theme.space[2]};
  border-radius: ${({ theme }) => theme.radius.full};
  font-size: ${({ theme }) => theme.font.size.xs};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  background: ${({ $status, theme }) =>
    $status === 'active' ? theme.color.green50 : theme.color.dangerBg};
  color: ${({ $status, theme }) =>
    $status === 'active' ? theme.color.green700 : theme.color.danger};
  border: 1px solid ${({ $status, theme }) =>
    $status === 'active' ? theme.color.green100 : `${theme.color.danger}33`};
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Dashboard() {
  const db = useDb();

  const { data: jobs = [] } = useQuery<SyncJob[]>({
    queryKey: ['sync-jobs'],
    queryFn: async () => {
      const res = await fetch(`${API}/api/v1/sync/jobs`, { headers: authHeaders() });
      if (!res.ok) throw new Error('Failed to fetch sync jobs');
      const body = await res.json();
      return body.jobs ?? [];
    },
  });

  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ['dashboard-accounts'],
    queryFn: () => getAccounts(db.raw),
  });

  const { data: recentTxns = [] } = useQuery<RecentTx[]>({
    queryKey: ['dashboard-recent-txns'],
    queryFn: () =>
      db.raw.query<RecentTx>(
        `SELECT t.id, t.date, t.merchant_name, t.description, t.amount, t.currency,
                t.pending, c.name as category_name
         FROM transactions t
         LEFT JOIN categories c ON c.id = t.category_id
         ORDER BY t.date DESC, t.created_at DESC
         LIMIT 10`
      ),
  });

  const { data: monthSpend = 0 } = useQuery<number>({
    queryKey: ['dashboard-month-spend'],
    queryFn: async () => {
      const now = new Date();
      const start = format(startOfMonth(now), 'yyyy-MM-dd');
      const end = format(now, 'yyyy-MM-dd');
      const rows = await db.raw.query<{ total: number }>(
        `SELECT COALESCE(ABS(SUM(amount)), 0) as total
         FROM transactions
         WHERE amount < 0 AND pending = 0 AND date >= ? AND date <= ?`,
        [start, end]
      );
      return rows[0]?.total ?? 0;
    },
  });

  const netWorth = accounts.reduce((sum, a) => sum + a.current_balance, 0);
  const hasAccounts = accounts.length > 0;

  return (
    <Page>
      <PageTitle>Dashboard</PageTitle>

      <CardRow>
        <Card>
          <CardLabel>Net Worth</CardLabel>
          <CardValue data-testid="net-worth">
            {hasAccounts ? formatCurrency(netWorth) : '—'}
          </CardValue>
        </Card>
        <Card>
          <CardLabel>Spent This Month</CardLabel>
          <CardValue data-testid="month-spend">
            {hasAccounts ? formatCurrency(monthSpend) : '—'}
          </CardValue>
        </Card>
        <Card>
          <CardLabel>Accounts</CardLabel>
          <CardValue data-testid="account-count">
            {hasAccounts ? accounts.length : '—'}
          </CardValue>
        </Card>
      </CardRow>

      {!hasAccounts ? (
        <EmptyState>
          <EmptyStateTitle>No accounts yet</EmptyStateTitle>
          <EmptyStateBody>
            Connect a bank account to start tracking your finances. Your data stays on your device.
          </EmptyStateBody>
          <CTALink to="/accounts">Connect a bank</CTALink>
        </EmptyState>
      ) : (
        <Card>
          <SectionHeading>Recent Transactions</SectionHeading>
          {recentTxns.length === 0 ? (
            <p style={{ fontSize: '13px', color: '#7da98a', margin: 0 }}>No transactions yet.</p>
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Merchant</th>
                  <th>Category</th>
                  <th style={{ textAlign: 'right' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {recentTxns.map((tx) => (
                  <tr key={tx.id}>
                    <td>{format(new Date(tx.date), 'MMM d')}</td>
                    <td>{tx.merchant_name ?? tx.description}</td>
                    <td style={{ color: tx.category_name ? undefined : '#7da98a' }}>
                      {tx.category_name ?? '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Amount $negative={tx.amount < 0}>
                        {tx.amount < 0 ? '−' : '+'}
                        {formatCurrency(Math.abs(tx.amount), tx.currency)}
                      </Amount>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Card>
      )}

      {jobs.length > 0 && (
        <Card>
          <SectionHeading>Sync Jobs</SectionHeading>
          <DataTable>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Status</th>
                <th>Last Synced</th>
                <th>Schedule</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td>
                    {job.connection_type === 'gocardless' ? 'GoCardless' : 'SimpleFIN'}
                  </td>
                  <td>
                    <StatusBadge $status={job.status}>{job.status}</StatusBadge>
                  </td>
                  <td>
                    {job.last_synced_at
                      ? format(new Date(job.last_synced_at), 'MMM d, h:mm a')
                      : '—'}
                  </td>
                  <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                    {job.sync_schedule}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Card>
      )}
    </Page>
  );
}
