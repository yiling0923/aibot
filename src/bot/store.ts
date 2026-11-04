import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Pool } from '../db/pool';
import type { Lang } from '../engine/types';

const STOP = new Set('a an the is are was be to of in on at for and or i me my you your it its this that with as by from'.split(' '));

/** Words worth saving from a message: Latin words (2+ letters, no stop words) and runs of Chinese characters. */
export function tokensOf(text: string): string[] {
  const out: string[] = [];
  for (const w of text.toLowerCase().match(/[a-z][a-z0-9_']*/g) ?? []) if (w.length > 1 && !STOP.has(w)) out.push(w);
  for (const w of text.match(/[一-鿿]{1,6}/g) ?? []) out.push(w);
  return [...new Set(out)].map((w) => w.slice(0, 100));
}

/** Saves what the bot hears: every word, and every message it did not understand. Never throws into the chat. */
export class Store {
  private ids = new Map<string, number>();
  constructor(private pool: Pool) {}

  private async merchantId(code: string) {
    let id = this.ids.get(code);
    if (id == null) {
      const [rows] = await this.pool.query<RowDataPacket[]>('SELECT id FROM merchants WHERE code = ?', [code]);
      if (!rows[0]) return null;
      id = Number(rows[0].id); this.ids.set(code, id);
    }
    return id;
  }

  /** Returns the words that were new to this merchant's keyword store. */
  async hear(merchant: string, text: string, lang: Lang, notUnderstood: boolean, source: 'live' | 'test' = 'test'): Promise<{ fresh: string[]; unmatched: boolean }> {
    try {
      const mid = await this.merchantId(merchant); if (mid == null) return { fresh: [], unmatched: false };
      const words = tokensOf(text); const fresh: string[] = [];
      for (const w of words) {
        const wl: Lang = /[一-鿿]/.test(w) ? 'zh' : lang;
        const [r] = await this.pool.query<ResultSetHeader>(
          'INSERT INTO keyword_store(merchant_id, word, language, source) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE hits = hits + 1, last_seen = CURRENT_TIMESTAMP', [mid, w, wl, source]);
        if (r.affectedRows === 1) fresh.push(w);          // 1 = inserted, 2 = updated an existing row
        await this.pool.query('INSERT INTO keyword_daily(merchant_id, word, day, hits) VALUES(?,?,CURDATE(),1) ON DUPLICATE KEY UPDATE hits = hits + 1', [mid, w]);
      }
      if (notUnderstood) await this.pool.query(
        'INSERT INTO unmatched_messages(merchant_id, text, language) VALUES(?,?,?) ON DUPLICATE KEY UPDATE hits = hits + 1, last_seen = CURRENT_TIMESTAMP, resolved = false',
        [mid, text.slice(0, 500), lang]);
      return { fresh, unmatched: notUnderstood };
    } catch (e) { console.error('store.hear failed', e); return { fresh: [], unmatched: false }; }
  }

  /** Writes the conversation log (used for review and, later, for LiveChat). */
  async logTurn(p: { merchant: string; sessionKey: string; customerRef: string | null; text: string; lang: Lang; decision: string; confidence: number; reply: string; matchedKbId: number | null; why?: string }) {
    try {
      const mid = await this.merchantId(p.merchant); if (mid == null) return;
      await this.pool.query('INSERT INTO chat_sessions(merchant_id, livechat_chat_id, customer_ref, language, status) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE language = VALUES(language)',
        [mid, p.sessionKey, p.customerRef, p.lang, 'open']);
      const [s] = await this.pool.query<RowDataPacket[]>('SELECT id FROM chat_sessions WHERE livechat_chat_id = ?', [p.sessionKey]);
      const [m] = await this.pool.query<ResultSetHeader>('INSERT INTO chat_messages(session_id, role, text) VALUES(?,?,?)', [s[0].id, 'customer', p.text]);
      await this.pool.query('INSERT INTO bot_decisions(message_id, decision, matched_kb_id, confidence, reply_text, why) VALUES(?,?,?,?,?,?)',
        [m.insertId, p.decision, p.matchedKbId, p.confidence, p.reply, (p.why ?? '').slice(0, 500)]);
    } catch (e) { console.error('store.logTurn failed', e); }
  }

  async keywordCount(merchant: string) {
    const mid = await this.merchantId(merchant); if (mid == null) return { words: 0, unmatched: 0 };
    const [a] = await this.pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM keyword_store WHERE merchant_id = ?', [mid]);
    const [b] = await this.pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM unmatched_messages WHERE merchant_id = ? AND resolved = false', [mid]);
    return { words: Number(a[0].n), unmatched: Number(b[0].n) };
  }
}
