export const API = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export function authHeaders(): { Authorization: string } {
  return { Authorization: `Bearer ${localStorage.getItem('device_token')}` };
}
