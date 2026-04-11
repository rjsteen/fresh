/**
 * OAuth 2.0 PKCE helpers for Dropbox and Google Drive cloud backup.
 *
 * Token storage:
 *   Tokens are stored in localStorage for simplicity. In production, prefer
 *   an encrypted IndexedDB store or server-side session to protect refresh
 *   tokens from XSS.
 *
 * Environment variables (set in .env.local):
 *   VITE_DROPBOX_CLIENT_ID   — Dropbox app key
 *   VITE_GDRIVE_CLIENT_ID    — Google OAuth client ID
 */

import { DropboxAdapter, GDriveAdapter } from '@fresh/core/cloud';
import type { CloudStorageAdapter } from '@fresh/core/cloud';

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

export const CLOUD_PROVIDER_KEY = 'cloud_provider';
const CLOUD_PKCE_VERIFIER_KEY = 'cloud_pkce_verifier';
const CLOUD_OAUTH_STATE_KEY = 'cloud_oauth_state';
const CLOUD_PENDING_PROVIDER_KEY = 'cloud_pending_provider';
const tokenKey = (provider: CloudProvider) => `cloud_${provider}_tokens`;

export type CloudProvider = 'dropbox' | 'gdrive';

interface StoredTokens {
  access_token: string;
  refresh_token?: string;
  expires_at?: number; // ms since epoch
}

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

function base64UrlEncode(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const random = crypto.getRandomValues(new Uint8Array(32));
  const verifier = base64UrlEncode(random.buffer as ArrayBuffer);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = base64UrlEncode(digest);
  return { verifier, challenge };
}

function generateState(): string {
  const random = crypto.getRandomValues(new Uint8Array(16));
  return base64UrlEncode(random.buffer as ArrayBuffer);
}

// ---------------------------------------------------------------------------
// Token storage
// ---------------------------------------------------------------------------

export function getStoredTokens(provider: CloudProvider): StoredTokens | null {
  try {
    const raw = localStorage.getItem(tokenKey(provider));
    if (!raw) return null;
    return JSON.parse(raw) as StoredTokens;
  } catch {
    return null;
  }
}

export function storeTokens(provider: CloudProvider, tokens: StoredTokens): void {
  localStorage.setItem(tokenKey(provider), JSON.stringify(tokens));
  localStorage.setItem(CLOUD_PROVIDER_KEY, provider);
}

export function clearCloudAuth(): void {
  const provider = localStorage.getItem(CLOUD_PROVIDER_KEY) as CloudProvider | null;
  if (provider) localStorage.removeItem(tokenKey(provider));
  localStorage.removeItem(CLOUD_PROVIDER_KEY);
  localStorage.removeItem(CLOUD_PKCE_VERIFIER_KEY);
  localStorage.removeItem(CLOUD_OAUTH_STATE_KEY);
  localStorage.removeItem(CLOUD_PENDING_PROVIDER_KEY);
}

export function getStoredProvider(): CloudProvider | null {
  return localStorage.getItem(CLOUD_PROVIDER_KEY) as CloudProvider | null;
}

// ---------------------------------------------------------------------------
// Adapter factory
// ---------------------------------------------------------------------------

export function getStoredCloudAdapter(): CloudStorageAdapter | null {
  const provider = getStoredProvider();
  if (!provider) return null;

  const tokens = getStoredTokens(provider);
  if (!tokens?.access_token) return null;

  if (provider === 'dropbox') return new DropboxAdapter(tokens.access_token);
  if (provider === 'gdrive') return new GDriveAdapter(tokens.access_token);
  return null;
}

// ---------------------------------------------------------------------------
// OAuth initiation
// ---------------------------------------------------------------------------

function redirectUri(): string {
  return `${window.location.origin}/oauth/callback`;
}

export async function initiateDropboxOAuth(): Promise<void> {
  const clientId = (import.meta.env.VITE_DROPBOX_CLIENT_ID as string | undefined) ?? '';
  if (!clientId) throw new Error('VITE_DROPBOX_CLIENT_ID is not configured');

  const { verifier, challenge } = await generatePkce();
  const state = generateState();

  localStorage.setItem(CLOUD_PKCE_VERIFIER_KEY, verifier);
  localStorage.setItem(CLOUD_OAUTH_STATE_KEY, state);
  localStorage.setItem(CLOUD_PENDING_PROVIDER_KEY, 'dropbox');

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    token_access_type: 'offline',
  });

  window.location.href = `https://www.dropbox.com/oauth2/authorize?${params}`;
}

export async function initiateGDriveOAuth(): Promise<void> {
  const clientId = (import.meta.env.VITE_GDRIVE_CLIENT_ID as string | undefined) ?? '';
  if (!clientId) throw new Error('VITE_GDRIVE_CLIENT_ID is not configured');

  const { verifier, challenge } = await generatePkce();
  const state = generateState();

  localStorage.setItem(CLOUD_PKCE_VERIFIER_KEY, verifier);
  localStorage.setItem(CLOUD_OAUTH_STATE_KEY, state);
  localStorage.setItem(CLOUD_PENDING_PROVIDER_KEY, 'gdrive');

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    scope: 'https://www.googleapis.com/auth/drive.appdata',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    access_type: 'offline',
    prompt: 'consent',
  });

  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export async function exchangeDropboxCode(code: string, state: string): Promise<void> {
  const clientId = (import.meta.env.VITE_DROPBOX_CLIENT_ID as string | undefined) ?? '';
  if (!clientId) throw new Error('VITE_DROPBOX_CLIENT_ID is not configured');

  const storedState = localStorage.getItem(CLOUD_OAUTH_STATE_KEY);
  if (!storedState || storedState !== state) throw new Error('OAuth state mismatch — possible CSRF');

  const verifier = localStorage.getItem(CLOUD_PKCE_VERIFIER_KEY);
  if (!verifier) throw new Error('No PKCE verifier found — OAuth flow interrupted');

  const params = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(),
    code_verifier: verifier,
    client_id: clientId,
  });

  const res = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error_description?: string };
    throw new Error(`Dropbox: ${err.error_description ?? res.statusText}`);
  }

  const data = await res.json() as TokenResponse;
  storeTokens('dropbox', {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  });

  localStorage.removeItem(CLOUD_PKCE_VERIFIER_KEY);
  localStorage.removeItem(CLOUD_OAUTH_STATE_KEY);
  localStorage.removeItem(CLOUD_PENDING_PROVIDER_KEY);
}

export async function exchangeGDriveCode(code: string, state: string): Promise<void> {
  const clientId = (import.meta.env.VITE_GDRIVE_CLIENT_ID as string | undefined) ?? '';
  if (!clientId) throw new Error('VITE_GDRIVE_CLIENT_ID is not configured');

  const storedState = localStorage.getItem(CLOUD_OAUTH_STATE_KEY);
  if (!storedState || storedState !== state) throw new Error('OAuth state mismatch — possible CSRF');

  const verifier = localStorage.getItem(CLOUD_PKCE_VERIFIER_KEY);
  if (!verifier) throw new Error('No PKCE verifier found — OAuth flow interrupted');

  const params = new URLSearchParams({
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(),
    code_verifier: verifier,
    client_id: clientId,
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error_description?: string };
    throw new Error(`Google Drive: ${err.error_description ?? res.statusText}`);
  }

  const data = await res.json() as TokenResponse;
  storeTokens('gdrive', {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  });

  localStorage.removeItem(CLOUD_PKCE_VERIFIER_KEY);
  localStorage.removeItem(CLOUD_OAUTH_STATE_KEY);
  localStorage.removeItem(CLOUD_PENDING_PROVIDER_KEY);
}

export function getPendingProvider(): CloudProvider | null {
  return localStorage.getItem(CLOUD_PENDING_PROVIDER_KEY) as CloudProvider | null;
}
