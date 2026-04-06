/**
 * GoCardless OAuth callback — deep link: fresh://oauth/gocardless?ref=<reference>
 *
 * After the user completes bank auth in a browser, GoCardless redirects back here.
 * We extract the requisition reference from the URL and poll the backend to confirm
 * the connection is ready.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useAuthStore } from '../../../src/store/auth';

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

export default function GoCardlessCallback() {
  const router = useRouter();
  const { ref: reference, requisition_id } = useLocalSearchParams<{
    ref?: string;
    requisition_id?: string;
  }>();
  const token = useAuthStore((s) => s.token);

  const [status, setStatus] = useState<'checking' | 'done' | 'error'>('checking');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!requisition_id || !token) {
      setStatus('error');
      setErrorMsg('Missing requisition ID in callback URL.');
      return;
    }

    const params = new URLSearchParams();
    if (reference) params.set('account_token_ref', reference);

    fetch(`${API}/api/v1/connections/gocardless/requisition/${requisition_id}/status?${params}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((body) => {
        if (body.status === 'pending' || body.status === 'linked') {
          setStatus('done');
          setTimeout(() => router.replace('/(app)/dashboard'), 1500);
        } else {
          throw new Error(body.error ?? 'Unexpected status');
        }
      })
      .catch((err) => {
        setStatus('error');
        setErrorMsg(err instanceof Error ? err.message : 'Failed to confirm connection');
      });
  }, [requisition_id, reference, token]);

  return (
    <View style={styles.container}>
      {status === 'checking' && (
        <>
          <ActivityIndicator color="#22c55e" size="large" />
          <Text style={styles.message}>Confirming bank connection…</Text>
        </>
      )}
      {status === 'done' && <Text style={styles.success}>Bank connected! Returning to app…</Text>}
      {status === 'error' && (
        <Text style={styles.error}>{errorMsg ?? 'Something went wrong.'}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  message: { color: '#94a3b8', fontSize: 15, textAlign: 'center' },
  success: { color: '#22c55e', fontSize: 16, fontWeight: '600', textAlign: 'center' },
  error: { color: '#f87171', fontSize: 14, textAlign: 'center' },
});
