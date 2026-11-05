import type { RowDataPacket } from 'mysql2/promise';
import type { Pool } from '../db/pool';
import { hashPassword, verifyPassword } from './passwords';
import type { SessionUser } from './session';

// A hash to compare against when the user does not exist, so a wrong username takes as long as a wrong password.
const DUMMY = hashPassword('not-a-real-password');

export async function checkLogin(pool: Pool, username: string, password: string): Promise<SessionUser | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT u.username, u.password_hash, u.role, m.code AS merchant FROM admin_users u LEFT JOIN merchants m ON m.id = u.merchant_id WHERE u.username = ?`,
    [username.trim().toLowerCase()]);
  const u = rows[0];
  const ok = verifyPassword(password, u ? u.password_hash : DUMMY);
  if (!u || !ok) return null;
  if (u.role === 'staff' && !u.merchant) return null;
  return { username: u.username, role: u.role, merchant: u.role === 'staff' ? u.merchant : null };
}

/** Creates the user, or changes the password and merchant of an existing one. */
export async function upsertUser(pool: Pool, p: { username: string; password: string; role: 'admin' | 'staff'; merchant?: string | null }) {
  const username = p.username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,50}$/.test(username)) throw new Error('username: use 2-50 letters, digits, dot, dash or underscore');
  if (p.password.length < 6) throw new Error('password: at least 6 characters');
  let merchantId: number | null = null;
  if (p.role === 'staff') {
    const [m] = await pool.query<RowDataPacket[]>('SELECT id FROM merchants WHERE code = ?', [p.merchant ?? '']);
    if (!m[0]) throw new Error(`no merchant with code "${p.merchant}"`);
    merchantId = Number(m[0].id);
  }
  await pool.query(
    `INSERT INTO admin_users(username, password_hash, role, merchant_id) VALUES(?,?,?,?)
     ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), role = VALUES(role), merchant_id = VALUES(merchant_id)`,
    [username, hashPassword(p.password), p.role, merchantId]);
}
