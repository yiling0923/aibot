import type { FastifyInstance } from 'fastify';
import '../auth/types';
import { chatThroughLiveChat, probeUploads } from '../livechat/chat';

/** The LiveChat test page: a chat in the panel whose messages go through a LiveChat (an admin tool). */
const MAX_FILE = 10 * 1024 * 1024;
const ALLOWED = /^(image\/(jpeg|png)|video\/(mp4|quicktime)|application\/pdf)$/;       // what LiveChat takes from a customer: JPEG, PNG, MP4, MOV and PDF
export function livechatChatRoutes(app: FastifyInstance, ctx: { fetch?: typeof fetch; waitMs?: number; pollMs?: number } = {}) {
  app.post<{ Body: { baseUrl?: string; tenant?: string; visitor?: string; text?: string; file?: { name?: unknown; type?: unknown; data?: unknown }; member?: { id?: unknown; name?: unknown; rank?: unknown } | null } }>('/api/admin/livechat-chat', { bodyLimit: 15 * 1024 * 1024 }, async (req, reply) => {
    if (req.user?.role !== 'admin') return reply.code(403).send({ error: 'Only an admin can use the LiveChat test.' });
    const b = req.body ?? {}; const bad = (error: string) => reply.code(400).send({ error });
    const baseUrl = String(b.baseUrl ?? '').trim(), tenant = String(b.tenant ?? '1').trim() || '1', visitor = String(b.visitor ?? '').trim(), text = String(b.text ?? '');
    if (!/^https?:\/\/[^\s/]+(:\d+)?(\/[^\s]*)?$/.test(baseUrl) || baseUrl.length > 200) return bad('Enter the LiveChat address, like http://localhost:8080.');
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(tenant)) return bad('The tenant id may use letters, digits, - and _.');
    if (!/^[A-Za-z0-9._-]{4,60}$/.test(visitor)) return bad('The visitor id is missing.');
    if (text.length > 2000) return bad('The message is too long.');
    let member: { id: string; name: string; rank?: string } | null | undefined;                       // missing: a sample member; null: not logged in
    if (b.member === null) member = null;
    else if (b.member && typeof b.member === 'object') {
      const id = String(b.member.id ?? '').trim(), name = String(b.member.name ?? '').trim().slice(0, 60), rank = String(b.member.rank ?? '').trim().slice(0, 30);
      if (!/^[A-Za-z0-9._-]{1,60}$/.test(id)) return bad('The member id may use letters, digits, . - and _ (up to 60).');
      member = { id, name: name || id, ...(rank ? { rank } : {}) };
    }
    let file: { name: string; type: string; data: Uint8Array } | undefined;
    if (b.file && typeof b.file === 'object') {
      const name = String(b.file.name ?? '').replace(/[\\/]/g, '_').replace(/[^\w.\- ()\u00C0-\uFFFF]/g, '_').trim().slice(0, 120), type = String(b.file.type ?? '').toLowerCase().slice(0, 80);
      if (!name) return bad('The file has no name.');
      if (!ALLOWED.test(type)) return bad('This kind of file is not allowed here. Use a picture, a PDF, a text file or an Office document.');
      const data = Buffer.from(String(b.file.data ?? ''), 'base64');
      if (!data.length) return bad('The file is empty.'); if (data.length > MAX_FILE) return bad('The file is too big (the most is 10 MB).');
      file = { name, type, data };
    }
    try { return await chatThroughLiveChat({ baseUrl, tenant, visitor, text, member, file, waitMs: ctx.waitMs, pollMs: ctx.pollMs }, ctx.fetch); }
    catch (e) { return reply.code(502).send({ error: (e as Error).message }); }
  });

  /** Asks LiveChat which kinds of file it takes, with one tiny sample of each (admin only). */
  app.post<{ Body: { baseUrl?: string; tenant?: string } }>('/api/admin/livechat-chat/probe', async (req, reply) => {
    if (req.user?.role !== 'admin') return reply.code(403).send({ error: 'Only an admin can use the LiveChat test.' });
    const baseUrl = String(req.body?.baseUrl ?? '').trim(), tenant = String(req.body?.tenant ?? '1').trim() || '1';
    if (!/^https?:\/\/[^\s/]+(:\d+)?(\/[^\s]*)?$/.test(baseUrl) || baseUrl.length > 200) return reply.code(400).send({ error: 'Enter the LiveChat address, like http://localhost:8080.' });
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(tenant)) return reply.code(400).send({ error: 'The tenant id may use letters, digits, - and _.' });
    try { return { rows: await probeUploads({ baseUrl, tenant }, ctx.fetch) }; } catch (e) { return reply.code(502).send({ error: (e as Error).message }); }
  });
}
