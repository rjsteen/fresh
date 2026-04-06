import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthStore } from '../store/auth';

const API = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

type Region = 'us' | 'eu';

interface Fields {
  email: string;
  password: string;
  confirmPassword: string;
  region: Region;
}

type FieldErrors = Partial<Record<keyof Fields, string>>;

function validate(fields: Fields): FieldErrors {
  const errs: FieldErrors = {};
  if (!fields.email || !/^[^\s]+@[^\s]+$/.test(fields.email)) {
    errs.email = 'Must be a valid email address';
  }
  if (fields.password.length < 8) {
    errs.password = 'Password must be at least 8 characters';
  }
  if (fields.password !== fields.confirmPassword) {
    errs.confirmPassword = 'Passwords do not match';
  }
  return errs;
}

export function RegisterScreen() {
  const router = useRouter();
  const setToken = useAuthStore((s) => s.setToken);

  const detectedTz = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  })();

  const [fields, setFields] = useState<Fields>({
    email: '',
    password: '',
    confirmPassword: '',
    region: 'us',
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function set<K extends keyof Fields>(key: K, value: Fields[K]) {
    setFields((prev) => ({ ...prev, [key]: value }));
    if (fieldErrors[key]) {
      setFieldErrors((prev) => ({ ...prev, [key]: undefined }));
    }
  }

  async function handleSubmit() {
    setServerError(null);
    const errs = validate(fields);
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }

    setLoading(true);
    try {
      const resp = await fetch(`${API}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: fields.email,
          password: fields.password,
          region: fields.region,
          timezone: detectedTz,
        }),
      });

      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        if (body.errors && typeof body.errors === 'object') {
          const serverFieldErrors: FieldErrors = {};
          for (const [k, msgs] of Object.entries(body.errors)) {
            const key = k as keyof Fields;
            serverFieldErrors[key] = Array.isArray(msgs) ? msgs[0] : String(msgs);
          }
          setFieldErrors(serverFieldErrors);
        } else {
          throw new Error(body.error ?? 'Registration failed');
        }
        return;
      }

      const { token } = await resp.json();
      await setToken(token);

      fetch(`${API}/api/v1/devices`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ name: 'Mobile App', platform: Platform.OS }),
      }).catch(() => {});

      router.replace('/(app)/dashboard');
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.wordmark}>Fresh</Text>
          <Text style={styles.tagline}>Create your account</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={[styles.input, fieldErrors.email ? styles.inputError : null]}
              value={fields.email}
              onChangeText={(v) => set('email', v)}
              placeholder="you@example.com"
              placeholderTextColor="#475569"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
            />
            {fieldErrors.email && <Text style={styles.fieldError}>{fieldErrors.email}</Text>}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={[styles.input, fieldErrors.password ? styles.inputError : null]}
              value={fields.password}
              onChangeText={(v) => set('password', v)}
              placeholder="••••••••"
              placeholderTextColor="#475569"
              secureTextEntry
              autoComplete="new-password"
            />
            {fieldErrors.password && <Text style={styles.fieldError}>{fieldErrors.password}</Text>}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Confirm password</Text>
            <TextInput
              style={[styles.input, fieldErrors.confirmPassword ? styles.inputError : null]}
              value={fields.confirmPassword}
              onChangeText={(v) => set('confirmPassword', v)}
              placeholder="••••••••"
              placeholderTextColor="#475569"
              secureTextEntry
              autoComplete="new-password"
            />
            {fieldErrors.confirmPassword && (
              <Text style={styles.fieldError}>{fieldErrors.confirmPassword}</Text>
            )}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Region</Text>
            <View style={styles.segmented}>
              {(['us', 'eu'] as Region[]).map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[styles.segment, fields.region === r && styles.segmentActive]}
                  onPress={() => set('region', r)}
                >
                  <Text
                    style={[
                      styles.segmentText,
                      fields.region === r && styles.segmentTextActive,
                    ]}
                  >
                    {r === 'us' ? 'United States (SimpleFIN)' : 'Europe (GoCardless)'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          {serverError && <Text style={styles.serverError}>{serverError}</Text>}

          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleSubmit}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Create account</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.push('/(auth)/login')}>
            <Text style={styles.footerNote}>
              Already have an account? <Text style={styles.link}>Sign in</Text>
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#1e293b', borderRadius: 16, padding: 32 },
  wordmark: {
    color: '#22c55e',
    fontSize: 32,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -1,
    marginBottom: 6,
  },
  tagline: { color: '#64748b', fontSize: 13, textAlign: 'center', marginBottom: 28 },
  field: { marginBottom: 16 },
  label: { color: '#94a3b8', fontSize: 13, fontWeight: '500', marginBottom: 6 },
  input: {
    backgroundColor: '#0f172a',
    borderWidth: 1.5,
    borderColor: '#334155',
    borderRadius: 8,
    color: '#f1f5f9',
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  inputError: { borderColor: '#f87171' },
  fieldError: { color: '#f87171', fontSize: 12, marginTop: 4 },
  segmented: { flexDirection: 'column', gap: 8 },
  segment: {
    backgroundColor: '#0f172a',
    borderWidth: 1.5,
    borderColor: '#334155',
    borderRadius: 8,
    paddingVertical: 11,
    paddingHorizontal: 14,
  },
  segmentActive: { borderColor: '#22c55e', backgroundColor: '#052e16' },
  segmentText: { color: '#64748b', fontSize: 14 },
  segmentTextActive: { color: '#22c55e' },
  serverError: {
    color: '#f87171',
    fontSize: 13,
    marginBottom: 12,
    backgroundColor: '#450a0a',
    padding: 10,
    borderRadius: 6,
  },
  button: {
    backgroundColor: '#22c55e',
    borderRadius: 8,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  footerNote: { color: '#64748b', fontSize: 13, textAlign: 'center' },
  link: { color: '#22c55e' },
});
