import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { BarChart } from 'react-native-gifted-charts';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { getSpendingByCategory, getBudgetSummary } from '@fresh/core/db';
import type { SpendingByCategory, BudgetSummary } from '@fresh/core/db';
import { useDb } from '../context/DbContext';

function currency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

interface Budget {
  id: string;
  name: string;
  is_active: 0 | 1;
}

const PERIOD_OPTIONS = [
  { label: 'This month', offset: 0 },
  { label: 'Last month', offset: 1 },
  { label: '2 months ago', offset: 2 },
];

// Pastel palette cycling for bar chart
const BAR_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ec4899', '#14b8a6', '#f87171', '#a78bfa'];

export function BudgetScreen() {
  const db = useDb();
  const [periodOffset, setPeriodOffset] = useState(0);

  const ref = useMemo(() => {
    const d = subMonths(new Date(), periodOffset);
    return { start: format(startOfMonth(d), 'yyyy-MM-dd'), end: format(endOfMonth(d), 'yyyy-MM-dd') };
  }, [periodOffset]);

  // Spending by category — always available, drives the bar chart
  const { data: spending = [] } = useQuery<SpendingByCategory[]>({
    queryKey: ['spending', ref.start, ref.end],
    queryFn: () => getSpendingByCategory(db.raw, ref.start, ref.end),
  });

  // Active budget (if any) — query budgets table directly
  const { data: budgets = [] } = useQuery<Budget[]>({
    queryKey: ['budgets'],
    queryFn: () =>
      db.raw.query<Budget>('SELECT id, name, is_active FROM budgets WHERE is_active = 1 ORDER BY created_at DESC'),
  });

  const activeBudget = budgets[0] ?? null;

  const { data: budgetLines = [] } = useQuery<BudgetSummary[]>({
    queryKey: ['budget-summary', activeBudget?.id, ref.start, ref.end],
    queryFn: () =>
      activeBudget
        ? getBudgetSummary(db.raw, activeBudget.id, ref.start, ref.end)
        : Promise.resolve([]),
    enabled: !!activeBudget,
  });

  const barData = useMemo(
    () =>
      spending.slice(0, 8).map((s, i) => ({
        value: s.total,
        label: (s.category_name ?? 'Other').slice(0, 7),
        frontColor: BAR_COLORS[i % BAR_COLORS.length],
        topLabelComponent: () => null,
      })),
    [spending]
  );

  const totalSpend = useMemo(() => spending.reduce((sum, s) => sum + s.total, 0), [spending]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.pageTitle}>Budget</Text>

      {/* Period picker */}
      <View style={styles.periodRow}>
        {PERIOD_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.offset}
            style={[styles.periodBtn, periodOffset === opt.offset && styles.periodBtnActive]}
            onPress={() => setPeriodOffset(opt.offset)}
          >
            <Text style={[styles.periodBtnText, periodOffset === opt.offset && styles.periodBtnTextActive]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Summary card */}
      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>Total spending</Text>
        <Text style={styles.summaryAmount}>{currency(totalSpend)}</Text>
        <Text style={styles.summaryPeriod}>
          {format(new Date(ref.start), 'MMM d')} – {format(new Date(ref.end), 'MMM d, yyyy')}
        </Text>
      </View>

      {/* Bar chart */}
      {barData.length > 0 && (
        <View style={styles.chartCard}>
          <Text style={styles.sectionTitle}>Spending by category</Text>
          <BarChart
            data={barData}
            barWidth={30}
            spacing={12}
            roundedTop
            hideRules
            xAxisColor="#334155"
            yAxisColor="#334155"
            yAxisTextStyle={{ color: '#64748b', fontSize: 10 }}
            xAxisLabelTextStyle={{ color: '#64748b', fontSize: 9 }}
            noOfSections={4}
            maxValue={Math.max(...barData.map((d) => d.value)) * 1.2}
            barBorderRadius={4}
            isAnimated
          />
        </View>
      )}

      {/* Category breakdown list */}
      {spending.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Category breakdown</Text>
          {spending.map((s, i) => (
            <View key={s.category_id ?? 'other'} style={styles.catRow}>
              <View style={[styles.catDot, { backgroundColor: BAR_COLORS[i % BAR_COLORS.length] }]} />
              <Text style={styles.catName} numberOfLines={1}>
                {s.category_name ?? 'Uncategorized'}
              </Text>
              <View style={styles.catBarWrap}>
                <View
                  style={[
                    styles.catBarFill,
                    {
                      width: `${s.pct_of_total}%` as `${number}%`,
                      backgroundColor: BAR_COLORS[i % BAR_COLORS.length],
                    },
                  ]}
                />
              </View>
              <Text style={styles.catPct}>{s.pct_of_total.toFixed(0)}%</Text>
              <Text style={styles.catAmount}>{currency(s.total)}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Budget lines (if a budget is active) */}
      {budgetLines.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>{activeBudget?.name ?? 'Budget'}</Text>
          {budgetLines.map((line) => {
            const overBudget = line.pct_used > 100;
            const fillColor = line.pct_used > 90 ? '#f87171' : line.pct_used > 70 ? '#f59e0b' : '#22c55e';
            return (
              <View key={line.line_id} style={styles.budgetLine}>
                <View style={styles.budgetLineHeader}>
                  <Text style={styles.budgetLineName} numberOfLines={1}>
                    {line.line_name}
                  </Text>
                  <Text style={[styles.budgetLineAmt, overBudget && { color: '#f87171' }]}>
                    {currency(line.spent)} / {currency(line.limit_amount)}
                  </Text>
                </View>
                <View style={styles.budgetBarWrap}>
                  <View
                    style={[
                      styles.budgetBarFill,
                      {
                        width: `${Math.min(line.pct_used, 100)}%` as `${number}%`,
                        backgroundColor: fillColor,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.budgetRemaining, overBudget && { color: '#f87171' }]}>
                  {overBudget
                    ? `${currency(Math.abs(line.remaining))} over budget`
                    : `${currency(line.remaining)} remaining`}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {spending.length === 0 && (
        <Text style={styles.empty}>No spending data — connect a bank account to get started.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 16, paddingBottom: 40 },
  pageTitle: { color: '#f1f5f9', fontSize: 24, fontWeight: '700', marginBottom: 12 },
  periodRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  periodBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#1e293b',
  },
  periodBtnActive: { borderColor: '#6366f1', backgroundColor: '#312e81' },
  periodBtnText: { color: '#64748b', fontSize: 12, fontWeight: '500' },
  periodBtnTextActive: { color: '#a5b4fc' },
  summaryCard: {
    backgroundColor: '#1e293b',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    alignItems: 'center',
  },
  summaryLabel: { color: '#94a3b8', fontSize: 13, marginBottom: 4 },
  summaryAmount: { color: '#f1f5f9', fontSize: 32, fontWeight: '700' },
  summaryPeriod: { color: '#64748b', fontSize: 12, marginTop: 4 },
  chartCard: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    overflow: 'hidden',
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: { color: '#f1f5f9', fontSize: 15, fontWeight: '600', marginBottom: 12 },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 6,
  },
  catDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  catName: { color: '#94a3b8', fontSize: 12, width: 80 },
  catBarWrap: {
    flex: 1,
    height: 6,
    backgroundColor: '#334155',
    borderRadius: 3,
    overflow: 'hidden',
  },
  catBarFill: { height: '100%', borderRadius: 3 },
  catPct: { color: '#64748b', fontSize: 11, width: 30, textAlign: 'right' },
  catAmount: { color: '#f1f5f9', fontSize: 12, width: 68, textAlign: 'right' },
  budgetLine: { marginBottom: 14 },
  budgetLineHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  budgetLineName: { color: '#f1f5f9', fontSize: 13, fontWeight: '500', flex: 1 },
  budgetLineAmt: { color: '#94a3b8', fontSize: 12 },
  budgetBarWrap: {
    height: 6,
    backgroundColor: '#334155',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 3,
  },
  budgetBarFill: { height: '100%', borderRadius: 3 },
  budgetRemaining: { color: '#64748b', fontSize: 11 },
  empty: { color: '#64748b', textAlign: 'center', paddingVertical: 40, fontSize: 14 },
});
