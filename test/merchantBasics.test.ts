import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed, DEMO_ADMIN, DEMO_STAFF_PASSWORD } from '../src/db/seed';
import { buildApp } from '../src/server/app';
import { dbNameFor, tbl } from '../src/db/tenants';
import { MerchantAiKeys } from '../src/ai/merchantKeys';
import { MerchantLimits } from '../src/ai/limits';
import { createRoutedAi } from '../src/ai';
import { readSnapshot, writeSnapshot } from '../src/admin/snapshot';
import { effectiveSnapshot } from '../src/admin/scope';
import { Bot, newSession } from '../src/bot/responder';
import { knowledgeFromSeed } from '../src/engine';
import { seedJson, accountsJson } from './helpers';

describe('languages a merchant switches off', () => {
  const bot = new Bot(knowledgeFromSeed(seedJson, accountsJson)); const cfg = bot.engine.merchant('MERCH_A');
  const say = async (text: string) => (await bot.message(newSession('lang-' + Math.random(), 'MERCH_A', null), text))!;
  it('a customer writing in a language that is off gets the merchant main language; with it on they get their own', async () => {
    cfg.languages = undefined; expect((await say('充值要多久')).trace.lang).toBe('zh');          // all languages on (the default)
    cfg.languages = ['en']; const t = await say('充值要多久');
    expect(t.trace.lang).toBe('en'); expect(t.trace.decision).toBe('ANSWER');                    // still understood, answered in English
    cfg.languages = ['en', 'zh']; expect((await say('充值要多久')).trace.lang).toBe('zh'); cfg.languages = undefined;
  });
});

const url = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null; let reachable = false;
if (url) { pool = createPool(url, 6); try { await pool.query('select 1'); reachable = true; } catch { /* skipped below */ } }

describe.skipIf(!reachable)('merchant basics, token limit and style rules (needs TEST_DATABASE_URL)', () => {
  let app: FastifyInstance; let admin = ''; let staff = '';
  const as = (cookie: string, method: 'GET' | 'POST', path: string, payload?: object) => app.inject({ method, url: path, payload: payload as object, headers: { cookie } });
  const B = '/api/admin/merchants/MERCH_A/basics';
  beforeAll(async () => {
    await migrate(pool!, { reset: true }); await seed(pool!);
    app = await buildApp({ pool: pool!, logger: false });
    const login = async (payload: object) => String((await app.inject({ method: 'POST', url: '/api/auth/login', payload })).headers['set-cookie']).split(';')[0];
    admin = await login(DEMO_ADMIN); staff = await login({ username: 'luckypay', password: DEMO_STAFF_PASSWORD });
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it('shows the tiles to the merchant staff, and keeps other merchants out', async () => {
    const r = await as(staff, 'GET', B); expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ name: 'LuckyPay', domain: '', monthlyTokenLimit: null, tokensToday: 0 });
    expect(typeof r.json().questionsToday).toBe('number');                                        // the seed has sample chats from today
    expect(r.json().avgConfidence === null || typeof r.json().avgConfidence === 'number').toBe(true);
    expect(r.json().entries).toBeGreaterThan(0); expect(r.json().languages).toEqual(['en', 'ms', 'zh', 'vi', 'th', 'tl']);
    expect((await as(staff, 'GET', '/api/admin/merchants/MERCH_B/basics')).statusCode).toBe(403);
  });

  it('only an admin saves the basics, bad values are refused, good ones are kept', async () => {
    expect((await as(staff, 'POST', B, { name: 'Hacked' })).statusCode).toBe(403);
    expect((await as(admin, 'POST', B, { domain: 'not a domain' })).statusCode).toBe(400);
    expect((await as(admin, 'POST', B, { monthlyTokenLimit: -5 })).statusCode).toBe(400);
    expect((await as(admin, 'POST', B, { languages: ['zh'] })).statusCode).toBe(400);              // the main language (English) must stay on
    expect((await as(admin, 'POST', B, { languages: [] })).statusCode).toBe(400);
    expect((await as(admin, 'POST', B, { name: '  ' })).statusCode).toBe(400);
    const ok = await as(admin, 'POST', B, { name: 'LuckyPay SG', domain: 'https://www.LuckyPay.com/', monthlyTokenLimit: 500000, languages: ['en', 'zh'] });
    expect(ok.statusCode).toBe(200);
    expect((await as(admin, 'GET', B)).json()).toMatchObject({ name: 'LuckyPay SG', domain: 'www.luckypay.com', monthlyTokenLimit: 500000, languages: ['en', 'zh'] });
    await as(admin, 'POST', B, { monthlyTokenLimit: null, languages: ['en', 'ms', 'zh', 'vi', 'th', 'tl'] });
    expect((await as(admin, 'GET', B)).json()).toMatchObject({ monthlyTokenLimit: null }); expect((await as(admin, 'GET', B)).json().languages).toHaveLength(6);
    await as(admin, 'POST', B, { name: 'LuckyPay' });
  });

  it('the bot loads the languages that are on', async () => {
    await as(admin, 'POST', B, { languages: ['en', 'zh'] });
    const { loadKnowledge } = await import('../src/db/loadKnowledge');
    expect((await loadKnowledge(pool!)).merchants.find((m) => m.code === 'MERCH_A')?.languages).toEqual(['en', 'zh']);
    await as(admin, 'POST', B, { languages: ['en', 'ms', 'zh', 'vi', 'th', 'tl'] });
  });

  /** A stand-in for Claude that records what it was asked. */
  const fake = () => {
    const bodies: { system?: string; messages: { content: string }[] }[] = [];
    const base = { anthropicKey: 'sk-ant-shared-key-ssss', fetch: (async (_u: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)); bodies.push(body);
      const text = JSON.stringify(body.system?.includes?.('translat') || /Translate from/.test(body.messages[0].content) ? { answer: 'Terjemahan', examples: [] } : { intent_key: 'deposit_how', confidence: 0.9 });
      return new Response(JSON.stringify({ id: 'x', type: 'message', role: 'assistant', model: 'm', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch };
    return { bodies, base };
  };
  const pickInput = { merchant: 'MERCH_A', merchantName: 'M', text: 'hi', lang: 'en', entries: [{ key: 'deposit_how', topic: 'deposit', aspect: null, examples: [] }] };

  it('stops the AI help of a merchant that used up its monthly tokens, and starts again when the limit is raised', async () => {
    const limits = new MerchantLimits(pool!, 0); const f = fake(); const ai = createRoutedAi(f.base, new MerchantAiKeys(pool!, 0), limits);
    await as(admin, 'POST', B, { monthlyTokenLimit: 1000 });
    expect(await ai.pickEntry(pickInput)).not.toBeNull(); const before = f.bodies.length;       // nothing used yet
    await pool!.query("INSERT INTO ai_usage(merchant_id, provider, model, kind, key_source, input_tokens, output_tokens) VALUES((SELECT id FROM merchants WHERE code = 'MERCH_A'),'anthropic','m','pick','shared',600,500)");
    expect(await ai.pickEntry(pickInput)).toBeNull(); expect(f.bodies.length).toBe(before);       // 1,100 of 1,000 used: no call is made
    expect(await ai.translate({ merchant: 'MERCH_A', merchantName: 'M', from: 'en', to: 'ms', answer: 'Hi', examples: [] })).toBeNull();
    expect(await ai.pickEntry({ ...pickInput, merchant: 'MERCH_B' })).not.toBeNull();             // another merchant is not affected
    expect((await as(staff, 'GET', B)).json()).toMatchObject({ monthlyTokenLimit: 1000, tokensMonth: 1100, tokensToday: 1100 });
    await as(admin, 'POST', B, { monthlyTokenLimit: 5000 }); expect(await ai.pickEntry(pickInput)).not.toBeNull();
    await as(admin, 'POST', B, { monthlyTokenLimit: null });
  });

  it('adds the merchant style rules to translating, but never to choosing an answer', async () => {
    const limits = new MerchantLimits(pool!, 0); const f = fake(); const ai = createRoutedAi(f.base, new MerchantAiKeys(pool!, 0), limits);
    const settings = tbl(dbNameFor('livechat_bot_test', 'MERCH_A'), 'settings');
    await pool!.query(`UPDATE ${settings} SET ai_instructions = ? WHERE id = 1`, ['- Address the customer as "Dear Member".']);
    limits.forget();
    await ai.translate({ merchant: 'MERCH_A', merchantName: 'M', from: 'en', to: 'ms', answer: 'Hi', examples: [] });
    expect(f.bodies.at(-1)!.messages[0].content).toContain('<style>- Address the customer as "Dear Member".</style>');
    expect(f.bodies.at(-1)!.messages[0].content).toMatch(/Never add facts/);
    await ai.pickEntry(pickInput); expect(f.bodies.at(-1)!.messages[0].content).not.toContain('<style>');
    await ai.translate({ merchant: 'MERCH_A', merchantName: 'M', from: 'en', to: 'ms', answer: 'Hi', examples: [], style: '- Draft rule' });   // the panel sends the unpublished text
    expect(f.bodies.at(-1)!.messages[0].content).toContain('<style>- Draft rule</style>');
    await ai.translate({ merchant: 'MERCH_B', merchantName: 'M', from: 'en', to: 'ms', answer: 'Hi', examples: [] });
    expect(f.bodies.at(-1)!.messages[0].content).not.toContain('<style>');                        // another merchant has no rules
  });

  it('saves the style rules with the draft, staff may write their own merchant rules, and the length is capped', async () => {
    const snap = await readSnapshot(pool!);
    const next = JSON.parse(JSON.stringify(snap)); next.settings.MERCH_A.ai_instructions = '- Formal.'; next.settings.MERCH_B.ai_instructions = '- hack';
    const asStaff = effectiveSnapshot({ username: 'luckypay', role: 'staff', merchant: 'MERCH_A' } as never, snap, { ...next, settings: { ...next.settings, MERCH_A: { ...next.settings.MERCH_A, ai_instructions: 'x'.repeat(6000) } } });
    expect(asStaff.settings.MERCH_A.ai_instructions).toHaveLength(5000);                          // staff may write it, up to 5000 characters
    expect(asStaff.settings.MERCH_B.ai_instructions).toBe(snap.settings.MERCH_B.ai_instructions);   // but never another merchant's
    await writeSnapshot(pool!, next, { merchants: ['MERCH_A'], shared: false });
    expect((await readSnapshot(pool!)).settings.MERCH_A.ai_instructions).toBe('- Formal.');
  });
});
