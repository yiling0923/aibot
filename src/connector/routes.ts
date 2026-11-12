import type { FastifyInstance } from 'fastify';
import type { Pool } from '../db/pool';
import type { Bot } from '../bot/responder';
import type { Store } from '../bot/store';
import '../auth/types';
import { ask, AskError } from './ask';
import { issueKey, listKeys, resolveKey, revokeKeys } from './keys';

export interface ConnectorCtx { pool: Pool; getBot: () => Promise<Bot>; store: Store; timeoutMs?: number }

/** The LiveChat connector (key-protected, no login cookie) and the admin calls that make, list and stop a merchant's bot key. */
export function connectorRoutes(app: FastifyInstance, ctx: ConnectorCtx) {
  const { pool } = ctx;

  app.post<{ Body: Record<string, unknown> }>('/api/v1/ai/ask', async (req, reply) => {
    const merchant = await resolveKey(pool, req.headers.authorization);
    if (!merchant) return reply.code(401).send({ error: 'The bot API key is missing, wrong or stopped.' });
    try { return await ask({ pool, bot: await ctx.getBot(), store: ctx.store, timeoutMs: ctx.timeoutMs }, merchant, req.body ?? {}); }
    catch (e) { if (e instanceof AskError) return reply.code(e.status).send({ error: e.message }); throw e; }
  });

  const adminOnly = (req: { user?: { role: string } }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) =>
    (req.user?.role === 'admin' ? true : (reply.code(403).send({ error: 'Only an admin can do this.' }), false));

  app.get<{ Params: { code: string } }>('/api/admin/merchants/:code/bot-keys', async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    return listKeys(pool, req.params.code);
  });

  /** Makes a new key and shows it once. By default the old keys stop working at the same moment ("replace the key"). */
  app.post<{ Params: { code: string }; Body: { replace?: boolean; label?: string } }>('/api/admin/merchants/:code/bot-key', async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    try { return await issueKey(pool, req.params.code, { createdBy: req.user!.username, label: req.body?.label?.slice(0, 100), replace: req.body?.replace !== false }); }
    catch (e) { return reply.code(404).send({ error: (e as Error).message }); }
  });

  app.post<{ Params: { code: string } }>('/api/admin/merchants/:code/bot-key/revoke', async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    return { revoked: await revokeKeys(pool, req.params.code) };
  });
}
