import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Tx { ref: string; type?: 'deposit' | 'withdraw'; amount: string; day: string; hm?: string; status: 'pending' | 'processing' | 'success' | 'failed' }
export interface Account { name: string; balance?: string; points?: number; level?: string; deposits?: Tx[]; withdrawals?: Tx[]; transactions?: Tx[] }

/** Where the bot reads a customer's account. getAccount is read at once (it must not wait): an HTTP implementation fills it by `load` first. */
export interface MerchantApi {
  getAccount(merchant: string, customerId: string): Account | undefined;
  /** Fetches the account from the merchant's system ahead of getAccount. Returns what happened. Optional: the sample data needs no loading. */
  load?(merchant: string, customerId: string): Promise<'ok' | 'missing' | 'error' | 'sample'>;
  /** After `load`: did the merchant's system fail to answer (so "no account found" would be wrong)? */
  failed?(merchant: string, customerId: string): boolean;
}

/** The sample customers in data/fake_accounts.json: for the demo, and for merchants that have no API connected. */
export function fakeMerchantApi(file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/fake_accounts.json')): MerchantApi {
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Record<string, Account>>;
  return { getAccount: (m, id) => (m.startsWith('_') ? undefined : data[m]?.[id]) };
}

/* ---------- the merchant's real API ---------- */

type Fetch = typeof fetch;
const STATUS: Record<string, Tx['status']> = {
  pending: 'pending', submitted: 'pending', waiting: 'pending', created: 'pending', processing: 'processing', in_progress: 'processing', inprogress: 'processing', approved: 'processing',
  success: 'success', successful: 'success', completed: 'success', complete: 'success', done: 'success', paid: 'success',
  failed: 'failed', fail: 'failed', rejected: 'failed', declined: 'failed', cancelled: 'failed', canceled: 'failed', error: 'failed', expired: 'failed',
};
const str = (v: unknown) => (v === null || v === undefined ? '' : String(v)).trim();
/** "MYR 1,250.00" from a number or a text. A text is kept as the merchant wrote it. */
export function money(v: unknown, currency = 'MYR'): string {
  if (typeof v === 'number' && Number.isFinite(v)) return `${currency} ${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const t = str(v); if (!t) return '';
  return /^-?[\d,]+(\.\d+)?$/.test(t) ? money(Number(t.replace(/,/g, '')), currency) : t;
}
/** "today", "yesterday", "3d" and the clock time, from a time as the merchant writes it (an ISO time keeps its own clock and day). */
export function whenOf(iso: unknown, now = Date.now()): { day: string; hm: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(str(iso));
  if (!m) return { day: '', hm: '' };
  const then = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const off = /([+-])(\d{2}):?(\d{2})$/.exec(str(iso)); const mins = off ? (off[1] === '-' ? -1 : 1) * (+off[2] * 60 + +off[3]) : 0;     // today on the clock of the time given
  const t = new Date(now + mins * 60000); const today = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
  const d = Math.round((today - then) / 86400000);
  return { day: d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + 'd', hm: `${m[4]}:${m[5]}` };
}
function tx(r: Record<string, unknown>, type: Tx['type'] | undefined, currency: string, now: number): Tx | null {
  const ref = str(r.ref ?? r.id ?? r.reference ?? r.transaction_id), amount = money(r.amount, currency); if (!ref || !amount) return null;
  const st = STATUS[str(r.status).toLowerCase().replace(/[\s-]+/g, '_')] ?? 'pending';
  const w = r.created_at || r.time || r.date ? whenOf(r.created_at ?? r.time ?? r.date, now) : { day: str(r.day), hm: str(r.hm) };
  const ty = str(r.type).toLowerCase(); const kind = type ?? (/^(deposit|dep|in|topup)$/.test(ty) ? 'deposit' : /^(withdraw|withdrawal|wd|out|cashout)$/.test(ty) ? 'withdraw' : undefined);
  return { ref, ...(kind ? { type: kind } : {}), amount, day: w.day, ...(w.hm ? { hm: w.hm } : {}), status: st };
}
/** Turns what a merchant's API sends into the shape the bot uses. Unknown fields are ignored; a transaction without a reference or amount is skipped. */
export function parseAccount(j: unknown, currency = 'MYR', now = Date.now()): Account | null {
  if (!j || typeof j !== 'object') return null;
  const o = ((j as Record<string, unknown>).account ?? (j as Record<string, unknown>).data ?? j) as Record<string, unknown>;
  const list = (v: unknown, type: Tx['type'] | undefined) => (Array.isArray(v) ? v : []).slice(0, 20).map((r) => (r && typeof r === 'object' ? tx(r as Record<string, unknown>, type, currency, now) : null)).filter((x): x is Tx => !!x);
  const pts = o.points ?? o.loyalty_points;
  return {
    name: str(o.name ?? o.display_name ?? o.username), ...(o.balance !== undefined && o.balance !== null ? { balance: money(o.balance, currency) } : {}),
    ...(pts !== undefined && pts !== null && Number.isFinite(Number(pts)) ? { points: Number(pts) } : {}), ...(str(o.level ?? o.rank ?? o.tier) ? { level: str(o.level ?? o.rank ?? o.tier) } : {}),
    deposits: list(o.deposits, 'deposit'), withdrawals: list(o.withdrawals, 'withdraw'), transactions: list(o.transactions, undefined),
  };
}

export interface ApiTarget { baseUrl: string; apiKey: string; currency?: string }
export interface ApiResult { status: 'ok' | 'missing' | 'error'; account?: Account; error?: string; httpStatus?: number }

/** One call to a merchant's API: GET {baseUrl}/customers/{id}/account with the key as a Bearer token. 404 = no such customer. */
export async function fetchAccount(t: ApiTarget, customerId: string, f: Fetch = fetch, timeoutMs = 4000, now = Date.now()): Promise<ApiResult> {
  const url = t.baseUrl.replace(/\/+$/, '') + '/customers/' + encodeURIComponent(customerId) + '/account';
  let r: Response;
  try { r = await f(url, { method: 'GET', headers: { authorization: 'Bearer ' + t.apiKey, accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) }); }
  catch (e) { return { status: 'error', error: (e as Error).name === 'TimeoutError' ? `The merchant's API did not answer within ${Math.round(timeoutMs / 1000)} seconds.` : "Could not reach the merchant's API at " + t.baseUrl + '.' }; }
  if (r.status === 404) return { status: 'missing', httpStatus: 404 };
  if (r.status === 401 || r.status === 403) return { status: 'error', httpStatus: r.status, error: "The merchant's API did not accept the key (" + r.status + ')' + '.' };
  if (!r.ok) return { status: 'error', httpStatus: r.status, error: `The merchant's API answered ${r.status}.` };
  let j: unknown; try { j = await r.json(); } catch { return { status: 'error', error: "The merchant's API did not send JSON." }; }
  const account = parseAccount(j, t.currency ?? 'MYR', now);
  return account ? { status: 'ok', account } : { status: 'error', error: "The merchant's API sent something the bot cannot read." };
}
