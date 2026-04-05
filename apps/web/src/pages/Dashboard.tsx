import React, { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import {
  getAccounts,
  getTransactions,
  getSpendingByCategory,
  getBudgetSummary,
} from '@fresh/core/db';
import { useDb } from '../App';

const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#3b82f6'];

function currency(n: number, curr = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: curr }).format(n);
}

export function Dashboard() {
  const db = useDb();
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

  const totalBalance = useMemo(
    () => accounts.reduce((sum, a) => sum + a.current_balance, 0),
    [accounts]
  );

  const totalSpend = useMemo(
    () => spending.reduce((sum, s) => sum + s.total, 0),
    [spending]
  );

  // Build daily spend trend for the last 30 days
  const { data: trendTx = [] } = useQuery({
    queryKey: ['transactions', 'trend'],
    queryFn: () =>
      getTransactions(db.raw, {
        start_date: format(subMonths(now, 1), 'yyyy-MM-dd'),
        end_date: format(now, 'yyyy-MM-dd'),
        limit: 500,
      }),
  });

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
    <div className="dashboard">
      {/* Summary cards */}
      <div className="card-row">
        <div className="card">
          <div className="card-label">Net Worth</div>
          <div className="card-value">{currency(totalBalance)}</div>
        </div>
        <div className="card">
          <div className="card-label">Spent This Month</div>
          <div className="card-value">{currency(totalSpend)}</div>
        </div>
        <div className="card">
          <div className="card-label">Accounts</div>
          <div className="card-value">{accounts.length}</div>
        </div>
      </div>

      <div className="chart-row">
        {/* Daily spend trend */}
        <div className="chart-card" style={{ flex: 2 }}>
          <h3>Daily Spending</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => `$${v}`} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => currency(v)} />
              <Area
                type="monotone"
                dataKey="amount"
                stroke="#6366f1"
                fill="url(#spendGrad)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Spending by category */}
        <div className="chart-card" style={{ flex: 1 }}>
          <h3>By Category</h3>
          {spending.length === 0 ? (
            <p className="empty-state">No transactions this month</p>
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
                  label={({ name, pct_of_total }) => `${name ?? 'Other'} ${pct_of_total}%`}
                  labelLine={false}
                >
                  {spending.slice(0, 6).map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v: number) => currency(v)} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Recent transactions */}
      <div className="card" style={{ marginTop: 24 }}>
        <h3>Recent Transactions</h3>
        <table className="tx-table">
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
                <td>{tx.category_id ?? '—'}</td>
                <td
                  style={{
                    textAlign: 'right',
                    color: tx.amount >= 0 ? '#10b981' : '#f87171',
                  }}
                >
                  {currency(tx.amount)}
                </td>
              </tr>
            ))}
            {recentTx.length === 0 && (
              <tr>
                <td colSpan={4} className="empty-state">
                  No transactions yet — connect a bank account
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
