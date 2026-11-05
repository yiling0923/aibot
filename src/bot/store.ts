import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Pool } from '../db/pool';
import { Tenants, tbl } from '../db/tenants';
import type { Lang } from '../engine/types';

const STOP = new Set('a an the is are was be to of in on at for and or i me my you your it its this that with as by from'.split(' '));

/** Words worth saving from a message: Latin words (2+ letters, no stop words) and runs of Chinese characters. */
export function tokensOf(text: string): string[] {
  const out: string[] = [];
  for (const w of text.toLowerCase().match(/[a-z][a-z0-9_']*/g) ?? []) if (w.length > 1 && !STOP.has(w)) out.push(w);
  for (const w of text.match(/[一-鿿]{1,6}/g) ?? []) out.push(w);
  return [...new Set(out)].map((w) => w.slice(0, 100));
}

/** Saves what the bot hears: every word, and every message it did not understand. Never throws into the chat.
 *  Everything is saved into the merchant's own database. */
export class Store {
  private tenants: Tenants;
  private dbs = new Map<string, string>();
  constructor(private pool: Pool) { this.tenants = new Tenants(pool); }

  /** The merchant's table, e.g. `livechat_bot_m_w88`.`keyword_store` (null when there is no such merchant). */
  private async t(code: string, table: string) {
    let db = this.dbs.get(code);
    if (!db) { db = (await this.tenants.get(code))?.db; if (!db) return null; this.dbs.set(code, db); }
    return tbl(db, table);
  }

  /** Returns the words that were new to this merchant's keyword store. */
  async hear(merchant: string, text: string, lang: Lang, notUnderstood: boolean, source: 'live' | 'test' = 'test'): Promise<{ fresh: string[]; unmatched: boolean }> {
    try {
      const K = await this.t(merchant, 'keyword_store'); if (!K) return { fresh: [], unmatched: false };
      const DAILY = (await this.t(merchant, 'keyword_daily'))!, U = (await this.t(merchant, 'unmatched_messages'))!;
      const words = tokensOf(text); const fresh: string[] = [];
      for (const w of words) {
        const wl: Lang = /[一-鿿]/.test(w) ? 'zh' : lang;
        const [r] = await this.pool.query<ResultSetHeader>(
          `INSERT INTO ${K}(word, language, source) VALUES(?,?,?) ON DUPLICATE KEY UPDATE hits = hits + 1, last_seen = CURRENT_TIMESTAMP`, [w, wl, source]);
        if (r.affectedRows === 1) fresh.push(w);          // 1 = inserted, 2 = updated an existing row
        await this.pool.query(`INSERT INTO ${DAILY}(word, day, hits) VALUES(?,CURDATE(),1) ON DUPLICATE KEY UPDATE hits = hits + 1`, [w]);
      }
      if (notUnderstood) await this.pool.query(
        `INSERT INTO ${U}(text, language) VALUES(?,?) ON DUPLICATE KEY UPDATE hits = hits + 1, last_seen = CURRENT_TIMESTAMP, resolved = false`,
        [text.slice(0, 500), lang]);
      return { fresh, unmatched: notUnderstood };
    } catch (e) { console.error('store.hear failed', e); return { fresh: [], unmatched: false }; }
  }

  /** Writes the conversation log (used for review and, later, for LiveChat). */
  async logTurn(p: { merchant: string; sessionKey: string; customerRef: string | null; text: string; lang: Lang; decision: string; confidence: number; reply: string; matchedKbId: number | null; why?: string }) {
    try {
      const S = await this.t(p.merchant, 'chat_sessions'); if (!S) return;
      const M = (await this.t(p.merchant, 'chat_messages'))!, D = (await this.t(p.merchant, 'bot_decisions'))!;
      await this.pool.query(`INSERT INTO ${S}(livechat_chat_id, customer_ref, language, status) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE language = VALUES(language)`, [p.sessionKey, p.customerRef, p.lang, 'open']);
      const [s] = await this.pool.query<RowDataPacket[]>(`SELECT id FROM ${S} WHERE livechat_chat_id = ?`, [p.sessionKey]);
      const [m] = await this.pool.query<ResultSetHeader>(`INSERT INTO ${M}(session_id, role, text) VALUES(?,?,?)`, [s[0].id, 'customer', p.text]);
      await this.pool.query(`INSERT INTO ${D}(message_id, decision, matched_kb_id, confidence, reply_text, why) VALUES(?,?,?,?,?,?)`,
        [m.insertId, p.decision, p.matchedKbId, p.confidence, p.reply, (p.why ?? '').slice(0, 500)]);
    } catch (e) { console.error('store.logTurn failed', e); }
  }

  /** Saves Claude's description and suggested type for a keyword, unless someone already wrote one. */
  async setNote(merchant: string, word: string, note: string, type: string) {
    try {
      const K = await this.t(merchant, 'keyword_store'); if (!K) return;
      await this.pool.query(`UPDATE ${K} SET note = ?, guess = ? WHERE word = ? AND note IS NULL`, [note.slice(0, 200), type, word]);
    } catch (e) { console.error('store.setNote failed', e); }
  }

  async keywordCount(merchant: string) {
    const K = await this.t(merchant, 'keyword_store'); if (!K) return { words: 0, unmatched: 0 };
    const U = (await this.t(merchant, 'unmatched_messages'))!;
    const [a] = await this.pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${K}`);
    const [b] = await this.pool.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${U} WHERE resolved = false`);
    return { words: Number(a[0].n), unmatched: Number(b[0].n) };
  }
}
