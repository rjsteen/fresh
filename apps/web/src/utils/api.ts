export const API = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

// Inline token reader to avoid a circular dep (useAuth imports API from here).
function getToken(): string | null {
  const raw = localStorage.getItem('device_token');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { token?: unknown; expiresAt?: unknown };
    if (typeof parsed.token === 'string' && typeof parsed.expiresAt === 'number') {
      return Date.now() < parsed.expiresAt ? parsed.token : null;
    }
  } catch {
    // Legacy raw-string token
  }
  return raw;
}

/**
 * Drop-in fetch replacement that:
 *  - attaches Authorization: Bearer <token> on every request
 *  - fires 'auth:expired' and redirects to /login on 401
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(input, { ...init, headers });

  if (res.status === 401) {
    window.dispatchEvent(new Event('auth:expired'));
  }

  return res;
}

/** @deprecated Use apiFetch instead */
export function authHeaders(): { Authorization: string } {
  return { Authorization: `Bearer ${getToken()}` };
}
