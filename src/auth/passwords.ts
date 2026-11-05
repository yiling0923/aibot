import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

/** "scrypt$<salt>$<hash>" (hex). Passwords are never stored or logged in plain text. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${scryptSync(password, salt, 64).toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [kind, saltHex, hashHex] = stored.split('$');
  if (kind !== 'scrypt' || !saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, 'hex'), got = scryptSync(password, Buffer.from(saltHex, 'hex'), want.length);
  return want.length === got.length && timingSafeEqual(want, got);
}
