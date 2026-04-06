import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { API } from '../utils/api';

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

const TOKEN_KEY = 'device_token';
const EMAIL_KEY = 'user_email';
const REFRESH_BUFFER_MS = 60_000; // refresh 60 s before expiry
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // fallback: 7 days

interface StoredToken {
  token: string;
  expiresAt: number; // ms since epoch
}

function parseJwtExp(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function loadStored(): StoredToken | null {
  const raw = localStorage.getItem(TOKEN_KEY);
  if (!raw) return null;

  // New format: JSON { token, expiresAt }
  try {
    const parsed = JSON.parse(raw) as StoredToken;
    if (typeof parsed.token === 'string' && typeof parsed.expiresAt === 'number') {
      if (Date.now() >= parsed.expiresAt) {
        localStorage.removeItem(TOKEN_KEY);
        return null;
      }
      return parsed;
    }
  } catch {
    // Not JSON — fall through to legacy migration
  }

  // Legacy migration: raw token string → new format
  const expiresAt = parseJwtExp(raw) ?? Date.now() + DEFAULT_TTL_MS;
  const migrated: StoredToken = { token: raw, expiresAt };
  localStorage.setItem(TOKEN_KEY, JSON.stringify(migrated));
  return migrated;
}

export function getStoredToken(): string | null {
  return loadStored()?.token ?? null;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface AuthContextValue {
  isAuthenticated: boolean;
  token: string | null;
  storeToken: (token: string, email?: string) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<StoredToken | null>(() => loadStored());

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EMAIL_KEY);
    setStored(null);
    window.location.href = '/login';
  }, []);

  const storeToken = useCallback((token: string, email?: string) => {
    const expiresAt = parseJwtExp(token) ?? Date.now() + DEFAULT_TTL_MS;
    const payload: StoredToken = { token, expiresAt };
    localStorage.setItem(TOKEN_KEY, JSON.stringify(payload));
    if (email) localStorage.setItem(EMAIL_KEY, email);
    setStored(payload);
  }, []);

  // React to 401s fired by apiFetch
  useEffect(() => {
    const handle = () => logout();
    window.addEventListener('auth:expired', handle);
    return () => window.removeEventListener('auth:expired', handle);
  }, [logout]);

  // Proactive token refresh
  useEffect(() => {
    if (!stored) return;
    const msUntilRefresh = stored.expiresAt - Date.now() - REFRESH_BUFFER_MS;

    async function refresh() {
      try {
        const res = await fetch(`${API}/api/v1/auth/refresh`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${stored!.token}` },
        });
        if (!res.ok) {
          logout();
          return;
        }
        const { token: newToken } = await res.json();
        storeToken(newToken);
      } catch {
        // Network error — stay logged in, will retry after next mount
      }
    }

    if (msUntilRefresh <= 0) {
      refresh();
      return;
    }

    const id = setTimeout(refresh, msUntilRefresh);
    return () => clearTimeout(id);
  }, [stored, logout, storeToken]);

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated: stored !== null,
        token: stored?.token ?? null,
        storeToken,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
