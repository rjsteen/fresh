import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { getAccounts } from '@fresh/core/db';
import type { Account } from '@fresh/core/db';
import { useDb } from '../context/DbContext';
import { useAuthStore } from '../store/auth';

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

type SyncStatus = 'idle' | 'syncing' | 'error';
type Panel = null | 'simplefin' | 'gocardless';

interface SyncJob {
  id: string;
  connection_type: string;
  status: string;
  account_token_ref: string;
}

function formatBalance(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatLastSynced(iso: string | null | undefined): string {
  if (!iso) return 'Never synced';
  try {
    return 'Synced ' + format(new Date(iso), 'MMM d, h:mm a');
  } catch {
    return 'Synced recently';
  }
}

function normalizeSyncStatus(jobStatus: string): SyncStatus {
  if (jobStatus === 'syncing' || jobStatus === 'running') return 'syncing';
  if (jobStatus === 'error' || jobStatus === 'failed') return 'error';
  return 'idle';
}

export function AccountsScreen() {
  const db = useDb();
  const token = useAuthStore((s) => s.token);
  const qc = useQueryClient();

  const [panel, setPanel] = useState<Panel>(null);
  const [setupToken, setSetupToken] = useState('');
  const [institutionId, setInstitutionId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [syncOverride, setSyncOverride] = useState<Record<string, SyncStatus>>({});

  function apiFetch(url: string, init?: RequestInit) {
    return fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token ?? ''}`, ...init?.headers },
    });
  }

  const { data: accounts = [], refetch: refetchAccounts } = useQuery<Account[]>({
    queryKey: ['accounts'],
    queryFn: () => getAccounts(db.raw),
  });

  const { data: syncJobs = [] } = useQuery<SyncJob[]>({
    queryKey: ['sync-jobs'],
    queryFn: async () => {
      const res = await apiFetch(`${API}/api/v1/sync/jobs`);
      if (!res.ok) return [];
      const body = await res.json();
      return body.jobs ?? [];
    },
  });

  const syncJobsByRef = useMemo(
    () => new Map(syncJobs.map((j) => [j.account_token_ref, j])),
    [syncJobs]
  );

  function getStatusForAccount(account: Account): SyncStatus {
    if (account.sync_token_ref) {
      const override = syncOverride[account.sync_token_ref];
      if (override) return override;
      const job = syncJobsByRef.get(account.sync_token_ref);
      if (job) return normalizeSyncStatus(job.status);
    }
    return 'idle';
  }

  const triggerSyncMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await apiFetch(`${API}/api/v1/sync/${jobId}/trigger`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to trigger sync');
    },
    onMutate: (jobId) => {
      const job = syncJobs.find((j) => j.id === jobId);
      if (job) setSyncOverride((prev) => ({ ...prev, [job.account_token_ref]: 'syncing' }));
    },
    onSuccess: (_data, jobId) => {
      const job = syncJobs.find((j) => j.id === jobId);
      if (job) setSyncOverride((prev) => ({ ...prev, [job.account_token_ref]: 'idle' }));
      qc.invalidateQueries({ queryKey: ['sync-jobs'] });
    },
    onError: (e: Error, jobId) => {
      const job = syncJobs.find((j) => j.id === jobId);
      if (job) setSyncOverride((prev) => ({ ...prev, [job.account_token_ref]: 'idle' }));
      setError(e.message);
    },
  });

  const removeMutation = useMutation({
    mutationFn: async ({ accountId, jobId }: { accountId: string; jobId?: string }) => {
      await db.raw.execute('DELETE FROM accounts WHERE id = ?', [accountId]);
      if (jobId) {
        const res = await apiFetch(`${API}/api/v1/connections/${jobId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Failed to remove connection');
      }
    },
    onSuccess: () => {
      refetchAccounts();
      qc.invalidateQueries({ queryKey: ['sync-jobs'] });
    },
    onError: (e: Error) => setError(e.message),
  });

  const simplefinMutation = useMutation({
    mutationFn: async (tok: string) => {
      const res = await apiFetch(`${API}/api/v1/connections/simplefin/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setup_token: tok }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? 'Failed to connect');
      }
      return res.json();
    },
    onSuccess: () => {
      setSuccess('SimpleFIN account connected. Your device will sync shortly.');
      setPanel(null);
      setSetupToken('');
      qc.invalidateQueries({ queryKey: ['sync-jobs'] });
      refetchAccounts();
    },
    onError: (e: Error) => setError(e.message),
  });

  const gocardlessMutation = useMutation({
    mutationFn: async (instId: string) => {
      const res = await apiFetch(`${API}/api/v1/connections/gocardless/requisition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ institution_id: instId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? 'Failed to create requisition');
      }
      return res.json() as Promise<{ link: string }>;
    },
    onSuccess: ({ link }) => {
      Linking.openURL(link);
    },
    onError: (e: Error) => setError(e.message),
  });

  function confirmRemove(accountId: string, jobId?: string, name?: string) {
    Alert.alert(
      'Remove account',
      `Remove "${name ?? 'this account'}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeMutation.mutate({ accountId, jobId }),
        },
      ]
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.pageTitle}>Accounts</Text>

      {!!success && (
        <View style={styles.successBanner}>
          <Text style={styles.successText}>{success}</Text>
        </View>
      )}

      {accounts.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Your accounts</Text>
          {accounts.map((account) => {
            const status = getStatusForAccount(account);
            const syncJob = account.sync_token_ref
              ? syncJobsByRef.get(account.sync_token_ref)
              : undefined;
            return (
              <View key={account.id} style={styles.accountCard}>
                <View style={styles.accountHeader}>
                  <Text style={styles.accountName} numberOfLines={1}>
                    {account.name}
                  </Text>
                  <View style={styles.typeBadge}>
                    <Text style={styles.typeBadgeText}>{account.type}</Text>
                  </View>
                  <View style={[styles.syncBadge, status === 'error' && styles.syncBadgeError]}>
                    <Text style={[styles.syncBadgeText, status === 'error' && styles.syncBadgeTextError]}>
                      {status === 'syncing' ? 'Syncing…' : status === 'error' ? 'Error' : 'Idle'}
                    </Text>
                  </View>
                </View>
                <Text style={styles.accountBalance}>
                  {formatBalance(account.current_balance, account.currency)}
                </Text>
                <Text style={styles.accountMeta}>{formatLastSynced(account.last_synced_at)}</Text>
                <View style={styles.accountFooter}>
                  {syncJob && (
                    <TouchableOpacity
                      style={[styles.syncBtn, status === 'syncing' && styles.syncBtnDisabled]}
                      disabled={status === 'syncing' || triggerSyncMutation.isPending}
                      onPress={() => triggerSyncMutation.mutate(syncJob.id)}
                    >
                      <Text style={styles.syncBtnText}>
                        {status === 'syncing' ? 'Syncing…' : 'Sync now'}
                      </Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={styles.removeBtn}
                    onPress={() => confirmRemove(account.id, syncJob?.id, account.name)}
                  >
                    <Text style={styles.removeBtnText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      )}

      {!!error && !panel && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Connect a bank</Text>

        {!panel && (
          <View style={styles.providerGrid}>
            <TouchableOpacity
              style={styles.providerCard}
              onPress={() => { setPanel('simplefin'); setError(null); }}
            >
              <View style={styles.regionBadge}>
                <Text style={styles.regionText}>US</Text>
              </View>
              <Text style={styles.providerName}>SimpleFIN</Text>
              <Text style={styles.providerDesc}>
                Connect US bank accounts using a one-time setup token from SimpleFIN Bridge.
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.providerCard}
              onPress={() => { setPanel('gocardless'); setError(null); }}
            >
              <View style={styles.regionBadge}>
                <Text style={styles.regionText}>EU</Text>
              </View>
              <Text style={styles.providerName}>GoCardless</Text>
              <Text style={styles.providerDesc}>
                Connect European bank accounts via GoCardless Bank Account Data.
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {panel === 'simplefin' && (
          <View>
            <Text style={styles.panelHint}>
              Visit bridge.simplefin.org to generate a setup token, then paste it below.
            </Text>
            <Text style={styles.label}>Setup token</Text>
            <TextInput
              style={styles.input}
              placeholder="Paste your SimpleFIN setup token"
              placeholderTextColor="#475569"
              value={setupToken}
              onChangeText={setSetupToken}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {!!error && (
              <View style={[styles.errorBanner, { marginTop: 8, marginBottom: 0 }]}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
            <View style={styles.btnRow}>
              <TouchableOpacity
                style={[
                  styles.primaryBtn,
                  (!setupToken.trim() || simplefinMutation.isPending) && styles.primaryBtnDisabled,
                ]}
                disabled={!setupToken.trim() || simplefinMutation.isPending}
                onPress={() => simplefinMutation.mutate(setupToken.trim())}
              >
                {simplefinMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.primaryBtnText}>Connect</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.ghostBtn}
                onPress={() => { setPanel(null); setError(null); setSetupToken(''); }}
              >
                <Text style={styles.ghostBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {panel === 'gocardless' && (
          <View>
            <Text style={styles.panelHint}>
              Enter your bank's GoCardless institution ID. You'll be redirected to authorize access.
            </Text>
            <Text style={styles.label}>Institution ID</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. MONZO_MONZGB2L"
              placeholderTextColor="#475569"
              value={institutionId}
              onChangeText={setInstitutionId}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {!!error && (
              <View style={[styles.errorBanner, { marginTop: 8, marginBottom: 0 }]}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
            <View style={styles.btnRow}>
              <TouchableOpacity
                style={[
                  styles.primaryBtn,
                  (!institutionId.trim() || gocardlessMutation.isPending) && styles.primaryBtnDisabled,
                ]}
                disabled={!institutionId.trim() || gocardlessMutation.isPending}
                onPress={() => gocardlessMutation.mutate(institutionId.trim())}
              >
                {gocardlessMutation.isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={styles.primaryBtnText}>Authorize</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.ghostBtn}
                onPress={() => { setPanel(null); setError(null); setInstitutionId(''); }}
              >
                <Text style={styles.ghostBtnText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  content: { padding: 16, paddingBottom: 40 },
  pageTitle: { color: '#f1f5f9', fontSize: 24, fontWeight: '700', marginBottom: 16 },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: { color: '#f1f5f9', fontSize: 16, fontWeight: '600', marginBottom: 12 },
  accountCard: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
    backgroundColor: '#0f172a',
  },
  accountHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  accountName: { color: '#f1f5f9', fontSize: 15, fontWeight: '600', flex: 1 },
  typeBadge: {
    backgroundColor: '#14532d',
    borderWidth: 1,
    borderColor: '#166534',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  typeBadgeText: { color: '#86efac', fontSize: 10, fontWeight: '500', textTransform: 'capitalize' },
  syncBadge: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  syncBadgeError: { borderColor: '#f8717133', backgroundColor: '#7f1d1d' },
  syncBadgeText: { color: '#64748b', fontSize: 10, fontWeight: '500' },
  syncBadgeTextError: { color: '#f87171' },
  accountBalance: { color: '#f1f5f9', fontSize: 22, fontWeight: '700', marginBottom: 2 },
  accountMeta: { color: '#64748b', fontSize: 12, marginBottom: 8 },
  accountFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  syncBtn: {
    backgroundColor: '#14532d',
    borderWidth: 1,
    borderColor: '#166534',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  syncBtnDisabled: { opacity: 0.5 },
  syncBtnText: { color: '#86efac', fontSize: 13, fontWeight: '500' },
  removeBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  removeBtnText: { color: '#f87171', fontSize: 13 },
  providerGrid: { flexDirection: 'row', gap: 10 },
  providerCard: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderWidth: 1.5,
    borderColor: '#334155',
    borderRadius: 10,
    padding: 14,
    gap: 6,
  },
  regionBadge: {
    backgroundColor: '#14532d',
    borderWidth: 1,
    borderColor: '#166534',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  regionText: { color: '#86efac', fontSize: 10, fontWeight: '600' },
  providerName: { color: '#f1f5f9', fontSize: 15, fontWeight: '600' },
  providerDesc: { color: '#94a3b8', fontSize: 12, lineHeight: 16 },
  panelHint: { color: '#94a3b8', fontSize: 13, marginBottom: 12, lineHeight: 18 },
  label: { color: '#94a3b8', fontSize: 13, fontWeight: '500', marginBottom: 6 },
  input: {
    backgroundColor: '#0f172a',
    borderWidth: 1.5,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#f1f5f9',
    fontSize: 14,
    marginBottom: 4,
  },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  primaryBtn: {
    flex: 1,
    backgroundColor: '#22c55e',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  ghostBtn: {
    borderWidth: 1.5,
    borderColor: '#334155',
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostBtnText: { color: '#94a3b8', fontSize: 15, fontWeight: '500' },
  errorBanner: {
    backgroundColor: '#7f1d1d',
    borderWidth: 1,
    borderColor: '#f8717133',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  errorText: { color: '#f87171', fontSize: 13 },
  successBanner: {
    backgroundColor: '#14532d',
    borderWidth: 1,
    borderColor: '#166534',
    borderRadius: 8,
    padding: 10,
    marginBottom: 10,
  },
  successText: { color: '#86efac', fontSize: 13 },
});
