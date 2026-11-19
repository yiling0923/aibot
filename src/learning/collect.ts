import { createHash } from 'node:crypto';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { tbl } from '../db/tenants';

/** A customer question and the staff reply that followed it, from the chat history LiveChat sends with every message. */
export interface Pair { customer: string; staff: string | null; at: string | null }

/** Masks what a person should not read later: emails, long numbers (phone, bank, card, ID) and web links. */
export function maskPersonal(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')
    .replace(/https?:\/\/\S+/gi, '[link]')
    .replace(/(?<![\w])\+?\d(?:[ -]?\d){5,}(?!\w)/g, '[number]')
    .replace(/\s+/g, ' ').trim().slice(0, 600);
}

const textOf = (m: unknown): { role: string; text: string; at: string | null } | null => {
  if (!m || typeof m !== 'object') return null;
  const o = m as Record<string, unknown>; const text = typeof o.text === 'string' ? o.text.trim() : '';
  if (!text) return null;
  return { role: o.role === 'user' ? 'user' : 'bot', text, at: typeof o.created_at === 'string' ? o.created_at : null };
};

/**
 * The pairs in a chat: each customer message with the staff messages that came after it, up to the next customer message.
 * While a merchant only listens the bot never replies, so every "bot" message in the history is a person (LiveChat calls an operator "bot").
 * `question` is the message being asked now: it has no reply yet.
 */
export function extractPairs(history: unknown[], question: string): Pair[] {
  const msgs = history.map(textOf).filter((m): m is NonNullable<ReturnType<typeof textOf>> => !!m);
  const out: Pair[] = [];
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role !== 'user') continue;
    const replies: string[] = []; let j = i + 1;
    while (j < msgs.length && msgs[j].role === 'bot') { replies.push(msgs[j].text); j++; }
    out.push({ customer: msgs[i].text, staff: replies.length ? replies.join('\n') : null, at: msgs[i].at });
  }
  const q = question.trim();
  if (q && !(out.length && out[out.length - 1].customer === q && out[out.length - 1].staff === null)) out.push({ customer: q, staff: null, at: null });
  return out;
}

const hash = (s: string) => createHash('sha1').update(s.toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex');

/** Saves the pairs of one chat. A question saved without a reply gets its reply when a later message brings it. Nothing is saved twice. */
export async function recordPairs(pool: Pool, db: string, sessionKey: string, pairs: Pair[], lang: string | null): Promise<number> {
  let n = 0; const T = tbl(db, 'learned_pairs');
  for (const p of pairs) {
    const customer = maskPersonal(p.customer); if (!customer) continue;
    const staff = p.staff ? maskPersonal(p.staff).slice(0, 2000) : null;
    const [r] = await pool.query(`INSERT INTO ${T} (session_key, pair_hash, customer_text, staff_text, lang, customer_at) VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE staff_text = COALESCE(staff_text, VALUES(staff_text))`, [sessionKey.slice(0, 80), hash(p.customer), customer, staff, lang, (() => { const d = p.at ? new Date(p.at) : null; return d && !Number.isNaN(d.getTime()) ? d : null; })()]);
    n += (r as { affectedRows: number }).affectedRows > 0 ? 1 : 0;
  }
  return n;
}

export interface LearnRow extends RowDataPacket { customer_text: string; staff_text: string | null; lang: string | null; created_at: Date }
