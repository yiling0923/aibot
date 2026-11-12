import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from './config';

/** Keeps a secret (an AI provider key) unreadable in the database. AES-256-GCM, the key made from SECRETS_KEY (or SESSION_SECRET when that is not set).
 *  Change SECRETS_KEY and the saved keys can no longer be read: they must be entered again. */
const keyOf = (secret: string) => createHash('sha256').update('livechat-bot-secrets:' + secret).digest();
const secretNow = () => config.secretsKey || config.sessionSecret;

export function encryptSecret(plain: string, secret = secretNow()): string {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', keyOf(secret), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), body.toString('base64')].join(':');
}

/** The secret, or null when it cannot be read (wrong SECRETS_KEY, damaged text). */
export function decryptSecret(stored: string, secret = secretNow()): string | null {
  try {
    const [v, iv, tag, body] = stored.split(':'); if (v !== 'v1') return null;
    const d = createDecipheriv('aes-256-gcm', keyOf(secret), Buffer.from(iv, 'base64')); d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(body, 'base64')), d.final()]).toString('utf8');
  } catch { return null; }
}

/** What may be shown of a key: only its last 4 characters. */
export const last4 = (key: string) => key.slice(-4);
