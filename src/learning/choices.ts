import { createHash } from 'node:crypto';
import type { Pool } from 'mysql2/promise';
import { tbl } from '../db/tenants';
import { maskPersonal } from './collect';

const hash = (s: string) => createHash('sha1').update(s.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex');

/**
 * Notes that a customer's message (one the rules could not place on their own, for example "tng") ended with the answer they chose from the bot's choices.
 * It is saved as a suggestion that staff approve or dismiss on the Learning page; the bot never uses it by itself.
 * A message with personal details (phone or bank numbers, emails, links) is not saved at all.
 */
export async function saveChoiceHint(pool: Pool, db: string, text: string, intent: string): Promise<boolean> {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 2 || t.length > 120 || !/\p{L}/u.test(t) || !intent || maskPersonal(t) !== t) return false;
  await pool.query(
    `INSERT INTO ${tbl(db, 'choice_hints')} (text_hash, customer_text, intent_key) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE hits = hits + 1, last_seen = CURRENT_TIMESTAMP`, [hash(t), t, intent.slice(0, 120)]);
  return true;
}
