import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed, DEMO_ADMIN, DEMO_STAFF_PASSWORD } from '../src/db/seed';
import { buildApp } from '../src/server/app';
import { extractPairs, maskPersonal } from '../src/learning/collect';

describe('what the bot saves while it only listens (no database)', () => {
  it('masks emails, links and long numbers, and keeps ordinary words', () => {
    expect(maskPersonal('call 012-345 6789 or mail a.b@x.com, see https://x.test/p?q=1')).toBe('call [number] or mail [email], see [link]');
    expect(maskPersonal('deposit RM50 failed, ref 4821')).toBe('deposit RM50 failed, ref 4821');
  });
  it('pairs each customer message with the staff replies that follow it; LiveChat calls staff "bot"', () => {
    const h = [{ role: 'user', text: 'how long deposit' }, { role: 'bot', text: 'About 5 min.' }, { role: 'bot', text: 'Send receipt if later.' }, { role: 'user', text: 'ok thanks' }];
    expect(extractPairs(h, 'withdraw time?')).toEqual([
      { customer: 'how long deposit', staff: 'About 5 min.\nSend receipt if later.', at: null },
      { customer: 'ok thanks', staff: null, at: null },
      { customer: 'withdraw time?', staff: null, at: null }]);
    expect(extractPairs([], 'hi')).toEqual([{ customer: 'hi', staff: null, at: null }]);
    expect(extractPairs([{ role: 'user', text: 'hi' }], 'hi')).toEqual([{ customer: 'hi', staff: null, at: null }]);         // the question itself is not counted twice
  });
});

const url = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null; let reachable = false;
if (url) { pool = createPool(url, 6); try { await pool.query('select 1'); reachable = true; } catch { /* skipped below */ } }

describe.skipIf(!reachable)('a merchant that listens first, then answers (needs TEST_DATABASE_URL)', () => {
  let app: FastifyInstance; let admin = ''; let staff = ''; let key = '';
  const as = (cookie: string, method: 'GET' | 'POST', path: string, payload?: object) => app.inject({ method, url: path, payload: payload as object, headers: { cookie } });
  const ask = (payload: object) => app.inject({ method: 'POST', url: '/api/v1/ai/ask', payload, headers: { authorization: 'Bearer ' + key } });
  beforeAll(async () => {
    await migrate(pool!, { reset: true }); await seed(pool!);
    app = await buildApp({ pool: pool!, logger: false });
    const login = async (payload: object) => String((await app.inject({ method: 'POST', url: '/api/auth/login', payload })).headers['set-cookie']).split(';')[0];
    admin = await login(DEMO_ADMIN); staff = await login({ username: 'luckypay', password: DEMO_STAFF_PASSWORD });
    key = (await as(admin, 'POST', '/api/admin/merchants/MERCH_A/bot-key', {})).json().key;
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it('only an admin can switch the mode, and the switch rejects a wrong value', async () => {
    expect((await as(staff, 'POST', '/api/admin/merchants/MERCH_A/mode', { mode: 'listening' })).statusCode).toBe(403);
    expect((await as(admin, 'POST', '/api/admin/merchants/MERCH_A/mode', { mode: 'sleeping' })).statusCode).toBe(400);
    expect((await as(admin, 'POST', '/api/admin/merchants/MERCH_A/mode', { mode: 'listening' })).json()).toEqual({ ok: true, mode: 'listening' });
  });

  it('while listening the bot stays silent, saves the question and the staff reply, and masks personal details', async () => {
    const r = (await ask({ question: 'how long does deposit take', session_id: 'l-1', history: [] })).json();
    expect(r.decision).toBe('silent'); expect(r.answer).toBe(''); expect(r.should_escalate).toBe(false); expect(r.should_close).toBe(false);
    const r2 = (await ask({ question: 'my number is 0123456789 please call', session_id: 'l-1', history: [{ role: 'user', text: 'how long does deposit take' }, { role: 'bot', text: 'About 5 minutes, usually.' }] })).json();
    expect(r2.decision).toBe('silent');
    await ask({ question: 'ok', session_id: 'l-1', history: [{ role: 'user', text: 'how long does deposit take' }, { role: 'bot', text: 'About 5 minutes, usually.' }, { role: 'user', text: 'my number is 0123456789 please call' }, { role: 'bot', text: 'We will call 0198765432 soon.' }] });
    const [rows] = await pool!.query<import('mysql2/promise').RowDataPacket[]>('SELECT customer_text, staff_text FROM `' + (await dbOf('MERCH_A')) + '`.learned_pairs ORDER BY id');
    const deposit = rows.find((x) => x.customer_text === 'how long does deposit take'); expect(deposit?.staff_text).toBe('About 5 minutes, usually.');   // the reply arrived with a later message
    const call = rows.find((x) => /please call/.test(x.customer_text)); expect(call?.customer_text).toBe('my number is [number] please call'); expect(call?.staff_text).toBe('We will call [number] soon.');
    expect(JSON.stringify(rows)).not.toMatch(/0123456789|0198765432/);
  });

  it('the Learning screen shows the days, chats and pairs, groups by what was asked, and staff can read their own merchant', async () => {
    await ask({ question: 'how long does deposit take', session_id: 'l-2', history: [{ role: 'user', text: 'how long does deposit take' }, { role: 'bot', text: 'About 5 minutes, usually.' }] });
    for (const who of [admin, staff]) {
      const r = (await as(who, 'GET', '/api/admin/learning?merchant=MERCH_A')).json();
      expect(r.mode).toBe('listening'); expect(r.chats).toBeGreaterThanOrEqual(2); expect(r.pairs).toBeGreaterThanOrEqual(3); expect(r.withReply).toBeGreaterThanOrEqual(2);
      expect(r.groups.length).toBeGreaterThan(0); expect(r.groups[0].count).toBeGreaterThanOrEqual(1);
      const dep = r.groups.find((g: { customers: { text: string }[] }) => g.customers.some((c) => c.text === 'how long does deposit take'));
      expect(dep.count).toBeGreaterThanOrEqual(2); expect(dep.replies[0].text).toBe('About 5 minutes, usually.');
    }
    expect((await as(staff, 'GET', '/api/admin/learning?merchant=MERCH_B')).statusCode).toBe(403);
  });

  it('after the admin switches to answering, the bot answers from the knowledge base again, and the merchant list says which mode it is in', async () => {
    const state = (await as(admin, 'GET', '/api/admin/state')).json();
    expect(state.merchants.find((m: { code: string }) => m.code === 'MERCH_A')).toMatchObject({ bot_mode: 'listening' });
    expect((await as(admin, 'POST', '/api/admin/merchants/MERCH_A/mode', { mode: 'answering' })).json().mode).toBe('answering');
    const r = (await ask({ question: 'how to deposit', session_id: 'l-3' })).json();
    expect(r.decision).toBe('answer'); expect(r.answer).not.toBe('');
  });

  it('learns from an export of old chats: pairs customer questions with staff replies, masks personal details, and counts them on the Learning screen', async () => {
    const before = (await as(admin, 'GET', '/api/admin/learning?merchant=MERCH_A')).json();
    const messages = [
      { chat: 'c1', from: 'customer', text: 'refund how long' }, { chat: 'c1', from: 'staff', text: 'Refunds take 3 days. Call 0123456789 if late.' },
      { chat: 'c1', from: 'customer', text: 'ok' },
      { chat: 'c2', from: 'customer', text: 'refund how long', at: '2026-10-01 10:00' }, { chat: 'c2', from: 'staff', text: 'Refunds take 3 days.', at: '2026-10-01 10:02' },
      { chat: 'c3', from: 'robot', text: 'ignored: not a customer or staff' }, { chat: '', from: 'customer', text: 'ignored: no chat' }];
    const r = await as(admin, 'POST', '/api/admin/learning/import', { merchant: 'MERCH_A', messages });
    expect(r.json()).toEqual({ chats: 2, pairs: 3, withReply: 2 });
    const after = (await as(admin, 'GET', '/api/admin/learning?merchant=MERCH_A')).json();
    expect(after.chats).toBe(before.chats + 2); expect(after.withReply).toBe(before.withReply + 2);
    const g = after.groups.find((x: { customers: { text: string }[] }) => x.customers.some((c) => c.text === 'refund how long'));
    expect(g.count).toBe(2); expect(g.replies[0].text).toBe('Refunds take 3 days.');
    const [rows] = await pool!.query<import('mysql2/promise').RowDataPacket[]>('SELECT staff_text FROM `' + (await dbOf('MERCH_A')) + '`.learned_pairs WHERE staff_text LIKE ?', ['Refunds take 3 days. Call%']);
    expect(rows[0].staff_text).toBe('Refunds take 3 days. Call [number] if late.');
    const again = await as(admin, 'POST', '/api/admin/learning/import', { merchant: 'MERCH_A', messages });          // the same file twice saves nothing twice
    expect(again.json().pairs).toBe(3); expect((await as(admin, 'GET', '/api/admin/learning?merchant=MERCH_A')).json().pairs).toBe(after.pairs);
  });

  it('refuses an import with no messages, too many, or for another merchant', async () => {
    expect((await as(admin, 'POST', '/api/admin/learning/import', { merchant: 'MERCH_A', messages: [] })).statusCode).toBe(400);
    expect((await as(admin, 'POST', '/api/admin/learning/import', { merchant: 'MERCH_A', messages: Array.from({ length: 3001 }, () => ({ chat: 'x', from: 'customer', text: 'hi' })) })).statusCode).toBe(400);
    expect((await as(staff, 'POST', '/api/admin/learning/import', { merchant: 'MERCH_B', messages: [{ chat: 'x', from: 'customer', text: 'hi' }] })).statusCode).toBe(403);
    expect((await as(staff, 'POST', '/api/admin/learning/import', { merchant: 'MERCH_A', messages: [{ chat: 'x', from: 'customer', text: 'hi' }] })).statusCode).toBe(200);   // staff may import for their own merchant
  });

  it('a merchant created from now on starts by listening', async () => {
    const r = await as(admin, 'POST', '/api/admin/merchants', { name: 'Fresh Pay', code: 'FRESH1', language: 'en' });
    expect([200, 201]).toContain(r.statusCode);
    const [m] = await pool!.query<import('mysql2/promise').RowDataPacket[]>('SELECT bot_mode, listening_since FROM merchants WHERE code = ?', ['FRESH1']);
    expect(m[0].bot_mode).toBe('listening'); expect(m[0].listening_since).not.toBeNull();
    const [old] = await pool!.query<import('mysql2/promise').RowDataPacket[]>("SELECT bot_mode FROM merchants WHERE code = 'MERCH_B'");
    expect(old[0].bot_mode).toBe('answering');                                                           // the seeded merchants are unchanged
  });

  async function dbOf(code: string) { const [r] = await pool!.query<import('mysql2/promise').RowDataPacket[]>('SELECT db_name FROM merchants WHERE code = ?', [code]); return String(r[0].db_name); }
});
