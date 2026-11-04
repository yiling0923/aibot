import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config';

export type TokenCheck =
  | { state: 'none' }
  | { state: 'invalid' }
  | { state: 'valid'; id: string; name: string };

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
export const signPart = (payload: string, secret = config.tokenSecret) => createHmac('sha256', secret).update(payload).digest('hex');

/** The merchant website builds this and sends it with the chat: base64url(JSON).signature */
export function makeToken(payload: { customer_id: number | string; name: string }, secret = config.tokenSecret) {
  const p = b64(payload);
  return `${p}.${signPart(p, secret)}`;
}

/** The customer id is only trusted when the signature matches. It is never taken from what the customer types. */
export function checkToken(token: string | null | undefined, secret = config.tokenSecret): TokenCheck {
  if (!token) return { state: 'none' };
  const [p, s] = token.split('.');
  if (!p || !s) return { state: 'invalid' };
  const want = Buffer.from(signPart(p, secret)), got = Buffer.from(s);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { state: 'invalid' };
  try {
    const o = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    return { state: 'valid', id: String(o.customer_id), name: String(o.name ?? '') };
  } catch { return { state: 'invalid' }; }
}
