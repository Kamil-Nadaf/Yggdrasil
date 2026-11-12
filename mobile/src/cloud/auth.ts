/** Google sign-in on the phone without a browser redirect: the "device code" flow (drive.file scope). */
import { AuthError } from './drive.ts';

const DEVICE = 'https://oauth2.googleapis.com/device/code';
const TOKEN = 'https://oauth2.googleapis.com/token';
export const SCOPE = 'https://www.googleapis.com/auth/drive.file';

export interface DeviceCode { device_code: string; user_code: string; verification_url: string; expires_in: number; interval: number }
export interface Client { id: string; secret: string }

const form = (o: Record<string, string>) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(o).toString() });

export async function startDeviceFlow(c: Client, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<DeviceCode> {
  const r = await fetchImpl(DEVICE, form({ client_id: c.id, scope: SCOPE }));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new AuthError(j.error === 'invalid_client' ? 'Google doesn’t recognise this client ID. It must be a “TVs and Limited Input devices” client.' : j.error_description || j.error || `Google sign-in failed (${r.status})`);
  return { ...j, verification_url: j.verification_url || j.verification_uri || 'https://www.google.com/device' };
}

/** Polls until the user approves on google.com/device. Resolves with the refresh token. */
export async function pollDeviceFlow(c: Client, d: DeviceCode, opts: { signal?: AbortSignal; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}): Promise<{ refresh_token: string; access_token: string; expires_in: number }> {
  const f = opts.fetchImpl ?? fetch.bind(globalThis);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)));
  let wait = Math.max(d.interval || 5, 3) * 1000;
  const deadline = Date.now() + d.expires_in * 1000;
  while (Date.now() < deadline) {
    await sleep(wait);
    if (opts.signal?.aborted) throw new AuthError('Cancelled');
    const r = await f(TOKEN, form({ client_id: c.id, client_secret: c.secret, device_code: d.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }));
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.refresh_token) return j;
    if (j.error === 'authorization_pending') continue;
    if (j.error === 'slow_down') { wait += 5000; continue; }
    if (j.error === 'access_denied') throw new AuthError('Sign-in was cancelled');
    if (j.error === 'expired_token') throw new AuthError('The code expired — start again');
    throw new AuthError(j.error_description || j.error || 'Sign-in failed');
  }
  throw new AuthError('The code expired — start again');
}

export async function refreshAccessToken(c: Client, refresh: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<{ access_token: string; expires_in: number }> {
  const r = await fetchImpl(TOKEN, form({ client_id: c.id, client_secret: c.secret, refresh_token: refresh, grant_type: 'refresh_token' }));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (j.error === 'invalid_grant' || r.status === 400 || r.status === 401) throw new AuthError('Google sign-in expired — sign in again');
    throw new AuthError(j.error_description || `Token refresh failed (${r.status})`);
  }
  return j;
}
