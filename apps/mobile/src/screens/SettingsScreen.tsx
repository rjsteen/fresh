import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Switch,
  ActivityIndicator,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { getAllAlertRules, upsertAlertRule, deleteAlertRule } from '@fresh/core/db';
import type { AlertRule } from '@fresh/core/db';
import { useDb } from '../context/DbContext';
import { useAuthStore } from '../store/auth';

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

const RULE_TYPE_LABELS: Record<string, string> = {
  budget_threshold: 'Budget threshold',
  large_transaction: 'Large transaction',
  merchant: 'Merchant alert',
  balance_low: 'Low balance',
};

function ruleDescription(rule: AlertRule): string {
  const params = rule.params;
  if (rule.rule_type === 'large_transaction') {
    const threshold = params['threshold'] as number | undefined;
    return threshold != null ? `Alert when a transaction exceeds $${threshold}` : 'Alert on large transactions';
  }
  if (rule.rule_type === 'budget_threshold') {
    const pct = params['threshold_pct'] as number | undefined;
    return pct != null ? `Alert at ${pct}% of budget` : 'Alert near budget limit';
  }
  if (rule.rule_type === 'balance_low') {
    const min = params['min_balance'] as number | undefined;
    return min != null ? `Alert when balance drops below $${min}` : 'Alert on low balance';
  }
  if (rule.rule_type === 'merchant') {
    const name = params['merchant_name'] as string | undefined;
    return name ? `Alert on transactions at ${name}` : 'Alert on matching merchant';
  }
  return 'Custom rule';
}

interface UserProfile {
  email: string;
  inserted_at?: string;
}

export function SettingsScreen() {
  const db = useDb();
  const router = useRouter();
  const { token, clearToken } = useAuthStore();
  const qc = useQueryClient();
  const [profileError, setProfileError] = useState(false);

  function apiFetch(url: string, init?: RequestInit) {
    return fetch(url, {
      ...init,
      headers: { Authorization: `Bearer ${token ?? ''}`, ...init?.headers },
    });
  }

  const { data: profile } = useQuery<UserProfile | null>({
    queryKey: ['profile'],
    queryFn: async () => {
      const res = await apiFetch(`${API}/api/v1/me`);
      if (!res.ok) { setProfileError(true); return null; }
      const body = await res.json();
      return body as UserProfile;
    },
    retry: false,
  });

  const { data: alertRules = [], isLoading: rulesLoading } = useQuery<AlertRule[]>({
    queryKey: ['alert-rules'],
    queryFn: () => getAllAlertRules(db.raw),
  });

  const toggleRuleMutation = useMutation({
    mutationFn: (rule: AlertRule) => upsertAlertRule(db.raw, { ...rule, enabled: !rule.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alert-rules'] }),
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (id: string) => deleteAlertRule(db.raw, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alert-rules'] }),
  });

  function confirmDeleteRule(rule: AlertRule) {
    Alert.alert(
      'Delete alert',
      `Delete "${rule.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteRuleMutation.mutate(rule.id) },
      ]
    );
  }

  function handleSignOut() {
    Alert.alert('Sign out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          await clearToken();
          router.replace('/(auth)/login');
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.pageTitle}>Settings</Text>

      {/* Profile */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Profile</Text>
        {profile ? (
          <View style={styles.profileRow}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(profile.email[0] ?? '?').toUpperCase()}
              </Text>
            </View>
            <View>
              <Text style={styles.profileEmail}>{profile.email}</Text>
              {profile.inserted_at && (
                <Text style={styles.profileSub}>
                  Member since {new Date(profile.inserted_at).getFullYear()}
                </Text>
              )}
            </View>
          </View>
        ) : profileError ? (
          <Text style={styles.mutedText}>Unable to load profile.</Text>
        ) : (
          <ActivityIndicator color="#6366f1" />
        )}
      </View>

      {/* Alert rules */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Alert rules</Text>
        {rulesLoading ? (
          <ActivityIndicator color="#6366f1" />
        ) : alertRules.length === 0 ? (
          <Text style={styles.mutedText}>No alert rules configured.</Text>
        ) : (
          alertRules.map((rule) => (
            <View key={rule.id} style={styles.ruleRow}>
              <View style={styles.ruleInfo}>
                <Text style={styles.ruleName}>{rule.name}</Text>
                <Text style={styles.ruleType}>{RULE_TYPE_LABELS[rule.rule_type] ?? rule.rule_type}</Text>
                <Text style={styles.ruleDesc} numberOfLines={2}>{ruleDescription(rule)}</Text>
              </View>
              <View style={styles.ruleActions}>
                <Switch
                  value={rule.enabled}
                  onValueChange={() => toggleRuleMutation.mutate(rule)}
                  trackColor={{ false: '#334155', true: '#4f46e5' }}
                  thumbColor={rule.enabled ? '#6366f1' : '#64748b'}
                />
                <TouchableOpacity onPress={() => confirmDeleteRule(rule)} style={styles.deleteBtn}>
                  <Text style={styles.deleteBtnText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </View>

      {/* Device management */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Device</Text>
        <Text style={styles.mutedText}>
          All financial data is stored encrypted on this device. No transaction data is sent to
          any server.
        </Text>
      </View>

      {/* Sign out */}
      <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
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
  sectionTitle: { color: '#f1f5f9', fontSize: 15, fontWeight: '600', marginBottom: 12 },
  profileRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#312e81',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#a5b4fc', fontSize: 18, fontWeight: '700' },
  profileEmail: { color: '#f1f5f9', fontSize: 15, fontWeight: '500' },
  profileSub: { color: '#64748b', fontSize: 12, marginTop: 2 },
  mutedText: { color: '#64748b', fontSize: 13, lineHeight: 18 },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    gap: 8,
  },
  ruleInfo: { flex: 1 },
  ruleName: { color: '#f1f5f9', fontSize: 14, fontWeight: '500' },
  ruleType: { color: '#6366f1', fontSize: 11, fontWeight: '500', marginTop: 2 },
  ruleDesc: { color: '#64748b', fontSize: 12, marginTop: 3, lineHeight: 16 },
  ruleActions: { alignItems: 'center', gap: 8 },
  deleteBtn: { paddingHorizontal: 4, paddingVertical: 2 },
  deleteBtnText: { color: '#f87171', fontSize: 12 },
  signOutBtn: {
    backgroundColor: '#7f1d1d',
    borderWidth: 1,
    borderColor: '#f8717133',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  signOutText: { color: '#f87171', fontSize: 15, fontWeight: '600' },
});
