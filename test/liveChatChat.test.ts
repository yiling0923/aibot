import 'dotenv/config';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed, DEMO_ADMIN, DEMO_STAFF_PASSWORD } from '../src/db/seed';
import { buildApp } from '../src/server/app';
import { chatThroughLiveChat, probeUploads, sniffType } from '../src/livechat/chat';

/** A small stand-in for LiveChat's website widget API: it starts chats, takes visitor messages and answers like the bot does after a moment. */
function fakeLiveChat(opts: { replyAfterMs?: number | null; fileField?: string; refuseType?: string } = {}) {
  const chats = new Map<string, { visitor: string; status: string; messages: { senderType: string; body: string }[] }>(); let n = 0;
  const calls: string[] = []; const posts: Record<string, unknown>[] = []; const uploads: { field: string; name: string; fields: string[] }[] = [];
  const srv = http.createServer((req, res) => {
    let raw = ''; req.on('data', (c) => (raw += c)); req.on('end', () => {
      const url = new URL(req.url!, 'http://x'); calls.push(req.method + ' ' + url.pathname);
      const send = (code: number, j: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };
      if (req.headers['x-tenant-id'] !== '1') return send(404, { error: 'widget_config_not_found' });
      const isForm = String(req.headers['content-type']).startsWith('multipart/form-data');
      const body = raw && !isForm ? JSON.parse(raw) : {}; if (req.method === 'POST' && !isForm) posts.push(body); const view = (id: string) => { const c = chats.get(id)!; return { publicId: id, status: c.status, aiHandoffStatus: 'none', messages: c.messages }; };
      const reply = (id: string, q: string) => { if (opts.replyAfterMs === null) return; setTimeout(() => chats.get(id)?.messages.push({ senderType: 'ai', body: 'Bot says: ' + q }), opts.replyAfterMs ?? 150); };
      if (req.method === 'POST' && isForm) {                                                                          // a form: only the upload address takes one, the message address answers like the real LiveChat
        const up = /^\/widget\/conversations\/([^/]+)\/attachments$/.exec(url.pathname);
        if (!up) return send(url.pathname.endsWith('/messages') || url.pathname === '/widget/conversations' ? 400 : 404, { error: 'invalid_json', message: 'Widget message request body is invalid.' });
        const part = /name="([^"]+)"; filename="([^"]+)"/.exec(raw); const fields = [...raw.matchAll(/name="([^"]+)"(?!; filename)/g)].map((x) => x[1]);
        if (!part || part[1] !== (opts.fileField ?? 'file')) return send(422, { error: 'the file field must be called ' + (opts.fileField ?? 'file') });
        if (!chats.has(up[1])) return send(404, {});
        if (opts.refuseType && new RegExp('Content-Type: ' + opts.refuseType, 'i').test(raw)) return send(422, { error: 'attachment_invalid', message: 'Unsupported attachment type.' });
        uploads.push({ field: part[1], name: part[2], fields });
        chats.get(up[1])!.messages.push({ senderType: 'visitor', body: part[2], messageType: 'image', attachment: { kind: 'image', name: part[2], url: '/uploads/x.png', mimeType: 'image/png', size: 4 } } as never);
        reply(up[1], part[2]); return send(200, { conversation: view(up[1]) });
      }
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
  return new Promise<{ base: string; calls: string[]; uploads: typeof uploads; posts: Record<string, unknown>[]; chats: typeof chats; close: () => void }>((ok) => srv.listen(0, '127.0.0.1', () => ok({ base: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, calls, uploads, posts, chats, close: () => srv.close() })));
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

  it('uploads a picture to LiveChat\'s upload address as a form (never to the message address), tries the next field name, and the bot answers', async () => {
    const lc = await fakeLiveChat({ fileField: 'attachment' }); const o = { baseUrl: lc.base, tenant: '1', visitor: 'vis-up', pollMs: 40, waitMs: 3000 };
    const r = await chatThroughLiveChat({ ...o, file: { name: 'slip.png', type: 'image/png', data: new Uint8Array([137, 80, 78, 71]) } });
    expect(lc.uploads).toHaveLength(1); expect(lc.uploads[0]).toMatchObject({ field: 'attachment', name: 'slip.png' });        // 'file' was refused with 422, 'attachment' was accepted
    expect(lc.uploads[0].fields).toEqual(expect.arrayContaining(['visitor_session_id', 'conversation_id']));
    expect(r.replied).toBe(true); expect(r.messages.find((m) => m.attachment)).toMatchObject({ from: 'customer', text: 'slip.png', attachment: { name: 'slip.png', url: lc.base + '/uploads/x.png' } });
    lc.close();
  });
  it('says what LiveChat answered when no field name works, and does not retry on other errors', async () => {
    const lc = await fakeLiveChat({ fileField: 'nothing-we-try' }); const o = { baseUrl: lc.base, tenant: '1', visitor: 'vis-up2', pollMs: 40, waitMs: 500 };
    await expect(chatThroughLiveChat({ ...o, file: { name: 'a.png', type: 'image/png', data: new Uint8Array([1]) } })).rejects.toThrow(/addresses and form fields tried were: POST \/widget\/conversations\/conv-\d+\/attachments \(field "file"\) -> 422.*\(field "image"\) -> 422.*\/widget\/uploads \(field "file"\) -> 404/s);
    const wrongTenant = await chatThroughLiveChat({ ...o, tenant: '9', file: { name: 'a.png', type: 'image/png', data: new Uint8Array([1]) } }).catch((e: Error) => e.message);
    expect(String(wrongTenant)).toMatch(/404/);                                                                                  // an unknown tenant stops at once
    lc.close();
  });
  it('stops at once when LiveChat looks at the file and refuses its type, and says which file it was', async () => {
    const lc = await fakeLiveChat({ refuseType: 'image/png' }); const o = { baseUrl: lc.base, tenant: '1', visitor: 'vis-type', pollMs: 40, waitMs: 500 };
    const err = await chatThroughLiveChat({ ...o, file: { name: 'slip.png', type: 'image/png', data: new Uint8Array([1, 2, 3]) } }).catch((e: Error) => e.message);
    expect(String(err)).toMatch(/LiveChat refused this file: "Unsupported attachment type\.".*slip\.png \(image\/png, 3 bytes\).*takes only JPEG and PNG pictures/s);
    expect(lc.uploads).toHaveLength(0);                                                                                           // nothing was stored, and no other field names were tried
    const ok = await chatThroughLiveChat({ ...o, visitor: 'vis-type2', file: { name: 'slip.jpg', type: 'image/jpeg', data: new Uint8Array([1, 2, 3]) } });
    expect(ok.messages.some((m) => m.attachment?.name === 'slip.jpg')).toBe(true);                                                // another type goes through
    lc.close();
  });
  it('knows what a file really is from its first bytes', () => {
    expect(sniffType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toEqual({ type: 'image/jpeg', ext: 'jpg' });
    expect(sniffType(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toEqual({ type: 'image/png', ext: 'png' });
    expect(sniffType(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toEqual({ type: 'image/webp', ext: 'webp' });
    expect(sniffType(new Uint8Array([0x25, 0x50, 0x44, 0x46]))?.type).toBe('application/pdf'); expect(sniffType(new Uint8Array([1, 2, 3]))).toBeNull();
  });
  it('sends a picture named .jpg that is really WebP as a WebP, and says so when LiveChat refuses it', async () => {
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 9, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1, 2]);
    const lc = await fakeLiveChat({ refuseType: 'image/webp' }); const o = { baseUrl: lc.base, tenant: '1', visitor: 'vis-real', pollMs: 40, waitMs: 500 };
    const err = await chatThroughLiveChat({ ...o, file: { name: 'MMU (3).jpg', type: 'image/jpeg', data: webp } }).catch((e: Error) => e.message);
    expect(String(err)).toMatch(/MMU \(3\)\.webp \(image\/webp, really WEBP inside although it was named MMU \(3\)\.jpg/);
    lc.close();
  });
  it('asks LiveChat which kinds of file it takes, one sample of each', async () => {
    const lc = await fakeLiveChat({ refuseType: 'image/webp' });
    const rows = await probeUploads({ baseUrl: lc.base, tenant: '1' });
    expect(rows.map((r) => [r.label, r.ok])).toEqual([['JPG picture', true], ['PNG picture', true], ['GIF picture', true], ['WebP picture', false], ['PDF document', true], ['Text file', true]]);
    expect(rows.find((r) => r.label === 'WebP picture')?.answer).toBe('Unsupported attachment type.');
    lc.close();
  });
  it('reads a picture an agent sent: the link is completed with the LiveChat address, and only safe links are kept', async () => {
    const lc = await fakeLiveChat(); const o = { baseUrl: lc.base, tenant: '1', visitor: 'vis-pic', pollMs: 40, waitMs: 3000 };
    await chatThroughLiveChat({ ...o, text: 'hi' });
    const chat = [...lc.chats.values()][0];
    chat.messages.push({ senderType: 'operator', body: 'MMU.JPG', messageType: 'image', attachment: { kind: 'image', name: 'MMU.JPG', url: '/uploads/abc.jpg', mimeType: 'image/jpeg', size: 92571 } } as never);
    chat.messages.push({ senderType: 'operator', body: 'evil', messageType: 'image', attachment: { kind: 'image', name: 'x', url: 'javascript:alert(1)', mimeType: 'image/png', size: 1 } } as never);
    const r = await chatThroughLiveChat({ ...o });
    expect(r.messages.find((m) => m.text === 'MMU.JPG')?.attachment).toEqual({ kind: 'image', name: 'MMU.JPG', url: lc.base + '/uploads/abc.jpg', mimeType: 'image/jpeg', size: 92571 });
    expect(r.messages.find((m) => m.text === 'evil')).not.toHaveProperty('attachment');
    lc.close();
  });
  it('sends the member the website would send, or nothing at all for a customer who is not logged in', async () => {
    const lc = await fakeLiveChat(); const o = { baseUrl: lc.base, tenant: '1', pollMs: 40, waitMs: 3000 };
    await chatThroughLiveChat({ ...o, visitor: 'vis-g1', text: 'check my balance', member: null });
    await chatThroughLiveChat({ ...o, visitor: 'vis-m1', text: 'check my balance', member: { id: 'tom8841', name: 'Tom', rank: 'VIP' } });
    await chatThroughLiveChat({ ...o, visitor: 'vis-d1', text: 'hello' });
    const [guest, member, dflt] = lc.posts;
    expect(guest).not.toHaveProperty('member_external_id'); expect(guest).toMatchObject({ visitor_name: 'Guest' });
    expect(member).toMatchObject({ member_external_id: 'tom8841', member_name: 'Tom', member_rank: 'VIP' });
    expect(dflt).toMatchObject({ member_external_id: 'm-100', member_rank: 'GOLD' });          // not told: the sample member, as before
    lc.close();
  });
  it('says so when LiveChat is not reachable, when the tenant is wrong, and when the bot does not answer in time', async () => {
    await expect(chatThroughLiveChat({ baseUrl: 'http://127.0.0.1:1', tenant: '1', visitor: 'vis-test-2', text: 'hi', waitMs: 200 })).rejects.toThrow(/Could not reach LiveChat/);
    const lc = await fakeLiveChat({ replyAfterMs: null });
    await expect(chatThroughLiveChat({ baseUrl: lc.base, tenant: '9', visitor: 'vis-test-3', text: 'hi' })).rejects.toThrow(/LiveChat answered 404.*widget_config_not_found.*no active merchant with Tenant id 9 in LiveChat.*tenant_id=/s);
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

  it('takes a picture as text (base64), refuses a wrong kind or a too big file, and passes a good one to LiveChat', async () => {
    const lc = await fakeLiveChat(); const png = Buffer.from([137, 80, 78, 71, 1, 2, 3]).toString('base64');
    const f = (file: object) => post(admin, { baseUrl: lc.base, visitor: 'vis-route-up', text: '', file });
    expect((await f({ name: 'run.exe', type: 'application/x-msdownload', data: png })).statusCode).toBe(400);
    expect((await f({ name: 'a.png', type: 'image/png', data: '' })).statusCode).toBe(400);
    expect((await f({ name: 'big.png', type: 'image/png', data: Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64') })).statusCode).toBe(400);
    expect((await post(staff, { baseUrl: lc.base, visitor: 'vis-route-up', file: { name: 'a.png', type: 'image/png', data: png } })).statusCode).toBe(403);
    const ok = await f({ name: '../../evil slip.png', type: 'image/png', data: png });
    expect(ok.statusCode).toBe(200); expect(lc.uploads[0].fields).toEqual(expect.arrayContaining(['kind', 'visitor_session_id'])); expect(lc.uploads[0].name).toBe('.._.._evil slip.png');                              // a path in the name is made harmless
    expect(ok.json().messages.find((m: { attachment?: unknown }) => m.attachment).attachment).toMatchObject({ name: '.._.._evil slip.png', mimeType: 'image/png' });
    lc.close();
  });

  it('the file check is for admins only, checks the address, and reports what LiveChat said', async () => {
    const lc = await fakeLiveChat({ refuseType: 'application/pdf' });
    const probe = (cookie: string, payload: object) => app.inject({ method: 'POST', url: '/api/admin/livechat-chat/probe', payload, headers: { cookie } });
    expect((await probe(staff, { baseUrl: lc.base })).statusCode).toBe(403);
    expect((await probe(admin, { baseUrl: 'ftp://x' })).statusCode).toBe(400);
    const ok = await probe(admin, { baseUrl: lc.base });
    expect(ok.statusCode).toBe(200); expect(ok.json().rows.find((r: { label: string }) => r.label === 'PDF document')).toMatchObject({ ok: false, answer: 'Unsupported attachment type.' });
    lc.close();
  });
});
