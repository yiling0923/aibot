import type { FastifyInstance } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import type { Pool } from '../db/pool';
import type { Bot } from '../bot/responder';
import type { Store } from '../bot/store';
import '../auth/types';
import { Tenants, tbl } from '../db/tenants';
import { ask } from '../connector/ask';
import { listKeys } from '../connector/keys';
import { MerchantAiKeys, PROVIDERS, type Provider } from '../ai/merchantKeys';

export interface MerchantPageCtx {
  pool: Pool; getBot: () => Promise<Bot>; store: Store; aiKeys: MerchantAiKeys; timeoutMs?: number;
  /** Is a shared key set in .env? Shown as "using the shared key". */
  shared: Record<Provider, boolean>;
  /** The address LiveChat should use (from PUBLIC_URL); empty: the address of the open page. */
  publicUrl: string;
}

const q = async <T extends RowDataPacket = RowDataPacket>(pool: Pool, sql: string, p: unknown[] = []) => (await pool.query<T[]>(sql, p))[0];

/** The merchant page (admin only): what LiveChat needs to reach this merchant's bot, the merchant's own AI keys, and a button that tests the link. */
export function merchantPageRoutes(app: FastifyInstance, ctx: MerchantPageCtx) {
  const { pool } = ctx;
  const A = '/api/admin/merchants/:code';
  const adminOnly = (req: { user?: { role: string } }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) =>
    (req.user?.role === 'admin' ? true : (reply.code(403).send({ error: 'Only an admin can do this.' }), false));
  const known = async (code: string) => (await new Tenants(pool).get(code)) ?? null;

  app.get<{ Params: { code: string } }>(`${A}/connection`, async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const t = await known(req.params.code); if (!t) return reply.code(404).send({ error: 'There is no such merchant.' });
    const [m] = await q(pool, 'SELECT code, name, default_language FROM merchants WHERE code = ?', [t.code]);
    const [st] = await q(pool, `SELECT tone FROM ${tbl(t.db, 'settings')} WHERE id = 1`);
    const [n] = await q(pool, `SELECT COUNT(*) AS n FROM ${tbl(t.db, 'kb_entries')}`);
    const [live] = await q(pool, `SELECT COUNT(*) AS n, MAX(started_at) AS last FROM ${tbl(t.db, 'chat_sessions')} WHERE source = 'live' AND started_at > DATE_SUB(NOW(), INTERVAL 7 DAY)`);
    const logins = (await q(pool, 'SELECT u.username FROM admin_users u JOIN merchants m ON m.id = u.merchant_id WHERE m.code = ? ORDER BY u.username', [t.code])).map((r) => r.username as string);
    const proto = String(req.headers['x-forwarded-proto'] ?? req.protocol), host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'localhost');
    const baseUrl = ctx.publicUrl || `${proto}://${host}`;
    const keys = await listKeys(pool, t.code), aiKeys = await ctx.aiKeys.list(t.code);
    return {
      merchant: { code: m.code, name: m.name, language: m.default_language, tone: st?.tone ?? 'friendly', entries: Number(n?.n ?? 0), logins },
      livechat: {
        baseUrl, askUrl: baseUrl + '/api/v1/ai/ask',
        keys: keys.filter((k) => !k.revokedAt), stoppedKeys: keys.filter((k) => k.revokedAt).length,
        liveChats7d: Number(live?.n ?? 0), lastLiveChat: live?.last ?? null,
      },
      ai: Object.fromEntries(aiKeys.map((k) => [k.provider, { ...k, using: k.configured ? 'merchant' : ctx.shared[k.provider] ? 'shared' : 'none' }])),
    };
  });

  /** Saves (or replaces) the merchant's own Claude or ChatGPT key. It is stored encrypted and never shown again. */
  app.post<{ Params: { code: string }; Body: { provider?: string; key?: string } }>(`${A}/ai-key`, async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const provider = req.body?.provider as Provider, key = String(req.body?.key ?? '').trim();
    if (!PROVIDERS.includes(provider)) return reply.code(400).send({ error: 'Choose Claude (anthropic) or ChatGPT (openai).' });
    if (key.length < 12 || key.length > 400 || /\s/.test(key)) return reply.code(400).send({ error: 'That does not look like an API key. Paste the whole key, with no spaces.' });
    try { await ctx.aiKeys.set(req.params.code, provider, key, req.user!.username); } catch (e) { return reply.code(404).send({ error: (e as Error).message }); }
    return { provider, saved: true, last4: key.slice(-4) };
  });

  app.post<{ Params: { code: string }; Body: { provider?: string } }>(`${A}/ai-key/remove`, async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const provider = req.body?.provider as Provider;
    if (!PROVIDERS.includes(provider)) return reply.code(400).send({ error: 'Choose Claude (anthropic) or ChatGPT (openai).' });
    return { provider, removed: await ctx.aiKeys.clear(req.params.code, provider) };
  });

  /** Asks the bot a question exactly as LiveChat does (same code, this merchant's knowledge). Saved as a test chat, not as live traffic. */
  app.post<{ Params: { code: string }; Body: { question?: string } }>(`${A}/test-link`, async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const t = await known(req.params.code); if (!t) return reply.code(404).send({ error: 'There is no such merchant.' });
    const keys = await listKeys(pool, t.code);
    const started = Date.now();
    const r = await ask({ pool, bot: await ctx.getBot(), store: ctx.store, timeoutMs: ctx.timeoutMs, source: 'test' }, t.code,
      { question: String(req.body?.question ?? 'Can you help?').slice(0, 300), session_id: 'link-test-' + Date.now().toString(36) });
    return { ok: true, ms: Date.now() - started, hasKey: keys.some((k) => !k.revokedAt), answer: r.answer, decision: r.decision, choices: r.choices };
  });
}
