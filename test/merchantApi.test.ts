import 'dotenv/config';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed, DEMO_ADMIN, DEMO_STAFF_PASSWORD } from '../src/db/seed';
import { buildApp } from '../src/server/app';
import { fetchAccount, parseAccount, whenOf, money, fakeMerchantApi } from '../src/bot/merchantApi';
import { MerchantApiStore } from '../src/bot/merchantApiHttp';
import { Bot, newSession } from '../src/bot/responder';
import { knowledgeFromSeed } from '../src/engine';
import { makeToken } from '../src/bot/token';
import { seedJson, accountsJson } from './helpers';

/** A stand-in for a merchant's own API. */
function fakeMerchant(o: { slowMs?: number; status?: number; body?: unknown } = {}) {
  const calls: { url: string; auth: string | undefined }[] = [];
  const srv = http.createServer((req, res) => {
    calls.push({ url: req.url!, auth: req.headers.authorization });
    const send = () => {
      if (req.headers.authorization !== 'Bearer secret-key-123') { res.writeHead(401); return res.end('{}'); }
      if (o.status) { res.writeHead(o.status); return res.end(JSON.stringify(o.body ?? {})); }
      const m = /^\/bot\/customers\/([^/]+)\/account$/.exec(req.url!);
      if (!m) { res.writeHead(404); return res.end('{}'); }
      if (m[1] === 'nobody') { res.writeHead(404); return res.end('{}'); }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ account: { name: 'Tom Lee', balance: 1250.5, points: 320, tier: 'Gold',
        deposits: [{ id: 'D-9', amount: 100, status: 'Pending', created_at: new Date().toISOString().slice(0, 10) + 'T14:02:00+08:00' }],
        withdrawals: [{ reference: 'W-7', amount: '200', status: 'rejected', created_at: '2020-01-02T09:30:00+08:00' }],
        transactions: [{ ref: 'T-1', type: 'deposit', amount: 100, status: 'completed' }, { amount: 5 }] } }));
    };
    if (o.slowMs) setTimeout(send, o.slowMs); else send();
  });
  return new Promise<{ base: string; calls: typeof calls; close: () => void }>((ok) => srv.listen(0, '127.0.0.1', () => ok({ base: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/bot`, calls, close: () => srv.close() })));
}

describe('reading what a merchant API sends', () => {
  it('formats money, times and statuses the way the bot uses them', () => {
    expect(money(1250.5, 'MYR')).toBe('MYR 1,250.50'); expect(money('1250', 'MYR')).toBe('MYR 1,250.00'); expect(money('RM 99 (bonus)')).toBe('RM 99 (bonus)'); expect(money(null)).toBe('');
    const now = Date.parse('2026-11-16T10:00:00+08:00');
    expect(whenOf('2026-11-16T14:02:00+08:00', now)).toEqual({ day: 'today', hm: '14:02' });
    expect(whenOf('2026-11-15T21:15:00+08:00', now)).toEqual({ day: 'yesterday', hm: '21:15' });
    expect(whenOf('2026-11-13T09:00:00+08:00', now)).toEqual({ day: '3d', hm: '09:00' }); expect(whenOf('nonsense')).toEqual({ day: '', hm: '' });
  });
  it('turns the account into the bot\'s shape, skipping rows it cannot use', () => {
    const a = parseAccount({ name: 'Tom', balance: 10, rank: 'VIP', deposits: [{ ref: 'D1', amount: 5, status: 'SUCCESS' }, { amount: 5 }, 'junk'], transactions: [{ id: 'X', type: 'withdrawal', amount: 7, status: 'in progress' }] }, 'RM')!;
    expect(a).toMatchObject({ name: 'Tom', balance: 'RM 10.00', level: 'VIP' });
    expect(a.deposits).toEqual([{ ref: 'D1', type: 'deposit', amount: 'RM 5.00', day: '', status: 'success' }]);
    expect(a.transactions![0]).toMatchObject({ type: 'withdraw', status: 'processing' });
    expect(parseAccount(null)).toBeNull();
  });
});

describe('calling a merchant API', () => {
  it('sends the key, reads the account, and tells "no such customer" from "could not ask"', async () => {
    const m = await fakeMerchant(); const t = { baseUrl: m.base + '/', apiKey: 'secret-key-123', currency: 'MYR' };
    const ok = await fetchAccount(t, 'tom 8841'); expect(ok.status).toBe('ok');
    expect(m.calls[0]).toEqual({ url: '/bot/customers/tom%208841/account', auth: 'Bearer secret-key-123' });         // the id is encoded, the key is a Bearer token
    expect(ok.account).toMatchObject({ name: 'Tom Lee', balance: 'MYR 1,250.50', points: 320, level: 'Gold' });
    expect(ok.account!.deposits![0]).toMatchObject({ ref: 'D-9', status: 'pending', day: 'today', hm: '14:02' });
    expect(ok.account!.withdrawals![0]).toMatchObject({ ref: 'W-7', status: 'failed' }); expect(ok.account!.transactions).toHaveLength(1);
    expect((await fetchAccount(t, 'nobody')).status).toBe('missing');
    expect(await fetchAccount({ ...t, apiKey: 'wrong' }, 'x')).toMatchObject({ status: 'error', httpStatus: 401 });
    m.close();
    expect((await fetchAccount(t, 'x')).error).toMatch(/Could not reach/);                                          // nothing is listening any more
  });
  it('gives up on a slow API and on one that sends rubbish', async () => {
    const slow = await fakeMerchant({ slowMs: 600 });
    expect((await fetchAccount({ baseUrl: slow.base, apiKey: 'secret-key-123' }, 'tom', fetch, 150)).error).toMatch(/did not answer within/); slow.close();
    const bad = await fakeMerchant({ status: 500 }); expect(await fetchAccount({ baseUrl: bad.base, apiKey: 'secret-key-123' }, 'tom')).toMatchObject({ status: 'error', httpStatus: 500 }); bad.close();
    const junk = await fakeMerchant({ status: 200, body: 'not an object' }); expect((await fetchAccount({ baseUrl: junk.base, apiKey: 'secret-key-123' }, 'tom')).status).toBe('error'); junk.close();
  });
});

const url = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null; let reachable = false;
if (url) { pool = createPool(url, 8); try { await pool.query('select 1'); reachable = true; } catch { /* skipped below */ } }

describe.skipIf(!reachable)('a merchant API connected to a merchant (needs TEST_DATABASE_URL)', () => {
  let app: FastifyInstance; let admin = ''; let staff = ''; let m: Awaited<ReturnType<typeof fakeMerchant>>;
  const call = (cookie: string, method: 'GET' | 'POST' | 'DELETE', path: string, payload?: object) => app.inject({ method, url: path, payload: payload as object, headers: { cookie } });
  beforeAll(async () => {
    await migrate(pool!, { reset: true }); await seed(pool!); m = await fakeMerchant();
    app = await buildApp({ pool: pool!, logger: false });
    const login = async (p: object) => String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: p })).headers['set-cookie']).split(';')[0];
    admin = await login(DEMO_ADMIN); staff = await login({ username: 'luckypay', password: DEMO_STAFF_PASSWORD });
  });
  afterAll(async () => { await app?.close(); await pool?.end(); m.close(); });
  const P = '/api/admin/merchants/MERCH_A/api';

  it('is for admins only', async () => {
    expect((await call(staff, 'GET', P)).statusCode).toBe(403); expect((await call(staff, 'POST', P, { baseUrl: m.base, apiKey: 'secret-key-123' })).statusCode).toBe(403);
    expect((await call(admin, 'GET', '/api/admin/merchants/NOPE/api')).statusCode).toBe(404);
  });
  it('checks what it is given, tests an address without saving it, and refuses a key the API does not accept', async () => {
    expect((await call(admin, 'POST', P, { baseUrl: 'not a url', apiKey: 'secret-key-123' })).statusCode).toBe(400);
    expect((await call(admin, 'POST', P, { baseUrl: m.base, apiKey: 'short' })).statusCode).toBe(400);
    const t = (await call(admin, 'POST', P + '/test', { baseUrl: m.base, apiKey: 'secret-key-123', customerId: 'tom8841' })).json();
    expect(t).toMatchObject({ status: 'ok', account: { name: 'Tom Lee', balance: 'RM 1,250.50', deposits: 1 } });   // in the merchant's own money sign
    expect((await call(admin, 'GET', P)).json().configured).toBe(false);                                          // testing saved nothing
    const bad = await call(admin, 'POST', P, { baseUrl: m.base, apiKey: 'wrong-key-999', testCustomerId: 'tom8841' });
    expect(bad.statusCode).toBe(400); expect(bad.json().error).toMatch(/did not accept the key/); expect((await call(admin, 'GET', P)).json().configured).toBe(false);
  });
  it('saves the key encrypted, never shows it again, and the bot then reads the customer live', async () => {
    const r = await call(admin, 'POST', P, { baseUrl: m.base, apiKey: 'secret-key-123', testCustomerId: 'tom8841' });
    expect(r.statusCode).toBe(200); expect(JSON.stringify(r.json())).not.toContain('secret-key-123'); expect(r.json()).toMatchObject({ configured: true, keyLast4: '-123' });
    const [row] = (await pool!.query<import('mysql2/promise').RowDataPacket[]>('SELECT api_key_encrypted FROM merchant_api'))[0]; expect(String(row.api_key_encrypted)).not.toContain('secret-key-123');
    expect(JSON.stringify((await call(admin, 'GET', P)).json())).not.toContain('secret-key-123');
    // a chat as a logged-in customer: the balance now comes from the merchant's system, not the sample file
    const tok = makeToken({ customer_id: 8841, name: 'Tom' });
    const s = (await call(admin, 'POST', '/api/chat/start', { merchant: 'MERCH_A', token: tok })).json().sessionId;
    const turn = (await call(admin, 'POST', '/api/chat/message', { sessionId: s, text: 'check my balance', silent: true })).json().turn;
    expect(turn.messages.map((x: { text: string }) => x.text).join(' ')).toContain('1,250.50');
    expect(m.calls.some((c) => c.url === '/bot/customers/8841/account')).toBe(true);
  });
  it('can be disconnected, and the merchant goes back to the sample customers', async () => {
    expect((await call(admin, 'POST', P + '/remove', {})).json()).toEqual({ removed: true }); expect((await call(admin, 'GET', P)).json().configured).toBe(false);
  });
});

describe('the bot when the merchant API fails', () => {
  const tok = makeToken({ customer_id: 8841, name: 'Tom' });
  const bot = (api: import('../src/bot/merchantApi').MerchantApi) => new Bot(knowledgeFromSeed(seedJson, accountsJson), api);
  it('says it cannot look right now and offers a person, instead of "no account found"', async () => {
    const down = { getAccount: () => undefined, failed: () => true, load: async () => 'error' as const };
    const s = newSession('api1', 'MERCH_A', tok); const t = (await bot(down).message(s, 'check my balance'))!;
    const said = t.messages.map((x) => x.text).join(' '); expect(said).toMatch(/can't reach your account details/); expect(said).not.toMatch(/no data|not found/i);
    expect(t.buttons?.some((b) => b.kind === 'agent')).toBe(true);
  });
  it('asks the merchant for the customer before answering, and keeps sample data for a merchant with nothing connected', async () => {
    let asked = '';
    const live = { getAccount: (_m: string, id: string) => (asked === id ? { name: 'Tom', balance: 'MYR 7.00' } : undefined), load: async (_m: string, id: string) => { asked = id; return 'ok' as const; } };
    const t = (await bot(live).message(newSession('api2', 'MERCH_A', tok), 'check my balance'))!;
    expect(asked).toBe('8841'); expect(t.messages.map((x) => x.text).join(' ')).toContain('MYR 7.00');
    const sample = (await bot(fakeMerchantApi()).message(newSession('api3', 'MERCH_A', tok), 'check my balance'))!; expect(sample.messages.map((x) => x.text).join(' ')).toContain('1,250');
  });
  it('never asks the merchant in a channel that shows no account data (LiveChat)', async () => {
    let asked = false; const live = { getAccount: () => undefined, load: async () => { asked = true; return 'ok' as const; } };
    const s = newSession('api4', 'MERCH_A', tok); s.noPersonal = true; await bot(live).message(s, 'check my balance'); expect(asked).toBe(false);
  });
  it('MerchantApiStore keeps an answer for a short while and tries again at once after an error', async () => {
    const mm = await fakeMerchant(); const store = new MerchantApiStore(null as never);
    (store as unknown as { target: () => Promise<unknown> }).target = async () => ({ baseUrl: mm.base, apiKey: 'secret-key-123', currency: 'MYR' });
    const api = store.live(fakeMerchantApi());
    expect(await api.load!('MERCH_A', 'tom')).toBe('ok'); expect(await api.load!('MERCH_A', 'tom')).toBe('ok'); expect(mm.calls).toHaveLength(1);        // the second look used the kept answer
    expect(api.getAccount('MERCH_A', 'tom')?.name).toBe('Tom Lee');
    (store as unknown as { target: () => Promise<unknown> }).target = async () => ({ baseUrl: mm.base, apiKey: 'wrong', currency: 'MYR' });
    expect(await api.load!('MERCH_A', 'bob')).toBe('error'); expect(api.failed!('MERCH_A', 'bob')).toBe(true);
    expect(await api.load!('MERCH_A', 'bob')).toBe('error'); expect(mm.calls).toHaveLength(3);                                                         // an error is asked again, not kept
    mm.close();
  });
});
