import { create } from 'zustand';
import * as SecureStore from 'expo-secure-store';

const TOKEN_KEY = 'device_token';
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface StoredToken {
  token: string;
  expiresAt: number;
}

function parseJwtExp(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

async function readStored(): Promise<StoredToken | null> {
  const raw = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredToken;
    if (typeof parsed.token === 'string' && typeof parsed.expiresAt === 'number') {
      if (Date.now() >= parsed.expiresAt) {
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        return null;
      }
      return parsed;
    }
  } catch {}
  return null;
}

interface AuthState {
  token: string | null;
  isAuthenticated: boolean;
  hydrated: boolean;
  hydrate: () => Promise<void>;
  setToken: (token: string) => Promise<void>;
  clearToken: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  isAuthenticated: false,
  hydrated: false,

  async hydrate() {
    const stored = await readStored();
    set({
      token: stored?.token ?? null,
      isAuthenticated: stored !== null,
      hydrated: true,
    });
  },

  async setToken(token: string) {
    const expiresAt = parseJwtExp(token) ?? Date.now() + DEFAULT_TTL_MS;
    await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify({ token, expiresAt }));
    set({ token, isAuthenticated: true });
  },

  async clearToken() {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    set({ token: null, isAuthenticated: false });
  },
}));
