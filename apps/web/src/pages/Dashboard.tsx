import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import styled, { useTheme } from 'styled-components';
import {
  getAccounts,
  getTransactions,
  getSpendingByCategory,
} from '@fresh/core/db';
import { useDb } from '../App';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function currency(n: number, curr = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: curr }).format(n);
}

// ---------------------------------------------------------------------------
// Styled components
// ---------------------------------------------------------------------------

const Page = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.space[6]};
  max-width: 1100px;
`;

const PageTitle = styled.h2`
  font-size: ${({ theme }) => theme.font.size.xl};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  color: ${({ theme }) => theme.color.text};
  margin-bottom: ${({ theme }) => theme.space[2]};
`;

const CardRow = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: ${({ theme }) => theme.space[4]};

  @media (max-width: 700px) {
    grid-template-columns: 1fr;
  }
`;

const Card = styled.div`
  background: ${({ theme }) => theme.color.surface};
  border: 1px solid ${({ theme }) => theme.color.border};
  border-radius: ${({ theme }) => theme.radius.lg};
  padding: ${({ theme }) => theme.space[5]};
  box-shadow: ${({ theme }) => theme.shadow.sm};
`;

const CardLabel = styled.div`
  font-size: ${({ theme }) => theme.font.size.sm};
  font-weight: ${({ theme }) => theme.font.weight.medium};
  color: ${({ theme }) => theme.color.textMuted};
  margin-bottom: ${({ theme }) => theme.space[2]};
  text-transform: uppercase;
  letter-spacing: 0.05em;
`;

const CardValue = styled.div`
  font-size: ${({ theme }) => theme.font.size['2xl']};
  font-weight: ${({ theme }) => theme.font.weight.bold};
  color: ${({ theme }) => theme.color.text};
  letter-spacing: -0.5px;
`;

const ChartRow = styled.div`
  display: flex;
  gap: ${({ theme }) => theme.space[4]};

  @media (max-width: 900px) {
    flex-direction: column;
  }
`;

const ChartCard = styled(Card)<{ $flex?: number }>`
  flex: ${({ $flex }) => $flex ?? 1};
  min-width: 0;

  h3 {
    font-size: ${({ theme }) => theme.font.size.md};
    font-weight: ${({ theme }) => theme.font.weight.semibold};
    color: ${({ theme }) => theme.color.text};
    margin-bottom: ${({ theme }) => theme.space[4]};
  }
`;

const TxCard = styled(Card)``;

const TxTable = styled.table`
  width: 100%;
  border-collapse: collapse;

  thead tr {
    border-bottom: 1.5px solid ${({ theme }) => theme.color.border};
  }

  th {
    font-size: ${({ theme }) => theme.font.size.xs};
    font-weight: ${({ theme }) => theme.font.weight.semibold};
    color: ${({ theme }) => theme.color.textMuted};
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: ${({ theme }) => `${theme.space[2]} ${theme.space[3]}`};
    text-align: left;
  }

  td {
    padding: ${({ theme }) => `${theme.space[3]} ${theme.space[3]}`};
    font-size: ${({ theme }) => theme.font.size.base};
    color: ${({ theme }) => theme.color.text};
    border-bottom: 1px solid ${({ theme }) => theme.color.border};
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  tbody tr:hover td {
    background: ${({ theme }) => theme.color.green50};
  }

  tbody tr.pending td {
    opacity: 0.55;
    font-style: italic;
  }
`;

const AmountCell = styled.td<{ $positive: boolean }>`
  text-align: right !important;
  font-variant-numeric: tabular-nums;
  font-weight: ${({ theme }) => theme.font.weight.medium};
  color: ${({ $positive, theme }) =>
    $positive ? theme.color.success : theme.color.danger} !important;
`;

const CategoryChip = styled.span`
  display: inline-block;
  padding: 2px ${({ theme }) => theme.space[2]};
  background: ${({ theme }) => theme.color.green50};
  border: 1px solid ${({ theme }) => theme.color.green100};
  border-radius: ${({ theme }) => theme.radius.full};
  font-size: ${({ theme }) => theme.font.size.xs};
  color: ${({ theme }) => theme.color.green700};
  font-weight: ${({ theme }) => theme.font.weight.medium};
`;

const EmptyState = styled.td`
  text-align: center !important;
  color: ${({ theme }) => theme.color.textMuted} !important;
  padding: ${({ theme }) => theme.space[8]} !important;
  font-size: ${({ theme }) => theme.font.size.sm} !important;
`;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Dashboard() {
  const db = useDb();
  const theme = useTheme();
  const now = new Date();
  const monthStart = format(startOfMonth(now), 'yyyy-MM-dd');
  const monthEnd = format(endOfMonth(now), 'yyyy-MM-dd');

  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => getAccounts(db.raw),
  });

  const { data: recentTx = [] } = useQuery({
    queryKey: ['transactions', 'recent'],
    queryFn: () => getTransactions(db.raw, { limit: 10 }),
  });

  const { data: spending = [] } = useQuery({
    queryKey: ['spending', monthStart, monthEnd],
    queryFn: () => getSpendingByCategory(db.raw, monthStart, monthEnd),
  });

  const { data: trendTx = [] } = useQuery({
    queryKey: ['transactions', 'trend'],
    queryFn: () =>
      getTransactions(db.raw, {
        start_date: format(subMonths(now, 1), 'yyyy-MM-dd'),
        end_date: format(now, 'yyyy-MM-dd'),
        limit: 500,
      }),
  });

  const totalBalance = useMemo(
    () => accounts.reduce((sum, a) => sum + a.current_balance, 0),
    [accounts]
  );

  const totalSpend = useMemo(
    () => spending.reduce((sum, s) => sum + s.total, 0),
    [spending]
  );

  const trendData = useMemo(() => {
    const byDay: Record<string, number> = {};
    for (const tx of trendTx) {
      if (tx.amount >= 0) continue;
      byDay[tx.date] = (byDay[tx.date] ?? 0) + Math.abs(tx.amount);
    }
    return Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amount]) => ({ date: format(new Date(date), 'MMM d'), amount }));
  }, [trendTx]);

  return (
    <Page>
      <PageTitle>Dashboard</PageTitle>

      {/* Summary cards */}
      <CardRow>
        <Card>
          <CardLabel>Net Worth</CardLabel>
          <CardValue>{currency(totalBalance)}</CardValue>
        </Card>
        <Card>
          <CardLabel>Spent This Month</CardLabel>
          <CardValue>{currency(totalSpend)}</CardValue>
        </Card>
        <Card>
          <CardLabel>Accounts</CardLabel>
          <CardValue>{accounts.length}</CardValue>
        </Card>
      </CardRow>

      {/* Charts */}
      <ChartRow>
        <ChartCard $flex={2}>
          <h3>Daily Spending</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={theme.color.green400} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={theme.color.green400} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={theme.color.border} />
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: theme.color.textMuted }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={(v) => `$${v}`}
                tick={{ fontSize: 11, fill: theme.color.textMuted }}
                axisLine={false}
                tickLine={false}
                width={50}
              />
              <Tooltip
                formatter={(v: number) => [currency(v), 'Spent']}
                contentStyle={{
                  background: theme.color.surface,
                  border: `1px solid ${theme.color.border}`,
                  borderRadius: theme.radius.md,
                  boxShadow: theme.shadow.md,
                  fontSize: 13,
                }}
              />
              <Area
                type="monotone"
                dataKey="amount"
                stroke={theme.color.green500}
                fill="url(#spendGrad)"
                strokeWidth={2}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard $flex={1}>
          <h3>By Category</h3>
          {spending.length === 0 ? (
            <p style={{ color: theme.color.textMuted, fontSize: theme.font.size.sm, marginTop: '40px', textAlign: 'center' }}>
              No transactions this month
            </p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={spending.slice(0, 6)}
                  dataKey="total"
                  nameKey="category_name"
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  innerRadius={44}
                  paddingAngle={3}
                  label={({ name, pct_of_total }) => `${name ?? 'Other'} ${pct_of_total}%`}
                  labelLine={false}
                >
                  {spending.slice(0, 6).map((_, i) => (
                    <Cell key={i} fill={theme.color.chart[i % theme.color.chart.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v: number) => [currency(v), '']}
                  contentStyle={{
                    background: theme.color.surface,
                    border: `1px solid ${theme.color.border}`,
                    borderRadius: theme.radius.md,
                    boxShadow: theme.shadow.md,
                    fontSize: 13,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </ChartRow>

      {/* Recent transactions */}
      <TxCard>
        <h3 style={{ marginBottom: '16px' }}>Recent Transactions</h3>
        <TxTable>
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Category</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {recentTx.map((tx) => (
              <tr key={tx.id} className={tx.pending ? 'pending' : ''}>
                <td>{tx.date}</td>
                <td>{tx.merchant_name ?? tx.description}</td>
                <td>
                  {tx.category_id ? (
                    <CategoryChip>{tx.category_id}</CategoryChip>
                  ) : '—'}
                </td>
                <AmountCell $positive={tx.amount >= 0}>
                  {currency(tx.amount)}
                </AmountCell>
              </tr>
            ))}
            {recentTx.length === 0 && (
              <tr>
                <EmptyState colSpan={4}>
                  No transactions yet — connect a bank account to get started
                </EmptyState>
              </tr>
            )}
          </tbody>
        </TxTable>
      </TxCard>
    </Page>
  );
}
