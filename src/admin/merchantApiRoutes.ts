import type { FastifyInstance } from 'fastify';
import '../auth/types';
import { Tenants } from '../db/tenants';
import type { MerchantApiStore } from '../bot/merchantApiHttp';

/** The merchant page, "Account data" card (admin only): the address and key of the merchant's own API, and a test with one customer id. */
export function merchantApiRoutes(app: FastifyInstance, ctx: { pool: import('../db/pool').Pool; api: MerchantApiStore; reloadBot?: () => Promise<unknown> }) {
  const A = '/api/admin/merchants/:code/api';
  const gate = async (req: { user?: { role: string }; params: { code: string } }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (req.user?.role !== 'admin') { reply.code(403).send({ error: 'Only an admin can do this.' }); return null; }
    const t = await new Tenants(ctx.pool).get(req.params.code); if (!t) { reply.code(404).send({ error: 'There is no such merchant.' }); return null; }
    return t;
  };
  const okUrl = (u: string) => u.length <= 300 && /^https?:\/\/[^\s/]+(:\d+)?(\/[^\s?#]*)?$/.test(u);
  const summary = (a?: { name: string; balance?: string; points?: number; level?: string; deposits?: unknown[]; withdrawals?: unknown[]; transactions?: unknown[] }) =>
    a ? { name: a.name, balance: a.balance ?? null, points: a.points ?? null, level: a.level ?? null, deposits: a.deposits?.length ?? 0, withdrawals: a.withdrawals?.length ?? 0, transactions: a.transactions?.length ?? 0 } : null;

  app.get<{ Params: { code: string } }>(A, async (req, reply) => { if (!(await gate(req, reply))) return; return ctx.api.info(req.params.code); });

  /** Try an address and key (a saved key is used when none is typed). Nothing is saved. */
  app.post<{ Params: { code: string }; Body: { baseUrl?: string; apiKey?: string; customerId?: string } }>(`${A}/test`, async (req, reply) => {
    if (!(await gate(req, reply))) return;
    const b = req.body ?? {}; const id = String(b.customerId ?? '').trim();
    if (!id || id.length > 80) return reply.code(400).send({ error: 'Type the id of a customer to look up.' });
    const saved = await ctx.api.target(req.params.code);
    const baseUrl = String(b.baseUrl ?? '').trim().replace(/\/+$/, '') || saved?.baseUrl || ''; const apiKey = String(b.apiKey ?? '').trim() || saved?.apiKey || '';
    if (!okUrl(baseUrl)) return reply.code(400).send({ error: 'Enter the address of the merchant API, like https://api.merchant.com/bot.' });
    if (!apiKey) return reply.code(400).send({ error: 'Enter the API key.' });
    const r = await ctx.api.test(baseUrl, apiKey, id, saved?.currency);
    return { status: r.status, error: r.error ?? null, httpStatus: r.httpStatus ?? null, account: summary(r.account) };
  });

  app.post<{ Params: { code: string }; Body: { baseUrl?: string; apiKey?: string; testCustomerId?: string } }>(A, async (req, reply) => {
    if (!(await gate(req, reply))) return;
    const b = req.body ?? {}; const baseUrl = String(b.baseUrl ?? '').trim().replace(/\/+$/, ''); const apiKey = String(b.apiKey ?? '').trim();
    if (!okUrl(baseUrl)) return reply.code(400).send({ error: 'Enter the address of the merchant API, like https://api.merchant.com/bot.' });
    if (apiKey.length < 8 || apiKey.length > 500 || /\s/.test(apiKey)) return reply.code(400).send({ error: 'Enter the API key (no spaces).' });
    try { const r = await ctx.api.connect(req.params.code, baseUrl, apiKey, req.user!.username, String(b.testCustomerId ?? '')); await ctx.reloadBot?.(); return { ...r.info, test: r.test ? { status: r.test.status, account: summary(r.test.account) } : null }; }
    catch (e) { return reply.code(400).send({ error: (e as Error).message }); }
  });

  app.post<{ Params: { code: string } }>(`${A}/remove`, async (req, reply) => {
    if (!(await gate(req, reply))) return;
    await ctx.api.disconnect(req.params.code); await ctx.reloadBot?.(); return { removed: true };
  });
}
