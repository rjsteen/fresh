import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { getTransactions, getAccounts } from '@fresh/core/db';
import type { Transaction, Account } from '@fresh/core/db';
import { useDb } from '../context/DbContext';

const PAGE_SIZE = 50;

function currency(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

interface Filters {
  accountId: string | null;
  startDate: string;
  endDate: string;
  search: string;
}

export function makeDefaultFilters(): Filters {
  const now = new Date();
  return {
    accountId: null,
    startDate: format(startOfMonth(subMonths(now, 2)), 'yyyy-MM-dd'),
    endDate: format(endOfMonth(now), 'yyyy-MM-dd'),
    search: '',
  };
}

function TxItem({ tx }: { tx: Transaction }) {
  const isCredit = tx.amount >= 0;
  return (
    <View style={styles.txRow}>
      <View style={styles.txInfo}>
        <Text style={styles.txName} numberOfLines={1}>
          {tx.merchant_name ?? tx.description}
        </Text>
        <Text style={styles.txDate}>{tx.date}</Text>
        {tx.pending && (
          <View style={styles.pendingBadge}>
            <Text style={styles.pendingText}>Pending</Text>
          </View>
        )}
      </View>
      <Text style={[styles.txAmount, { color: isCredit ? '#10b981' : '#f1f5f9' }]}>
        {isCredit ? '+' : ''}{currency(tx.amount)}
      </Text>
    </View>
  );
}

export function TransactionsScreen() {
  const db = useDb();
  const [filters, setFilters] = useState<Filters>(makeDefaultFilters);
  const [pendingFilters, setPendingFilters] = useState<Filters>(makeDefaultFilters);

  const DATE_PRESETS = useMemo(() => {
    const now = new Date();
    return [
      { label: 'This month', start: format(startOfMonth(now), 'yyyy-MM-dd'), end: format(endOfMonth(now), 'yyyy-MM-dd') },
      { label: 'Last month', start: format(startOfMonth(subMonths(now, 1)), 'yyyy-MM-dd'), end: format(endOfMonth(subMonths(now, 1)), 'yyyy-MM-dd') },
      { label: '3 months', start: format(startOfMonth(subMonths(now, 2)), 'yyyy-MM-dd'), end: format(endOfMonth(now), 'yyyy-MM-dd') },
    ];
  }, []);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [page, setPage] = useState(0);

  const { data: accounts = [] } = useQuery<Account[]>({
    queryKey: ['accounts'],
    queryFn: () => getAccounts(db.raw),
  });

  const { data: transactions = [], isFetching } = useQuery<Transaction[]>({
    queryKey: ['transactions', 'list', filters, page],
    queryFn: () =>
      getTransactions(db.raw, {
        account_id: filters.accountId ?? undefined,
        start_date: filters.startDate,
        end_date: filters.endDate,
        search: filters.search || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
  });

  function openSheet() {
    setPendingFilters(filters);
    setSheetOpen(true);
  }

  function applyFilters() {
    setFilters(pendingFilters);
    setPage(0);
    setSheetOpen(false);
  }

  function clearFilters() {
    const reset = makeDefaultFilters();
    setPendingFilters(reset);
    setFilters(reset);
    setPage(0);
    setSheetOpen(false);
  }

  const defaultDates = makeDefaultFilters();
  const activeFilterCount = [
    filters.accountId !== null,
    filters.startDate !== defaultDates.startDate || filters.endDate !== defaultDates.endDate,
    filters.search.length > 0,
  ].filter(Boolean).length;

  const renderItem = useCallback(({ item }: { item: Transaction }) => (
    <TxItem tx={item} />
  ), []);

  const keyExtractor = useCallback((item: Transaction) => item.id, []);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.pageTitle}>Transactions</Text>
        <TouchableOpacity style={styles.filterBtn} onPress={openSheet}>
          <Text style={styles.filterBtnText}>
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Search bar */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search transactions…"
          placeholderTextColor="#475569"
          value={filters.search}
          onChangeText={(text) => {
            setFilters((f) => ({ ...f, search: text }));
            setPage(0);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {/* List */}
      <FlatList
        data={transactions}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          isFetching ? (
            <ActivityIndicator color="#6366f1" style={{ marginTop: 40 }} />
          ) : (
            <Text style={styles.empty}>No transactions found</Text>
          )
        }
        ListFooterComponent={
          transactions.length === PAGE_SIZE ? (
            <View style={styles.paginationRow}>
              {page > 0 && (
                <TouchableOpacity style={styles.pageBtn} onPress={() => setPage((p) => p - 1)}>
                  <Text style={styles.pageBtnText}>← Previous</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.pageBtn} onPress={() => setPage((p) => p + 1)}>
                <Text style={styles.pageBtnText}>Next →</Text>
              </TouchableOpacity>
            </View>
          ) : page > 0 ? (
            <View style={styles.paginationRow}>
              <TouchableOpacity style={styles.pageBtn} onPress={() => setPage((p) => p - 1)}>
                <Text style={styles.pageBtnText}>← Previous</Text>
              </TouchableOpacity>
            </View>
          ) : null
        }
      />

      {/* Filter bottom sheet */}
      <Modal
        visible={sheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetOpen(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setSheetOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Filters</Text>

          {/* Date presets */}
          <Text style={styles.filterLabel}>Period</Text>
          <View style={styles.presetRow}>
            {DATE_PRESETS.map((preset) => {
              const active =
                pendingFilters.startDate === preset.start && pendingFilters.endDate === preset.end;
              return (
                <TouchableOpacity
                  key={preset.label}
                  style={[styles.presetBtn, active && styles.presetBtnActive]}
                  onPress={() =>
                    setPendingFilters((f) => ({ ...f, startDate: preset.start, endDate: preset.end }))
                  }
                >
                  <Text style={[styles.presetBtnText, active && styles.presetBtnTextActive]}>
                    {preset.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Account filter */}
          {accounts.length > 0 && (
            <>
              <Text style={styles.filterLabel}>Account</Text>
              <View style={styles.presetRow}>
                <TouchableOpacity
                  style={[styles.presetBtn, pendingFilters.accountId === null && styles.presetBtnActive]}
                  onPress={() => setPendingFilters((f) => ({ ...f, accountId: null }))}
                >
                  <Text style={[styles.presetBtnText, pendingFilters.accountId === null && styles.presetBtnTextActive]}>
                    All
                  </Text>
                </TouchableOpacity>
                {accounts.map((a) => (
                  <TouchableOpacity
                    key={a.id}
                    style={[styles.presetBtn, pendingFilters.accountId === a.id && styles.presetBtnActive]}
                    onPress={() => setPendingFilters((f) => ({ ...f, accountId: a.id }))}
                  >
                    <Text
                      style={[styles.presetBtnText, pendingFilters.accountId === a.id && styles.presetBtnTextActive]}
                      numberOfLines={1}
                    >
                      {a.name}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          <View style={styles.sheetBtnRow}>
            <TouchableOpacity style={styles.ghostBtn} onPress={clearFilters}>
              <Text style={styles.ghostBtnText}>Clear all</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryBtn} onPress={applyFilters}>
              <Text style={styles.primaryBtnText}>Apply</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  pageTitle: { color: '#f1f5f9', fontSize: 24, fontWeight: '700' },
  filterBtn: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#334155',
  },
  filterBtnText: { color: '#94a3b8', fontSize: 13, fontWeight: '500' },
  searchRow: { paddingHorizontal: 16, paddingBottom: 8 },
  searchInput: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    color: '#f1f5f9',
    fontSize: 14,
  },
  listContent: { paddingHorizontal: 16, paddingBottom: 40 },
  txRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  txInfo: { flex: 1, marginRight: 12 },
  txName: { color: '#f1f5f9', fontSize: 14, fontWeight: '500' },
  txDate: { color: '#64748b', fontSize: 12, marginTop: 2 },
  pendingBadge: {
    marginTop: 4,
    alignSelf: 'flex-start',
    backgroundColor: '#78350f',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  pendingText: { color: '#fbbf24', fontSize: 10, fontWeight: '500' },
  txAmount: { fontSize: 14, fontWeight: '600' },
  empty: { color: '#64748b', textAlign: 'center', paddingVertical: 40, fontSize: 14 },
  paginationRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 12,
    paddingVertical: 16,
  },
  pageBtn: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  pageBtnText: { color: '#94a3b8', fontSize: 13, fontWeight: '500' },
  // Bottom sheet
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: '#1e293b',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 36,
    gap: 4,
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#475569',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetTitle: { color: '#f1f5f9', fontSize: 17, fontWeight: '600', marginBottom: 12 },
  filterLabel: { color: '#94a3b8', fontSize: 12, fontWeight: '500', marginTop: 8, marginBottom: 6 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  presetBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    backgroundColor: '#0f172a',
  },
  presetBtnActive: { borderColor: '#6366f1', backgroundColor: '#312e81' },
  presetBtnText: { color: '#94a3b8', fontSize: 13 },
  presetBtnTextActive: { color: '#a5b4fc', fontWeight: '600' },
  sheetBtnRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  primaryBtn: {
    flex: 1,
    backgroundColor: '#6366f1',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  ghostBtn: {
    borderWidth: 1.5,
    borderColor: '#334155',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  ghostBtnText: { color: '#94a3b8', fontSize: 15, fontWeight: '500' },
});
