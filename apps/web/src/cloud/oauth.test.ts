import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getStoredTokens,
  storeTokens,
  clearCloudAuth,
  getStoredProvider,
  getStoredCloudAdapter,
  exchangeDropboxCode,
  exchangeGDriveCode,
  getPendingProvider,
  CLOUD_PROVIDER_KEY,
} from './oauth';

const CLOUD_PKCE_VERIFIER_KEY = 'cloud_pkce_verifier';
const CLOUD_OAUTH_STATE_KEY = 'cloud_oauth_state';
const CLOUD_PENDING_PROVIDER_KEY = 'cloud_pending_provider';

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Token storage
// ---------------------------------------------------------------------------

describe('storeTokens / getStoredTokens', () => {
  it('returns null when nothing is stored', () => {
    expect(getStoredTokens('dropbox')).toBeNull();
  });

  it('round-trips dropbox tokens and sets provider key', () => {
    const tokens = { access_token: 'tok', refresh_token: 'ref', expires_at: 9999 };
    storeTokens('dropbox', tokens);
    expect(getStoredTokens('dropbox')).toEqual(tokens);
    expect(localStorage.getItem(CLOUD_PROVIDER_KEY)).toBe('dropbox');
  });

  it('round-trips gdrive tokens', () => {
    storeTokens('gdrive', { access_token: 'g-tok' });
    expect(getStoredTokens('gdrive')).toEqual({ access_token: 'g-tok' });
    expect(localStorage.getItem(CLOUD_PROVIDER_KEY)).toBe('gdrive');
  });

  it('returns null when stored JSON is malformed', () => {
    localStorage.setItem('cloud_dropbox_tokens', '{bad json');
    expect(getStoredTokens('dropbox')).toBeNull();
  });
});

describe('getStoredProvider', () => {
  it('returns null when nothing stored', () => {
    expect(getStoredProvider()).toBeNull();
  });

  it('returns the stored provider', () => {
    storeTokens('dropbox', { access_token: 'x' });
    expect(getStoredProvider()).toBe('dropbox');
  });
});

describe('clearCloudAuth', () => {
  it('removes all cloud keys', () => {
    storeTokens('dropbox', { access_token: 'x' });
    localStorage.setItem(CLOUD_PKCE_VERIFIER_KEY, 'v');
    localStorage.setItem(CLOUD_OAUTH_STATE_KEY, 's');
    localStorage.setItem(CLOUD_PENDING_PROVIDER_KEY, 'dropbox');

    clearCloudAuth();

    expect(getStoredProvider()).toBeNull();
    expect(getStoredTokens('dropbox')).toBeNull();
    expect(localStorage.getItem(CLOUD_PKCE_VERIFIER_KEY)).toBeNull();
    expect(localStorage.getItem(CLOUD_OAUTH_STATE_KEY)).toBeNull();
    expect(localStorage.getItem(CLOUD_PENDING_PROVIDER_KEY)).toBeNull();
  });

  it('does nothing when nothing is stored', () => {
    expect(() => clearCloudAuth()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

describe('getStoredCloudAdapter', () => {
  it('returns null when no provider stored', () => {
    expect(getStoredCloudAdapter()).toBeNull();
  });

  it('returns null when tokens have no access_token', () => {
    localStorage.setItem(CLOUD_PROVIDER_KEY, 'dropbox');
    localStorage.setItem('cloud_dropbox_tokens', JSON.stringify({ refresh_token: 'r' }));
    expect(getStoredCloudAdapter()).toBeNull();
  });

  it('returns a DropboxAdapter when dropbox tokens exist', () => {
    storeTokens('dropbox', { access_token: 'tok' });
    const adapter = getStoredCloudAdapter();
    expect(adapter).not.toBeNull();
    expect(adapter?.constructor.name).toBe('DropboxAdapter');
  });

  it('returns a GDriveAdapter when gdrive tokens exist', () => {
    storeTokens('gdrive', { access_token: 'tok' });
    const adapter = getStoredCloudAdapter();
    expect(adapter).not.toBeNull();
    expect(adapter?.constructor.name).toBe('GDriveAdapter');
  });
});

// ---------------------------------------------------------------------------
// Token exchange — Dropbox
// ---------------------------------------------------------------------------

describe('exchangeDropboxCode', () => {
  beforeEach(() => {
    localStorage.setItem(CLOUD_OAUTH_STATE_KEY, 'state123');
    localStorage.setItem(CLOUD_PKCE_VERIFIER_KEY, 'verifier456');
    localStorage.setItem(CLOUD_PENDING_PROVIDER_KEY, 'dropbox');
  });

  it('throws when VITE_DROPBOX_CLIENT_ID is not configured', async () => {
    // env var is not set in test env — clientId defaults to ''
    await expect(exchangeDropboxCode('code', 'state123')).rejects.toThrow(
      'VITE_DROPBOX_CLIENT_ID is not configured'
    );
  });

  it('throws on state mismatch', async () => {
    vi.stubEnv('VITE_DROPBOX_CLIENT_ID', 'test-id');
    await expect(exchangeDropboxCode('code', 'wrong-state')).rejects.toThrow(
      'OAuth state mismatch'
    );
  });

  it('throws when PKCE verifier is missing', async () => {
    vi.stubEnv('VITE_DROPBOX_CLIENT_ID', 'test-id');
    localStorage.removeItem(CLOUD_PKCE_VERIFIER_KEY);
    await expect(exchangeDropboxCode('code', 'state123')).rejects.toThrow(
      'No PKCE verifier found'
    );
  });

  it('throws with provider error description when token endpoint returns non-ok', async () => {
    vi.stubEnv('VITE_DROPBOX_CLIENT_ID', 'test-id');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Unauthorized',
        json: async () => ({ error_description: 'invalid_grant' }),
      })
    );
    await expect(exchangeDropboxCode('code', 'state123')).rejects.toThrow(
      'Dropbox: invalid_grant'
    );
  });

  it('falls back to statusText when error body has no error_description', async () => {
    vi.stubEnv('VITE_DROPBOX_CLIENT_ID', 'test-id');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Bad Request',
        json: async () => ({}),
      })
    );
    await expect(exchangeDropboxCode('code', 'state123')).rejects.toThrow(
      'Dropbox: Bad Request'
    );
  });

  it('stores tokens and cleans up PKCE keys on success', async () => {
    vi.stubEnv('VITE_DROPBOX_CLIENT_ID', 'test-id');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          access_token: 'access-tok',
          refresh_token: 'refresh-tok',
          expires_in: 14400,
        }),
      })
    );

    const before = Date.now();
    await exchangeDropboxCode('code', 'state123');
    const after = Date.now();

    const stored = getStoredTokens('dropbox');
    expect(stored?.access_token).toBe('access-tok');
    expect(stored?.refresh_token).toBe('refresh-tok');
    expect(stored?.expires_at).toBeGreaterThanOrEqual(before + 14400 * 1000);
    expect(stored?.expires_at).toBeLessThanOrEqual(after + 14400 * 1000);
    expect(getStoredProvider()).toBe('dropbox');

    expect(localStorage.getItem(CLOUD_PKCE_VERIFIER_KEY)).toBeNull();
    expect(localStorage.getItem(CLOUD_OAUTH_STATE_KEY)).toBeNull();
    expect(localStorage.getItem(CLOUD_PENDING_PROVIDER_KEY)).toBeNull();
  });

  it('posts to the Dropbox token endpoint', async () => {
    vi.stubEnv('VITE_DROPBOX_CLIENT_ID', 'my-dropbox-app');
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await exchangeDropboxCode('mycode', 'state123');

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.dropboxapi.com/oauth2/token');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded'
    );
    const body = new URLSearchParams(init.body as string);
    expect(body.get('code')).toBe('mycode');
    expect(body.get('client_id')).toBe('my-dropbox-app');
    expect(body.get('code_verifier')).toBe('verifier456');
  });
});

// ---------------------------------------------------------------------------
// Token exchange — Google Drive
// ---------------------------------------------------------------------------

describe('exchangeGDriveCode', () => {
  beforeEach(() => {
    localStorage.setItem(CLOUD_OAUTH_STATE_KEY, 'stateABC');
    localStorage.setItem(CLOUD_PKCE_VERIFIER_KEY, 'verifierXYZ');
    localStorage.setItem(CLOUD_PENDING_PROVIDER_KEY, 'gdrive');
  });

  it('throws when VITE_GDRIVE_CLIENT_ID is not configured', async () => {
    await expect(exchangeGDriveCode('code', 'stateABC')).rejects.toThrow(
      'VITE_GDRIVE_CLIENT_ID is not configured'
    );
  });

  it('throws on state mismatch', async () => {
    vi.stubEnv('VITE_GDRIVE_CLIENT_ID', 'test-gdrive-id');
    await expect(exchangeGDriveCode('code', 'wrong')).rejects.toThrow('OAuth state mismatch');
  });

  it('throws when fetch returns non-ok', async () => {
    vi.stubEnv('VITE_GDRIVE_CLIENT_ID', 'test-gdrive-id');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        statusText: 'Bad Request',
        json: async () => ({ error_description: 'invalid_client' }),
      })
    );
    await expect(exchangeGDriveCode('code', 'stateABC')).rejects.toThrow(
      'Google Drive: invalid_client'
    );
  });

  it('stores tokens and cleans up PKCE keys on success', async () => {
    vi.stubEnv('VITE_GDRIVE_CLIENT_ID', 'test-gdrive-id');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'g-access', expires_in: 3600 }),
      })
    );

    await exchangeGDriveCode('code', 'stateABC');

    expect(getStoredTokens('gdrive')?.access_token).toBe('g-access');
    expect(getStoredProvider()).toBe('gdrive');
    expect(localStorage.getItem(CLOUD_PKCE_VERIFIER_KEY)).toBeNull();
    expect(localStorage.getItem(CLOUD_OAUTH_STATE_KEY)).toBeNull();
    expect(localStorage.getItem(CLOUD_PENDING_PROVIDER_KEY)).toBeNull();
  });

  it('posts to the Google token endpoint', async () => {
    vi.stubEnv('VITE_GDRIVE_CLIENT_ID', 'my-gdrive-app');
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'tok' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await exchangeGDriveCode('gcode', 'stateABC');

    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://oauth2.googleapis.com/token');
  });
});

// ---------------------------------------------------------------------------
// getPendingProvider
// ---------------------------------------------------------------------------

describe('getPendingProvider', () => {
  it('returns null when nothing stored', () => {
    expect(getPendingProvider()).toBeNull();
  });

  it('returns the pending provider', () => {
    localStorage.setItem(CLOUD_PENDING_PROVIDER_KEY, 'gdrive');
    expect(getPendingProvider()).toBe('gdrive');
  });
});
