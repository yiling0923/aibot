import type { FastifyInstance } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import type { Pool } from '../db/pool';
import '../auth/types';
import { Tenants, tbl } from '../db/tenants';

const q = async <T extends RowDataPacket = RowDataPacket>(pool: Pool, sql: string, p: unknown[] = []) => (await pool.query<T[]>(sql, p))[0];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const round = (n: number, dp = 6) => Math.round(n * 10 ** dp) / 10 ** dp;

export interface BillingRow {
  code: string; name: string; chats: number; calls: number; inputTokens: number; outputTokens: number; totalTokens: number;
  /** What the AI provider charged for the calls on the shared key (USD). */
  cost: number;
  /** cost plus the markup: what to charge the merchant (USD). Calls on the merchant's own key are not included, the merchant pays the provider for those. */
  charge: number;
  ownKeyCalls: number; ownKeyTokens: number; unpricedCalls: number;
}
export interface BillingReport {
  from: string; to: string; markupPct: number;
  merchants: BillingRow[]; totals: Omit<BillingRow, 'code' | 'name'>;
  byKind: { kind: string; calls: number; totalTokens: number; cost: number }[];
  unpricedModels: { provider: string; model: string; calls: number; tokens: number }[];
  prices: { provider: string; model: string; inputPerMTok: number; outputPerMTok: number; updatedBy: string | null; updatedAt: string }[];
}

/** The period from the request, default: this month so far. `to` is the last day, included. */
function period(query: { from?: string; to?: string }): { from: string; to: string } | null {
  const now = new Date();
  const from = query.from ?? iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))), to = query.to ?? iso(now);
  if (!DAY.test(from) || !DAY.test(to) || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to)) || from > to) return null;
  return { from, to };
}

export async function billingReport(pool: Pool, from: string, to: string): Promise<BillingReport> {
  const [bs] = await q(pool, 'SELECT markup_pct FROM billing_settings WHERE id = 1');
  const markupPct = Number(bs?.markup_pct ?? 0);
  // a call with no stored cost (its model had no price then) is priced with today's price
  const cost = 'COALESCE(u.cost_usd, (u.input_tokens * p.input_per_mtok + u.output_tokens * p.output_per_mtok) / 1000000)';
  const join = 'LEFT JOIN ai_prices p ON p.provider = u.provider AND p.model = u.model';
  const range = 'u.created_at >= ? AND u.created_at < DATE_ADD(?, INTERVAL 1 DAY)';
  const used = await q(pool, `SELECT mer.code, COUNT(*) AS calls, SUM(u.input_tokens) AS inp, SUM(u.output_tokens) AS outp,
      SUM(CASE WHEN u.key_source = 'shared' THEN COALESCE(${cost}, 0) ELSE 0 END) AS shared_cost, SUM(CASE WHEN u.key_source = 'own' THEN 1 ELSE 0 END) AS own_calls,
      SUM(CASE WHEN u.key_source = 'own' THEN u.input_tokens + u.output_tokens ELSE 0 END) AS own_tokens, SUM(CASE WHEN ${cost} IS NULL THEN 1 ELSE 0 END) AS unpriced
    FROM ai_usage u JOIN merchants mer ON mer.id = u.merchant_id ${join} WHERE ${range} GROUP BY mer.code`, [from, to]);
  const byCode = new Map(used.map((r) => [r.code as string, r]));
  const rows: BillingRow[] = [];
  for (const t of await new Tenants(pool).list()) {
    const r = byCode.get(t.code);
    const [c] = await q(pool, `SELECT COUNT(*) AS n FROM ${tbl(t.db, 'chat_sessions')} WHERE source = 'live' AND started_at >= ? AND started_at < DATE_ADD(?, INTERVAL 1 DAY)`, [from, to]);
    const sharedCost = Number(r?.shared_cost ?? 0), inp = Number(r?.inp ?? 0), outp = Number(r?.outp ?? 0);
    rows.push({ code: t.code, name: t.name, chats: Number(c?.n ?? 0), calls: Number(r?.calls ?? 0), inputTokens: inp, outputTokens: outp, totalTokens: inp + outp,
      cost: round(sharedCost), charge: round(sharedCost * (1 + markupPct / 100)), ownKeyCalls: Number(r?.own_calls ?? 0), ownKeyTokens: Number(r?.own_tokens ?? 0), unpricedCalls: Number(r?.unpriced ?? 0) });
  }
  const sum = (f: (r: BillingRow) => number) => rows.reduce((a, r) => a + f(r), 0);
  const totals = { chats: sum((r) => r.chats), calls: sum((r) => r.calls), inputTokens: sum((r) => r.inputTokens), outputTokens: sum((r) => r.outputTokens), totalTokens: sum((r) => r.totalTokens),
    cost: round(sum((r) => r.cost)), charge: round(sum((r) => r.charge)), ownKeyCalls: sum((r) => r.ownKeyCalls), ownKeyTokens: sum((r) => r.ownKeyTokens), unpricedCalls: sum((r) => r.unpricedCalls) };
  const kinds = await q(pool, `SELECT u.kind, COUNT(*) AS calls, SUM(u.input_tokens + u.output_tokens) AS tokens, SUM(COALESCE(${cost}, 0)) AS cost FROM ai_usage u ${join} WHERE ${range} GROUP BY u.kind ORDER BY tokens DESC`, [from, to]);
  const unpriced = await q(pool, `SELECT u.provider, u.model, COUNT(*) AS calls, SUM(u.input_tokens + u.output_tokens) AS tokens FROM ai_usage u ${join} WHERE ${range} AND ${cost} IS NULL GROUP BY u.provider, u.model`, [from, to]);
  const prices = await q(pool, 'SELECT provider, model, input_per_mtok, output_per_mtok, updated_by, updated_at FROM ai_prices ORDER BY provider, model');
  return {
    from, to, markupPct, merchants: rows, totals,
    byKind: kinds.map((k) => ({ kind: k.kind, calls: Number(k.calls), totalTokens: Number(k.tokens), cost: round(Number(k.cost)) })),
    unpricedModels: unpriced.map((u) => ({ provider: u.provider, model: u.model, calls: Number(u.calls), tokens: Number(u.tokens) })),
    prices: prices.map((p) => ({ provider: p.provider, model: p.model, inputPerMTok: Number(p.input_per_mtok), outputPerMTok: Number(p.output_per_mtok), updatedBy: p.updated_by, updatedAt: new Date(p.updated_at).toISOString() })),
  };
}

/** A spreadsheet cell: quotes doubled, and a leading = + - @ made harmless so a merchant name cannot run as a formula. */
const cell = (v: string | number) => { let s = String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function billingCsv(r: BillingReport): string {
  const head = ['Merchant', 'Code', 'From', 'To', 'Chats', 'AI calls', 'Input tokens', 'Output tokens', 'Total tokens', 'AI cost (USD)', `To charge (USD, +${r.markupPct}%)`, 'Calls on own key', 'Calls without a price'];
  const line = (name: string, code: string, x: Omit<BillingRow, 'code' | 'name'>) => [name, code, r.from, r.to, x.chats, x.calls, x.inputTokens, x.outputTokens, x.totalTokens, x.cost.toFixed(4), x.charge.toFixed(4), x.ownKeyCalls, x.unpricedCalls].map(cell).join(',');
  return [head.map(cell).join(','), ...r.merchants.map((m) => line(m.name, m.code, m)), line('Total', '', r.totals)].join('\r\n') + '\r\n';
}

/** Usage and billing (admin only): tokens, calls and cost per merchant for a period, the price table, the markup and a CSV for invoicing. */
export function billingRoutes(app: FastifyInstance, ctx: { pool: Pool; onPriceChange?: () => void }) {
  const { pool } = ctx;
  const adminOnly = (req: { user?: { role: string } }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) =>
    (req.user?.role === 'admin' ? true : (reply.code(403).send({ error: 'Only an admin can do this.' }), false));
  const bad = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, msg: string) => reply.code(400).send({ error: msg });

  app.get<{ Querystring: { from?: string; to?: string } }>('/api/admin/billing', async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const p = period(req.query); if (!p) return bad(reply, 'Choose a start date and an end date (YYYY-MM-DD), the start not after the end.');
    return billingReport(pool, p.from, p.to);
  });

  app.get<{ Querystring: { from?: string; to?: string } }>('/api/admin/billing.csv', async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const p = period(req.query); if (!p) return bad(reply, 'Choose a start date and an end date (YYYY-MM-DD), the start not after the end.');
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="billing-${p.from}_${p.to}.csv"`).send('﻿' + billingCsv(await billingReport(pool, p.from, p.to)));
  });

  app.post<{ Body: { provider?: string; model?: string; inputPerMTok?: number; outputPerMTok?: number } }>('/api/admin/billing/price', async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const { provider, model } = req.body ?? {}; const inp = Number(req.body?.inputPerMTok), out = Number(req.body?.outputPerMTok);
    if (provider !== 'anthropic' && provider !== 'openai') return bad(reply, 'Choose Claude (anthropic) or ChatGPT (openai).');
    if (!model || !/^[A-Za-z0-9._:-]{1,100}$/.test(model)) return bad(reply, 'Write the model name exactly as the provider names it, for example claude-haiku-5-5.');
    if (![inp, out].every((n) => Number.isFinite(n) && n >= 0 && n <= 100000)) return bad(reply, 'Prices are numbers from 0 up: US dollars per million tokens.');
    await pool.query('INSERT INTO ai_prices(provider, model, input_per_mtok, output_per_mtok, updated_by) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE input_per_mtok = VALUES(input_per_mtok), output_per_mtok = VALUES(output_per_mtok), updated_by = VALUES(updated_by)', [provider, model, inp, out, req.user!.username]);
    ctx.onPriceChange?.(); return { saved: true };
  });

  app.post<{ Body: { provider?: string; model?: string } }>('/api/admin/billing/price/remove', async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    await pool.query('DELETE FROM ai_prices WHERE provider = ? AND model = ?', [String(req.body?.provider ?? ''), String(req.body?.model ?? '')]);
    ctx.onPriceChange?.(); return { removed: true };
  });

  app.post<{ Body: { pct?: number } }>('/api/admin/billing/markup', async (req, reply) => {
    if (!adminOnly(req, reply)) return;
    const pct = Number(req.body?.pct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 1000) return bad(reply, 'The markup is a percent from 0 to 1000.');
    await pool.query('UPDATE billing_settings SET markup_pct = ? WHERE id = 1', [pct]); return { saved: true, pct };
  });
}
