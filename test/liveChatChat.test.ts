import 'dotenv/config';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed, DEMO_ADMIN, DEMO_STAFF_PASSWORD } from '../src/db/seed';
import { buildApp } from '../src/server/app';
import { chatThroughLiveChat } from '../src/livechat/chat';

/** A small stand-in for LiveChat's website widget API: it starts chats, takes visitor messages and answers like the bot does after a moment. */
function fakeLiveChat(opts: { replyAfterMs?: number | null } = {}) {
  const chats = new Map<string, { visitor: string; status: string; messages: { senderType: string; body: string }[] }>(); let n = 0;
  const calls: string[] = [];
  const srv = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', () => {
      const url = new URL(req.url!, 'http://x'); calls.push(req.method + ' ' + url.pathname);
      const send = (code: number, j: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (req.headers['x-tenant-id'] !== '1') return send(404, { error: 'unknown tenant' });
      const body = raw ? JSON.parse(raw) : {}; const view = (id: string) => { const c = chats.get(id)!; return { publicId: id, status: c.status, aiHandoffStatus: 'none', messages: c.messages }; };
      const reply = (id: string, q: string) => { if (opts.replyAfterMs === null) return; setTimeout(() => chats.get(id)?.messages.push({ senderType: 'ai', body: 'Bot says: ' + q }), opts.replyAfterMs ?? 150); };
      if (url.pathname === '/widget/conversations/current') { const v = url.searchParams.get('visitor_session_id'); const id = [...chats].find(([, c]) => c.visitor === v)?.[0]; return id ? send(200, { conversation: view(id) }) : send(404, { error: 'none' }); }
      if (url.pathname === '/widget/conversations' && req.method === 'POST') { const id = 'conv-' + ++n; chats.set(id, { visitor: body.visitor_session_id, status: 'open', messages: [{ senderType: 'visitor', body: body.body }] }); reply(id, body.body); return send(200, { conversation: view(id) }); }
      const m = /^\/widget\/conversations\/([^/]+)(\/messages)?$/.exec(url.pathname);
      if (m && chats.has(m[1])) {
        if (m[2] && req.method === 'POST') { chats.get(m[1])!.messages.push({ senderType: 'visitor', body: body.body }); reply(m[1], body.body); return send(200, { ok: true }); }
        return send(200, { conversation: view(m[1]) });
      }
      send(404, {});
    });
  });
  return new Promise<{ base: string; calls: string[]; chats: typeof chats; close: () => void }>((ok) => srv.listen(0, '127.0.0.1', () => ok({ base: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, calls, chats, close: () => srv.close() })));
}

describe('chatting through a LiveChat', () => {
  it('starts a chat, waits for the bot and returns the whole chat; the next message continues the same chat', async () => {
    const lc = await fakeLiveChat(); const o = { baseUrl: lc.base + '/', tenant: '1', visitor: 'vis-test-1', pollMs: 40, waitMs: 3000 };
    const a = await chatThroughLiveChat({ ...o, text: 'how to deposit' });
    expect(a.replied).toBe(true); expect(a.conversationId).toBe('conv-1'); expect(a.status).toBe('open');
    expect(a.messages).toEqual([{ from: 'customer', sender: 'visitor', text: 'how to deposit' }, { from: 'bot', sender: 'ai', text: 'Bot says: how to deposit' }]);
    const b = await chatThroughLiveChat({ ...o, text: 'and withdraw' });
    expect(b.conversationId).toBe('conv-1'); expect(b.messages).toHaveLength(4); expect(b.messages.at(-1)).toMatchObject({ from: 'bot', text: 'Bot says: and withdraw' });
    expect(lc.calls.filter((c) => c === 'POST /widget/conversations')).toHaveLength(1);             // only one chat was started
    const c = await chatThroughLiveChat({ ...o });                                                  // no text: just read the chat as it is
    expect(c.messages).toHaveLength(4); expect(c.replied).toBe(false);
    expect((await chatThroughLiveChat({ ...o, visitor: 'vis-other-9' })).messages).toEqual([]);    // another visitor has no chat yet
    lc.close();
  });

  it('says so when LiveChat is not reachable, when the tenant is wrong, and when the bot does not answer in time', async () => {
    await expect(chatThroughLiveChat({ baseUrl: 'http://127.0.0.1:1', tenant: '1', visitor: 'vis-test-2', text: 'hi', waitMs: 200 })).rejects.toThrow(/Could not reach LiveChat/);
    const lc = await fakeLiveChat({ replyAfterMs: null });
    await expect(chatThroughLiveChat({ baseUrl: lc.base, tenant: '9', visitor: 'vis-test-3', text: 'hi' })).rejects.toThrow(/LiveChat answered 404/);
    const t = await chatThroughLiveChat({ baseUrl: lc.base, tenant: '1', visitor: 'vis-test-4', text: 'hi', waitMs: 300, pollMs: 50 });
    expect(t.replied).toBe(false); expect(t.messages).toEqual([{ from: 'customer', sender: 'visitor', text: 'hi' }]);   // the customer's message is there, no reply yet
    lc.close();
  });
});

const url = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null; let reachable = false;
if (url) { pool = createPool(url, 6); try { await pool.query('select 1'); reachable = true; } catch { /* skipped below */ } }

describe.skipIf(!reachable)('the LiveChat test route (needs TEST_DATABASE_URL)', () => {
  let app: FastifyInstance; let admin = ''; let staff = '';
  const post = (cookie: string, payload: object) => app.inject({ method: 'POST', url: '/api/admin/livechat-chat', payload, headers: { cookie } });
  beforeAll(async () => {
    await migrate(pool!, { reset: true }); await seed(pool!); app = await buildApp({ pool: pool!, logger: false });
    const login = async (p: object) => String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: p })).headers['set-cookie']).split(';')[0];
    admin = await login(DEMO_ADMIN); staff = await login({ username: 'luckypay', password: DEMO_STAFF_PASSWORD });
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it('is for admins only, checks what it is given, and chats through the LiveChat it is pointed at', async () => {
    const lc = await fakeLiveChat();
    expect((await post(staff, { baseUrl: lc.base, visitor: 'vis-route-1', text: 'hi' })).statusCode).toBe(403);
    expect((await post(admin, { baseUrl: 'file:///etc/passwd', visitor: 'vis-route-1', text: 'hi' })).statusCode).toBe(400);
    expect((await post(admin, { baseUrl: lc.base, visitor: 'x', text: 'hi' })).statusCode).toBe(400);
    expect((await post(admin, { baseUrl: lc.base, tenant: 'a b', visitor: 'vis-route-1', text: 'hi' })).statusCode).toBe(400);
    const ok = await post(admin, { baseUrl: lc.base, visitor: 'vis-route-1', text: 'how to deposit' });
    expect(ok.statusCode).toBe(200); expect(ok.json().replied).toBe(true); expect(ok.json().messages.map((m: { from: string }) => m.from)).toEqual(['customer', 'bot']);
    const down = await post(admin, { baseUrl: 'http://127.0.0.1:1', visitor: 'vis-route-1', text: 'hi' });
    expect(down.statusCode).toBe(502); expect(down.json().error).toMatch(/Could not reach LiveChat/);
    lc.close();
  });
});
