import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { LineChart } from 'react-native-gifted-charts';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import {
  getAccounts,
  getTransactions,
  getSpendingByCategory,
} from '@fresh/core/db';
import { useDb } from '../context/DbContext';

function currency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

export function DashboardScreen() {
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

  const chartData = useMemo(() => {
    const byDay: Record<string, number> = {};
    for (const tx of trendTx) {
      if (tx.amount >= 0) continue;
      byDay[tx.date] = (byDay[tx.date] ?? 0) + Math.abs(tx.amount);
    }
    return Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, value]) => ({ value }));
  }, [trendTx]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Balance card */}
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Net Worth</Text>
        <Text style={styles.balanceAmount}>{currency(totalBalance)}</Text>
        <Text style={styles.balanceSub}>{accounts.length} accounts</Text>
      </View>

      {/* Spending trend */}
      {chartData.length > 1 && (
        <View style={styles.chartCard}>
          <Text style={styles.sectionTitle}>Daily Spending (30 days)</Text>
          <LineChart
            data={chartData}
            color="#6366f1"
            thickness={2}
            hideDataPoints
            curved
            yAxisTextStyle={{ color: '#94a3b8', fontSize: 10 }}
            xAxisColor="#1e293b"
            yAxisColor="#1e293b"
            rulesColor="#1e293b"
            startFillColor="#6366f1"
            endFillColor="transparent"
            startOpacity={0.3}
            endOpacity={0}
            areaChart
            hideRules={false}
            adjustToWidth
          />
        </View>
      )}

      {/* Category breakdown */}
      {spending.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>This Month by Category</Text>
          {spending.slice(0, 5).map((s) => (
            <View key={s.category_id ?? 'other'} style={styles.categoryRow}>
              <Text style={styles.categoryName}>{s.category_name ?? 'Uncategorized'}</Text>
              <View style={styles.categoryBar}>
                <View style={[styles.categoryFill, { width: `${s.pct_of_total}%` as any }]} />
              </View>
              <Text style={styles.categoryAmount}>{currency(s.total)}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Recent transactions */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Recent Transactions</Text>
        {recentTx.map((tx) => (
          <View key={tx.id} style={styles.txRow}>
            <View style={styles.txInfo}>
              <Text style={styles.txName} numberOfLines={1}>
                {tx.merchant_name ?? tx.description}
              </Text>
              <Text style={styles.txDate}>{tx.date}</Text>
            </View>
            <Text style={[styles.txAmount, { color: tx.amount >= 0 ? '#10b981' : '#f87171' }]}>
              {currency(tx.amount)}
            </Text>
          </View>
        ))}
        {recentTx.length === 0 && (
          <Text style={styles.empty}>No transactions yet — connect a bank account</Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 16, paddingBottom: 40 },
  balanceCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 24,
    marginBottom: 16,
    alignItems: 'center',
  },
  balanceLabel: { color: '#94a3b8', fontSize: 14, marginBottom: 4 },
  balanceAmount: { color: '#f1f5f9', fontSize: 36, fontWeight: '700' },
  balanceSub: { color: '#64748b', fontSize: 12, marginTop: 4 },
  chartCard: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: { color: '#f1f5f9', fontSize: 16, fontWeight: '600', marginBottom: 12 },
  categoryRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  categoryName: { color: '#94a3b8', fontSize: 12, width: 90 },
  categoryBar: {
    flex: 1,
    height: 6,
    backgroundColor: '#334155',
    borderRadius: 3,
    marginHorizontal: 8,
    overflow: 'hidden',
  },
  categoryFill: { height: '100%', backgroundColor: '#6366f1', borderRadius: 3 },
  categoryAmount: { color: '#f1f5f9', fontSize: 12, width: 64, textAlign: 'right' },
  txRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  txInfo: { flex: 1, marginRight: 12 },
  txName: { color: '#f1f5f9', fontSize: 14 },
  txDate: { color: '#64748b', fontSize: 12, marginTop: 2 },
  txAmount: { fontSize: 14, fontWeight: '600' },
  empty: { color: '#64748b', textAlign: 'center', paddingVertical: 16 },
});
