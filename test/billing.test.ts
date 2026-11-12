import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed, DEMO_ADMIN, DEMO_STAFF_PASSWORD } from '../src/db/seed';
import { buildApp } from '../src/server/app';
import { UsageRecorder, type UsageEvent } from '../src/ai/usage';
import { createAi, createRoutedAi } from '../src/ai';
import { MerchantAiKeys } from '../src/ai/merchantKeys';
import { billingCsv, type BillingReport } from '../src/admin/billing';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const claudeReply = (inT: number, outT: number) => json({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: '{"intent_key":"deposit_how","confidence":0.9}' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: inT, output_tokens: outT } });
const pickInput = (merchant?: string) => ({ merchant, merchantName: 'M', text: 'hi', lang: 'en', entries: [{ key: 'deposit_how', topic: 'deposit', aspect: null, examples: [] }] });

describe('AI calls report their tokens', () => {
  it('a Claude call tells the listener how many tokens it used, for which merchant and kind', async () => {
    const seen: UsageEvent[] = [];
    const ai = createAi({ anthropicKey: 'sk-ant-test-key-0000', claudeModel: 'claude-haiku-5-5', onUsage: (e) => seen.push(e), fetch: (async () => claudeReply(1200, 80)) as unknown as typeof fetch });
    await ai.pickEntry(pickInput('MERCH_A'));
    expect(seen).toEqual([{ merchant: 'MERCH_A', provider: 'anthropic', model: 'claude-haiku-5-5', kind: 'pick', inputTokens: 1200, outputTokens: 80 }]);
  });
  it('a failing counter never breaks the reply', async () => {
    const ai = createAi({ anthropicKey: 'sk-ant-test-key-0000', onUsage: () => { throw new Error('db down'); }, fetch: (async () => claudeReply(5, 5)) as unknown as typeof fetch });
    expect((await ai.pickEntry(pickInput('MERCH_A')))?.intent).toBe('deposit_how');
  });
});

const url = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null; let reachable = false;
if (url) { pool = createPool(url, 6); try { await pool.query('select 1'); reachable = true; } catch { /* skipped below */ } }

describe.skipIf(!reachable)('usage and billing (needs TEST_DATABASE_URL)', () => {
  let app: FastifyInstance; let admin = ''; let staff = ''; let rec: UsageRecorder;
  const rows = async (sql: string, p: unknown[] = []) => (await pool!.query<RowDataPacket[]>(sql, p))[0];
  const as = (cookie: string, method: 'GET' | 'POST', path: string, payload?: object) => app.inject({ method, url: path, payload: payload as object, headers: { cookie } });
  const day = new Date().toISOString().slice(0, 10);
  beforeAll(async () => {
    await migrate(pool!, { reset: true }); await seed(pool!);
    app = await buildApp({ pool: pool!, logger: false }); rec = new UsageRecorder(pool!);
    const login = async (payload: object) => String((await app.inject({ method: 'POST', url: '/api/auth/login', payload })).headers['set-cookie']).split(';')[0];
    admin = await login(DEMO_ADMIN); staff = await login({ username: 'luckypay', password: DEMO_STAFF_PASSWORD });
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it('is for admins only, and checks the dates and the numbers', async () => {
    for (const [m, u, b] of [['GET', '/api/admin/billing'], ['GET', '/api/admin/billing.csv'], ['POST', '/api/admin/billing/price', { provider: 'openai', model: 'x', inputPerMTok: 1, outputPerMTok: 1 }], ['POST', '/api/admin/billing/markup', { pct: 5 }]] as const)
      expect((await as(staff, m, u, b)).statusCode).toBe(403);
    expect((await as(admin, 'GET', '/api/admin/billing?from=2026-13-40&to=2026-01-01')).statusCode).toBe(400);
    expect((await as(admin, 'GET', `/api/admin/billing?from=${day}&to=2000-01-01`)).statusCode).toBe(400);   // the start is after the end
    expect((await as(admin, 'POST', '/api/admin/billing/price', { provider: 'gemini', model: 'x', inputPerMTok: 1, outputPerMTok: 1 })).statusCode).toBe(400);
    expect((await as(admin, 'POST', '/api/admin/billing/price', { provider: 'openai', model: 'x', inputPerMTok: -1, outputPerMTok: 1 })).statusCode).toBe(400);
    expect((await as(admin, 'POST', '/api/admin/billing/markup', { pct: -5 })).statusCode).toBe(400);
  });

  it('adds up tokens and cost per merchant, charges the markup, and keeps calls on a merchant\'s own key out of the charge', async () => {
    await rec.record({ merchant: 'MERCH_A', provider: 'anthropic', model: 'claude-haiku-5-5', kind: 'pick', inputTokens: 2_000_000, outputTokens: 1_000_000 });    // 0.10*2 + 0.50*1 = 0.70
    await rec.record({ merchant: 'MERCH_A', provider: 'anthropic', model: 'claude-haiku-5-5', kind: 'translate', inputTokens: 1_000_000, outputTokens: 0 });          // 0.10
    await rec.record({ merchant: 'MERCH_A', provider: 'anthropic', model: 'claude-haiku-5-5', kind: 'pick', inputTokens: 5_000_000, outputTokens: 5_000_000, own: true });   // own key: not charged
    await rec.record({ merchant: 'MERCH_B', provider: 'anthropic', model: 'claude-sonnet-5-5', kind: 'describe', inputTokens: 500_000, outputTokens: 100_000 });        // 2*0.5 + 10*0.1 = 2.00
    expect((await as(admin, 'POST', '/api/admin/billing/markup', { pct: 20 })).statusCode).toBe(200);
    const r: BillingReport = (await as(admin, 'GET', `/api/admin/billing?from=${day}&to=${day}`)).json();
    const a = r.merchants.find((m) => m.code === 'MERCH_A')!, b = r.merchants.find((m) => m.code === 'MERCH_B')!, c = r.merchants.find((m) => m.code === 'MERCH_C')!;
    expect(a).toMatchObject({ calls: 3, inputTokens: 8_000_000, outputTokens: 6_000_000, totalTokens: 14_000_000, ownKeyCalls: 1, ownKeyTokens: 10_000_000, unpricedCalls: 0 });
    expect(a.cost).toBeCloseTo(0.8, 6); expect(a.charge).toBeCloseTo(0.96, 6);                // 0.80 on the shared key, +20%
    expect(b.cost).toBeCloseTo(2.0, 6); expect(b.charge).toBeCloseTo(2.4, 6);
    expect(c).toMatchObject({ calls: 0, totalTokens: 0, cost: 0, charge: 0 });               // a merchant with no AI use is still listed
    expect(r.totals).toMatchObject({ calls: 4, cost: 2.8 }); expect(r.totals.charge).toBeCloseTo(3.36, 6);
    expect(r.byKind.map((k) => k.kind).sort()).toEqual(['describe', 'pick', 'translate']);
    expect(r.markupPct).toBe(20); expect(r.prices.some((p) => p.model === 'claude-haiku-5-5')).toBe(true);
  });

  it('counts only the chosen days, and the real chats of the period', async () => {
    const empty: BillingReport = (await as(admin, 'GET', '/api/admin/billing?from=2001-01-01&to=2001-01-31')).json();
    expect(empty.totals).toMatchObject({ calls: 0, totalTokens: 0, cost: 0 });
    const now: BillingReport = (await as(admin, 'GET', `/api/admin/billing?from=${day}&to=${day}`)).json();
    expect(now.merchants.find((m) => m.code === 'MERCH_A')!.chats).toBeGreaterThanOrEqual(0);
  });

  it('a model without a price is counted but not priced, and is priced from the day a price is set', async () => {
    await rec.record({ merchant: 'MERCH_C', provider: 'openai', model: 'gpt-new', kind: 'write', inputTokens: 1_000_000, outputTokens: 1_000_000 });
    expect((await rows("SELECT cost_usd FROM ai_usage WHERE model = 'gpt-new'"))[0].cost_usd).toBeNull();
    const before: BillingReport = (await as(admin, 'GET', `/api/admin/billing?from=${day}&to=${day}`)).json();
    expect(before.merchants.find((m) => m.code === 'MERCH_C')).toMatchObject({ calls: 1, totalTokens: 2_000_000, cost: 0, unpricedCalls: 1 });
    expect(before.unpricedModels).toEqual([{ provider: 'openai', model: 'gpt-new', calls: 1, tokens: 2_000_000 }]);
    expect((await as(admin, 'POST', '/api/admin/billing/price', { provider: 'openai', model: 'gpt-new', inputPerMTok: 1, outputPerMTok: 3 })).statusCode).toBe(200);
    const after: BillingReport = (await as(admin, 'GET', `/api/admin/billing?from=${day}&to=${day}`)).json();
    expect(after.merchants.find((m) => m.code === 'MERCH_C')).toMatchObject({ cost: 4, unpricedCalls: 0 }); expect(after.unpricedModels).toEqual([]);
    rec.forgetPrices();                                                                                                                 // (the app does this itself when a price is saved)
    await rec.record({ merchant: 'MERCH_C', provider: 'openai', model: 'gpt-new', kind: 'write', inputTokens: 1_000_000, outputTokens: 0 });     // now priced at the moment of the call
    expect(Number((await rows("SELECT cost_usd FROM ai_usage WHERE model = 'gpt-new' ORDER BY id DESC LIMIT 1"))[0].cost_usd)).toBeCloseTo(1, 6);
    await as(admin, 'POST', '/api/admin/billing/price', { provider: 'openai', model: 'gpt-new', inputPerMTok: 100, outputPerMTok: 100 });            // a later price change does not rewrite that row
    expect(Number((await rows("SELECT cost_usd FROM ai_usage WHERE model = 'gpt-new' ORDER BY id DESC LIMIT 1"))[0].cost_usd)).toBeCloseTo(1, 6);
    expect((await as(admin, 'POST', '/api/admin/billing/price/remove', { provider: 'openai', model: 'gpt-new' })).json().removed).toBe(true);
  });

  it('a merchant\'s own key marks its calls as own, the shared key does not', async () => {
    const events: UsageEvent[] = [];
    const keys = new MerchantAiKeys(pool!, 0); await keys.set('MERCH_D', 'anthropic', 'sk-ant-merchant-d-key-dddd', 'test');
    const ai = createRoutedAi({ anthropicKey: 'sk-ant-shared-key-ssss', onUsage: (e) => events.push(e), fetch: (async () => claudeReply(10, 2)) as unknown as typeof fetch }, keys);
    await ai.pickEntry(pickInput('MERCH_D')); await ai.pickEntry(pickInput('MERCH_E')); await ai.pickEntry(pickInput());
    expect(events.map((e) => [e.merchant ?? null, e.own])).toEqual([['MERCH_D', true], ['MERCH_E', false], [null, false]]);
  });

  it('writes a CSV for invoicing that opens safely in a spreadsheet', async () => {
    const res = await as(admin, 'GET', `/api/admin/billing.csv?from=${day}&to=${day}`);
    expect(res.statusCode).toBe(200); expect(res.headers['content-type']).toContain('text/csv'); expect(res.headers['content-disposition']).toContain(`billing-${day}_${day}.csv`);
    const lines = res.body.replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toBe('Merchant,Code,From,To,Chats,AI calls,Input tokens,Output tokens,Total tokens,AI cost (USD),"To charge (USD, +20%)",Calls on own key,Calls without a price');
    expect(lines.find((l) => l.startsWith('LuckyPay,MERCH_A'))).toContain(',14000000,0.8000,0.9600,1,');
    expect(lines.at(-1)!.startsWith('Total,')).toBe(true);
    const r: BillingReport = { from: day, to: day, markupPct: 0, merchants: [{ code: 'X', name: '=HYPERLINK("http://evil")', chats: 0, calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, charge: 0, ownKeyCalls: 0, ownKeyTokens: 0, unpricedCalls: 0 }],
      totals: { chats: 0, calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0, charge: 0, ownKeyCalls: 0, ownKeyTokens: 0, unpricedCalls: 0 }, byKind: [], unpricedModels: [], prices: [] };
    expect(billingCsv(r).split('\r\n')[1].startsWith("\"'=HYPERLINK(\"\"http://evil\"\")\",X,")).toBe(true);        // quoted, and the formula start is made harmless
  });

  it('shows an admin the real reason when a screen crashes, and everyone else only the short error', async () => {
    await pool!.query('RENAME TABLE billing_settings TO billing_settings_off');
    try {
      const a = await as(admin, 'GET', `/api/admin/billing?from=${day}&to=${day}`);
      expect(a.statusCode).toBe(500); expect(a.json().error).toMatch(/The server could not do this\. Reason: .*billing_settings/);
      const s = await as(staff, 'GET', '/api/admin/billing');                                           // staff are refused before anything runs
      expect(s.statusCode).toBe(403);
    } finally { await pool!.query('RENAME TABLE billing_settings_off TO billing_settings'); }
    expect((await as(admin, 'GET', `/api/admin/billing?from=${day}&to=${day}`)).statusCode).toBe(200);
  });
});
