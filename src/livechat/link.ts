import type { RowDataPacket } from 'mysql2/promise';
import type { Pool } from '../db/pool';
import { decryptSecret, encryptSecret } from '../secrets';

type Fetch = typeof fetch;
export interface LinkInfo { configured: boolean; baseUrl: string | null; email: string | null; handoffAfterReplies: number | null; syncedAt: Date | null; error: string | null }
const q = async <T extends RowDataPacket = RowDataPacket>(pool: Pool, sql: string, p: unknown[] = []) => (await pool.query<T[]>(sql, p))[0];
const clampN = (n: unknown) => Math.max(0, Math.min(100, Math.round(Number(n))));      // LiveChat accepts 0-100

/**
 * Keeps one number the same in the bot and in LiveChat: ai_handoff_prompt_after_replies
 * ("after this many bot replies, ask the customer if they want a person").
 * LiveChat is the source of truth. Reads copy its value here; a change made in the bot panel goes to LiveChat first,
 * and is saved here only when LiveChat accepted it, so the two can never disagree after a failed save.
 */
export class LiveChatLink {
  constructor(private pool: Pool, private fetchFn: Fetch = fetch, private timeoutMs = 8000) {}

  private async call(base: string, cookie: string | null, path: string, method: string, body?: unknown): Promise<Response> {
    return this.fetchFn(base.replace(/\/+$/, '') + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs) });
  }
  private async login(base: string, email: string, password: string): Promise<string> {
    const r = await this.call(base, null, '/login', 'POST', { email, password });
    if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? 'LiveChat did not accept this email and password.' : `LiveChat login failed (${r.status}).`);
    const raw = (r.headers.getSetCookie?.() ?? [r.headers.get('set-cookie') ?? '']).filter(Boolean);
    const cookie = raw.map((c) => c.split(';')[0]).join('; ');
    if (!cookie) throw new Error('LiveChat accepted the login but sent no session.');
    return cookie;
  }
  private readNumber(j: Record<string, unknown>): number {
    const v = j.ai_handoff_prompt_after_replies ?? (j.automation as Record<string, unknown> | undefined)?.ai_handoff_prompt_after_replies;
    if (v === undefined || v === null || Number.isNaN(Number(v))) throw new Error('LiveChat did not return ai_handoff_prompt_after_replies.');
    return clampN(v);
  }
  private async row(code: string) {
    const [r] = await q(this.pool, 'SELECT l.*, m.id AS mid FROM merchant_livechat l JOIN merchants m ON m.id = l.merchant_id WHERE m.code = ?', [code]); return r;
  }

  async info(code: string): Promise<LinkInfo> {
    const r = await this.row(code);
    return { configured: !!r, baseUrl: r?.base_url ?? null, email: r?.email ?? null, handoffAfterReplies: r?.handoff_after_replies ?? null, syncedAt: r?.synced_at ?? null, error: r?.sync_error ?? null };
  }

  /** Saves the LiveChat address and login (password stored encrypted), checks them, and copies the current number. */
  async connect(code: string, baseUrl: string, email: string, password: string, by: string): Promise<LinkInfo> {
    const [m] = await q(this.pool, "SELECT id FROM merchants WHERE code = ? AND status = 'active'", [code]); if (!m) throw new Error(`There is no merchant ${code}.`);
    const base = baseUrl.trim().replace(/\/+$/, '');
    const cookie = await this.login(base, email, password);                                    // fail before saving anything
    const value = await this.fetchNumber(base, cookie);
    await this.pool.query('REPLACE INTO merchant_livechat(merchant_id, base_url, email, password_encrypted, handoff_after_replies, synced_at, sync_error, updated_by) VALUES(?,?,?,?,?,NOW(),NULL,?)', [m.id, base, email.trim(), encryptSecret(password), value, by]);
    return this.info(code);
  }
  async disconnect(code: string): Promise<boolean> {
    const [r] = await this.pool.query<import('mysql2/promise').ResultSetHeader>('DELETE l FROM merchant_livechat l JOIN merchants m ON m.id = l.merchant_id WHERE m.code = ?', [code]); return r.affectedRows > 0;
  }
  private async fetchNumber(base: string, cookie: string): Promise<number> {
    const r = await this.call(base, cookie, '/merchant/automation', 'GET');
    if (!r.ok) throw new Error(`LiveChat would not show its automation settings (${r.status}).`);
    return this.readNumber((await r.json()) as Record<string, unknown>);
  }
  private async session(code: string) {
    const r = await this.row(code); if (!r) throw new Error('This merchant is not connected to LiveChat yet.');
    const password = decryptSecret(r.password_encrypted); if (!password) throw new Error('The saved LiveChat password cannot be read. Enter it again.');
    return { r, cookie: await this.login(r.base_url, r.email, password) };
  }

  /** Copies LiveChat's number into the bot. Returns the number; a failure is remembered and shown on the merchant page. */
  async pull(code: string): Promise<number> {
    try {
      const { r, cookie } = await this.session(code); const n = await this.fetchNumber(r.base_url, cookie);
      await this.pool.query('UPDATE merchant_livechat SET handoff_after_replies = ?, synced_at = NOW(), sync_error = NULL WHERE merchant_id = ?', [n, r.merchant_id]); return n;
    } catch (e) { await this.pool.query('UPDATE merchant_livechat l JOIN merchants m ON m.id = l.merchant_id SET l.sync_error = ? WHERE m.code = ?', [(e as Error).message.slice(0, 290), code]).catch(() => undefined); throw e; }
  }
  /** Sets the number in LiveChat, reads it back to be sure, and only then saves it in the bot. */
  async push(code: string, value: number): Promise<number> {
    const n = clampN(value); if (!Number.isFinite(Number(value))) throw new Error('Enter a whole number from 0 to 100.');
    const { r, cookie } = await this.session(code);
    const res = await this.call(r.base_url, cookie, '/merchant/automation', 'PATCH', { ai_handoff_prompt_after_replies: n });
    if (!res.ok) throw new Error(`LiveChat did not accept the change (${res.status}). Nothing was changed.`);
    const back = await this.fetchNumber(r.base_url, cookie);
    if (back !== n) throw new Error(`LiveChat now says ${back}, not ${n}. The bot copied LiveChat's number.`);
    await this.pool.query('UPDATE merchant_livechat SET handoff_after_replies = ?, synced_at = NOW(), sync_error = NULL WHERE merchant_id = ?', [back, r.merchant_id]); return back;
  }
  /** Pulls every connected merchant (run on a timer), so a change made in LiveChat shows up here without anyone opening a page. */
  async pullAll(): Promise<{ code: string; ok: boolean }[]> {
    const rows = await q(this.pool, "SELECT m.code FROM merchant_livechat l JOIN merchants m ON m.id = l.merchant_id WHERE m.status = 'active'");
    const out: { code: string; ok: boolean }[] = [];
    for (const r of rows) { try { await this.pull(r.code); out.push({ code: r.code, ok: true }); } catch { out.push({ code: r.code, ok: false }); } }
    return out;
  }
}
