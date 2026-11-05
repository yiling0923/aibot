import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config';

export const COOKIE = 'aibot_session';
const MAX_AGE_SECONDS = 12 * 3600;

/** Who is signed in. merchant is null for an admin (all merchants) and a merchant code for merchant staff. */
export interface SessionUser { username: string; role: 'admin' | 'staff'; merchant: string | null }

const sign = (p: string, secret: string) => createHmac('sha256', secret).update(p).digest('base64url');

/** A signed value for the cookie: base64url(JSON).signature. Nothing in it can be changed without the secret. */
export function makeSession(u: SessionUser, secret = config.sessionSecret, now = Date.now()): string {
  const p = Buffer.from(JSON.stringify({ ...u, exp: Math.floor(now / 1000) + MAX_AGE_SECONDS })).toString('base64url');
  return `${p}.${sign(p, secret)}`;
}

export function readSession(value: string | undefined, secret = config.sessionSecret, now = Date.now()): SessionUser | null {
  if (!value) return null;
  const [p, s] = value.split('.');
  if (!p || !s) return null;
  const want = Buffer.from(sign(p, secret)), got = Buffer.from(s);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const o = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    if (typeof o.exp !== 'number' || o.exp * 1000 < now) return null;
    if (o.role !== 'admin' && o.role !== 'staff') return null;
    if (o.role === 'staff' && !o.merchant) return null;                  // staff must always belong to one merchant
    return { username: String(o.username), role: o.role, merchant: o.role === 'staff' ? String(o.merchant) : null };
  } catch { return null; }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) { try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ignore a broken cookie */ } }
  }
  return out;
}

export const sessionCookie = (value: string) => `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_SECONDS}`;
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
