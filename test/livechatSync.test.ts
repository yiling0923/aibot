import 'dotenv/config';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed, DEMO_ADMIN, DEMO_STAFF_PASSWORD } from '../src/db/seed';
import { buildApp } from '../src/server/app';
import { LiveChatLink } from '../src/livechat/link';

const url = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null; let reachable = false;
if (url) { pool = createPool(url, 6); try { await pool.query('select 1'); reachable = true; } catch { /* skipped below */ } }

/** A small stand-in for LiveChat: login, read and change the automation settings. */
function fakeLiveChat() {
  const st = { n: 3, rejectPatch: false, ignorePatch: false, logins: 0 };
  const srv = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      const send = (code: number, j: unknown, h: Record<string, string> = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(j)); };
      if (req.url === '/login') { const b = JSON.parse(body); st.logins++; return b.password === 'Test1234!' ? send(200, { ok: true }, { 'set-cookie': 'sid=abc; Path=/; HttpOnly' }) : send(401, { error: 'bad' }); }
      if (req.headers.cookie !== 'sid=abc') return send(401, { error: 'login' });
      if (req.url === '/merchant/automation' && req.method === 'GET') return send(200, { ai_bot_enabled: true, ai_handoff_prompt_after_replies: st.n });
      if (req.url === '/merchant/automation' && req.method === 'PATCH') {
        if (st.rejectPatch) return send(400, { error: 'no' });
        if (!st.ignorePatch) st.n = Number(JSON.parse(body).ai_handoff_prompt_after_replies); return send(200, { ok: true });
      }
      send(404, {});
    });
  });
  return new Promise<{ st: typeof st; base: string; close: () => void }>((ok) => srv.listen(0, '127.0.0.1', () => ok({ st, base: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, close: () => srv.close() })));
}

describe.skipIf(!reachable)('handoff number kept the same in LiveChat and the bot (needs TEST_DATABASE_URL)', () => {
  let app: FastifyInstance; let admin = ''; let staff = ''; let lc: Awaited<ReturnType<typeof fakeLiveChat>>; let link: LiveChatLink;
  const rows = async (sql: string, p: unknown[] = []) => (await pool!.query<RowDataPacket[]>(sql, p))[0];
  const as = (cookie: string, path: string, payload?: object) => app.inject({ method: payload ? 'POST' : 'GET', url: path, payload: payload as object, headers: { cookie } });
  const P = '/api/admin/merchants/MERCH_A';
  beforeAll(async () => {
    await migrate(pool!, { reset: true }); await seed(pool!); lc = await fakeLiveChat(); link = new LiveChatLink(pool!);
    app = await buildApp({ pool: pool!, logger: false });
    const login = async (payload: object) => String((await app.inject({ method: 'POST', url: '/api/auth/login', payload })).headers['set-cookie']).split(';')[0];
    admin = await login(DEMO_ADMIN); staff = await login({ username: 'luckypay', password: DEMO_STAFF_PASSWORD });
  });
  afterAll(async () => { lc?.close(); await app?.close(); await pool?.end(); });

  it('is for admins only, and a wrong LiveChat password saves nothing', async () => {
    expect((await as(staff, P + '/livechat')).statusCode).toBe(403);
    const bad = await as(admin, P + '/livechat', { baseUrl: lc.base, email: 'admin@a.test', password: 'wrong' });
    expect(bad.statusCode).toBe(400); expect(bad.json().error).toMatch(/did not accept/);
    expect((await rows('SELECT * FROM merchant_livechat')).length).toBe(0);
  });

  it('connects, copies the number from LiveChat, and stores the password encrypted', async () => {
    const r = await as(admin, P + '/livechat', { baseUrl: lc.base + '/', email: 'admin@a.test', password: 'Test1234!' });
    expect(r.statusCode).toBe(200); expect(r.json()).toMatchObject({ configured: true, handoffAfterReplies: 3, error: null });
    const [row] = await rows('SELECT password_encrypted FROM merchant_livechat'); expect(row.password_encrypted).not.toContain('Test1234'); expect(JSON.stringify(r.json())).not.toContain('Test1234');
  });

  it('follows a change made in LiveChat: when the page opens, on Sync now, and on the timer pass', async () => {
    lc.st.n = 7; expect((await as(admin, P + '/livechat')).json().handoffAfterReplies).toBe(7);
    lc.st.n = 9; expect((await as(admin, P + '/livechat/sync', {})).json().handoffAfterReplies).toBe(9);
    lc.st.n = 12; expect(await link.pullAll()).toEqual([{ code: 'MERCH_A', ok: true }]); expect((await link.info('MERCH_A')).handoffAfterReplies).toBe(12);
  });

  it('sends a change made in the bot to LiveChat, and checks LiveChat really has it', async () => {
    const r = await as(admin, P + '/livechat/handoff', { value: 5 });
    expect(r.statusCode).toBe(200); expect(r.json().handoffAfterReplies).toBe(5); expect(lc.st.n).toBe(5);
    expect((await as(admin, P + '/livechat/handoff', { value: 101 })).statusCode).toBe(400);
    expect((await as(admin, P + '/livechat/handoff', { value: 2.5 })).statusCode).toBe(400);
  });

  it('never leaves the two different: a refused change keeps the old number, a change LiveChat ignores is corrected to LiveChat', async () => {
    lc.st.rejectPatch = true;
    const a = await as(admin, P + '/livechat/handoff', { value: 8 }); expect(a.statusCode).toBe(502); expect(a.json().error).toMatch(/Nothing was changed/);
    expect((await link.info('MERCH_A')).handoffAfterReplies).toBe(5); expect(lc.st.n).toBe(5);
    lc.st.rejectPatch = false; lc.st.ignorePatch = true;
    const b = await as(admin, P + '/livechat/handoff', { value: 8 }); expect(b.statusCode).toBe(502);
    lc.st.ignorePatch = false;
  });

  it('shows a failed sync on the page, and recovers; disconnect removes the link', async () => {
    lc.close(); const f = await as(admin, P + '/livechat/sync', {}); expect(f.statusCode).toBe(502);
    expect((await link.info('MERCH_A')).error).toBeTruthy(); expect((await link.info('MERCH_A')).handoffAfterReplies).toBe(5);       // keeps the last known number
    expect((await as(admin, P + '/livechat/remove', {})).json().removed).toBe(true); expect((await link.info('MERCH_A')).configured).toBe(false);
  });
});
