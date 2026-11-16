import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { Pool } from '../db/pool';
import { decryptSecret, encryptSecret, last4 } from '../secrets';
import { fetchAccount, type Account, type ApiResult, type ApiTarget, type MerchantApi } from './merchantApi';

type Fetch = typeof fetch;
const q = async <T extends RowDataPacket = RowDataPacket>(pool: Pool, sql: string, p: unknown[] = []) => (await pool.query<T[]>(sql, p))[0];

export interface ApiInfo { configured: boolean; baseUrl: string | null; keyLast4: string | null; checkedAt: Date | null; error: string | null }

/** Each merchant's API address and key (the key encrypted), the checks of them, and the live API the bot uses. */
export class MerchantApiStore {
  private cache = new Map<string, { at: number; t: ApiTarget | null }>();
  constructor(private pool: Pool, private fetchFn: Fetch = fetch, private timeoutMs = 4000) {}

  /** What the bot calls for this merchant (null: none connected). Kept for a short while, so a busy chat does not read the database each time. */
  async target(code: string): Promise<ApiTarget | null> {
    const hit = this.cache.get(code); if (hit && Date.now() - hit.at < 30_000) return hit.t;
    const [r] = await q(this.pool, 'SELECT a.base_url, a.api_key_encrypted, m.currency FROM merchant_api a JOIN merchants m ON m.id = a.merchant_id WHERE m.code = ?', [code]);
    const key = r ? decryptSecret(String(r.api_key_encrypted)) : null;
    const t = r && key ? { baseUrl: String(r.base_url), apiKey: key, currency: String(r.currency || 'RM') } : null;
    this.cache.set(code, { at: Date.now(), t }); return t;
  }
  forget(code?: string) { if (code) this.cache.delete(code); else this.cache.clear(); }

  async info(code: string): Promise<ApiInfo> {
    const [r] = await q(this.pool, 'SELECT a.* FROM merchant_api a JOIN merchants m ON m.id = a.merchant_id WHERE m.code = ?', [code]);
    return { configured: !!r, baseUrl: r?.base_url ?? null, keyLast4: r?.key_last4 ?? null, checkedAt: r?.checked_at ?? null, error: r?.check_error ?? null };
  }

  /** Tries the address and key with one customer id (nothing is saved). */
  async test(baseUrl: string, apiKey: string, customerId: string, currency = 'RM'): Promise<ApiResult> {
    return fetchAccount({ baseUrl, apiKey, currency }, customerId, this.fetchFn, this.timeoutMs);
  }

  /** Saves the address and key. When a customer id is given the connection is tried first and nothing is saved if the key is refused or the API cannot be reached. */
  async connect(code: string, baseUrl: string, apiKey: string, by: string, testCustomerId = ''): Promise<{ info: ApiInfo; test?: ApiResult }> {
    const [m] = await q(this.pool, "SELECT id, currency FROM merchants WHERE code = ? AND status = 'active'", [code]); if (!m) throw new Error(`There is no merchant ${code}.`);
    const base = baseUrl.trim().replace(/\/+$/, '');
    let test: ApiResult | undefined; let error: string | null = null;
    if (testCustomerId.trim()) {
      test = await this.test(base, apiKey, testCustomerId.trim(), String(m.currency || 'RM'));
      if (test.status === 'error') throw new Error(test.error ?? "The merchant's API did not answer.");   // missing (404) is fine: the key and address work, that customer just does not exist
    } else error = null;
    await this.pool.query('REPLACE INTO merchant_api(merchant_id, base_url, api_key_encrypted, key_last4, checked_at, check_error, updated_by) VALUES(?,?,?,?,?,?,?)',
      [m.id, base, encryptSecret(apiKey), last4(apiKey), testCustomerId.trim() ? new Date() : null, error, by]);
    this.forget(code);
    return { info: await this.info(code), test };
  }
  async disconnect(code: string): Promise<boolean> {
    const [r] = await this.pool.query<ResultSetHeader>('DELETE a FROM merchant_api a JOIN merchants m ON m.id = a.merchant_id WHERE m.code = ?', [code]);
    this.forget(code); return r.affectedRows > 0;
  }

  /** The API the bot uses: a merchant with an API connected is read live (kept for a short while); one without uses the sample customers. */
  live(fallback: MerchantApi, o: { ttlMs?: number } = {}): MerchantApi {
    const ttl = o.ttlMs ?? 30_000;
    const got = new Map<string, { at: number; status: 'ok' | 'missing' | 'error'; account?: Account }>();
    const key = (m: string, id: string) => m + '|' + id;
    return {
      getAccount: (m, id) => { const g = got.get(key(m, id)); return g ? g.account : fallback.getAccount(m, id); },
      failed: (m, id) => got.get(key(m, id))?.status === 'error',
      load: async (m, id) => {
        const t = await this.target(m);
        if (!t) { got.delete(key(m, id)); return 'sample'; }
        const g = got.get(key(m, id)); if (g && Date.now() - g.at < ttl && g.status !== 'error') return g.status;       // an error is tried again at once
        const r = await fetchAccount(t, id, this.fetchFn, this.timeoutMs);
        got.set(key(m, id), { at: Date.now(), status: r.status, account: r.account });
        if (got.size > 2000) for (const k of [...got.keys()].slice(0, 500)) got.delete(k);     // never grows without end
        return r.status;
      },
    };
  }
}
