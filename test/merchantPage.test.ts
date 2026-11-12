import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { RowDataPacket } from 'mysql2/promise';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed, DEMO_ADMIN, DEMO_STAFF_PASSWORD } from '../src/db/seed';
import { buildApp } from '../src/server/app';
import { decryptSecret, encryptSecret } from '../src/secrets';
import { MerchantAiKeys } from '../src/ai/merchantKeys';
import { createRoutedAi } from '../src/ai';
import type { PickInput } from '../src/ai/types';

describe('encrypting secrets', () => {
  it('round-trips, never shows the key in the stored text, and fails safely with another secret', () => {
    const enc = encryptSecret('sk-ant-very-secret-key-1234', 's1');
    expect(enc).not.toContain('very-secret'); expect(enc.startsWith('v1:')).toBe(true);
    expect(decryptSecret(enc, 's1')).toBe('sk-ant-very-secret-key-1234');
    expect(decryptSecret(enc, 'other')).toBeNull();
    expect(decryptSecret('garbage', 's1')).toBeNull();
    expect(encryptSecret('same', 's1')).not.toBe(encryptSecret('same', 's1'));          // a fresh random start each time
  });
});

const url = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null; let reachable = false;
if (url) { pool = createPool(url, 6); try { await pool.query('select 1'); reachable = true; } catch { /* skipped below */ } }

describe.skipIf(!reachable)('the merchant page (needs TEST_DATABASE_URL)', () => {
  let app: FastifyInstance; let admin = ''; let staff = '';
  const rows = async (sql: string, p: unknown[] = []) => (await pool!.query<RowDataPacket[]>(sql, p))[0];
  const as = (cookie: string, method: 'GET' | 'POST', path: string, payload?: object) => app.inject({ method, url: path, payload: payload as object, headers: { cookie, host: 'bot.example.test:3000' } });
  beforeAll(async () => {
    await migrate(pool!, { reset: true }); await seed(pool!);
    app = await buildApp({ pool: pool!, logger: false });
    const login = async (payload: object) => String((await app.inject({ method: 'POST', url: '/api/auth/login', payload })).headers['set-cookie']).split(';')[0];
    admin = await login(DEMO_ADMIN); staff = await login({ username: 'luckypay', password: DEMO_STAFF_PASSWORD });
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it('is for admins only, and unknown merchants are not found', async () => {
    expect((await as(staff, 'GET', '/api/admin/merchants/MERCH_A/connection')).statusCode).toBe(403);
    expect((await as(staff, 'POST', '/api/admin/merchants/MERCH_A/ai-key', { provider: 'anthropic', key: 'sk-ant-abcdefghijkl' })).statusCode).toBe(403);
    expect((await as(staff, 'POST', '/api/admin/merchants/MERCH_A/test-link', {})).statusCode).toBe(403);
    expect((await as(admin, 'GET', '/api/admin/merchants/NOPE/connection')).statusCode).toBe(404);
  });

  it('shows what LiveChat needs: the address, the key list and the merchant summary', async () => {
    const before = (await as(admin, 'GET', '/api/admin/merchants/MERCH_A/connection')).json();
    expect(before.merchant).toMatchObject({ code: 'MERCH_A', name: 'LuckyPay', tone: 'friendly' });
    expect(before.merchant.entries).toBeGreaterThan(0); expect(before.merchant.logins).toContain('luckypay');
    expect(before.livechat.baseUrl).toBe('http://bot.example.test:3000');                // the address of the open page
    expect(before.livechat.askUrl).toBe('http://bot.example.test:3000/api/v1/ai/ask');
    expect(before.livechat.keys).toEqual([]); const chatsBefore = before.livechat.liveChats7d;       // the sample data counts as real chats
    const made = (await as(admin, 'POST', '/api/admin/merchants/MERCH_A/bot-key', {})).json();
    await app.inject({ method: 'POST', url: '/api/v1/ai/ask', payload: { question: 'depo how' }, headers: { authorization: 'Bearer ' + made.key } });   // one real chat from LiveChat
    await new Promise((r) => setTimeout(r, 300));                                         // the chat is saved in the background
    const after = (await as(admin, 'GET', '/api/admin/merchants/MERCH_A/connection')).json();
    expect(after.livechat.keys).toHaveLength(1); expect(after.livechat.keys[0].prefix).toBe(made.key.slice(0, 8));
    expect(after.livechat.liveChats7d).toBe(chatsBefore + 1); expect(after.livechat.keys[0].lastUsedAt).not.toBeNull();
    expect(JSON.stringify(after)).not.toContain(made.key);                               // the key itself is never shown again
    await as(admin, 'POST', '/api/admin/merchants/MERCH_A/bot-key', {});                 // replace: the old one is stopped and not listed as active
    const again = (await as(admin, 'GET', '/api/admin/merchants/MERCH_A/connection')).json();
    expect(again.livechat.keys).toHaveLength(1); expect(again.livechat.stoppedKeys).toBe(1);
  });

  it('saves a merchant AI key encrypted, shows only the last 4, replaces it and removes it', async () => {
    const key = 'sk-ant-api03-MERCHANT-A-SECRET-wxyz';
    expect((await as(admin, 'POST', '/api/admin/merchants/MERCH_A/ai-key', { provider: 'anthropic', key: ' ' + key + ' ' })).json()).toMatchObject({ saved: true, last4: 'wxyz' });
    const stored = await rows('SELECT key_encrypted, key_last4 FROM merchant_ai_keys');
    expect(stored).toHaveLength(1); expect(stored[0].key_encrypted).not.toContain('MERCHANT-A-SECRET'); expect(decryptSecret(stored[0].key_encrypted)).toBe(key);
    const c = (await as(admin, 'GET', '/api/admin/merchants/MERCH_A/connection')).json();
    expect(JSON.stringify(c)).not.toContain('MERCHANT-A-SECRET');
    expect(c.ai.anthropic).toMatchObject({ configured: true, last4: 'wxyz', using: 'merchant', updatedBy: 'admin' });
    expect(c.ai.openai).toMatchObject({ configured: false, using: 'none' });
    expect((await as(admin, 'GET', '/api/admin/merchants/MERCH_B/connection')).json().ai.anthropic.configured).toBe(false);   // another merchant is not affected
    await as(admin, 'POST', '/api/admin/merchants/MERCH_A/ai-key', { provider: 'anthropic', key: 'sk-ant-api03-REPLACED-KEY-9999' });
    expect((await rows('SELECT key_last4 FROM merchant_ai_keys'))[0].key_last4).toBe('9999');
    expect((await as(admin, 'POST', '/api/admin/merchants/MERCH_A/ai-key', { provider: 'anthropic', key: 'short' })).statusCode).toBe(400);
    expect((await as(admin, 'POST', '/api/admin/merchants/MERCH_A/ai-key', { provider: 'gemini', key: 'sk-ant-api03-REPLACED-KEY-9999' })).statusCode).toBe(400);
    expect((await as(admin, 'POST', '/api/admin/merchants/MERCH_A/ai-key/remove', { provider: 'anthropic' })).json().removed).toBe(true);
    expect(await rows('SELECT 1 FROM merchant_ai_keys')).toHaveLength(0);
  });

  it('the test button asks the bot like LiveChat does and is saved as a test chat, not live traffic', async () => {
    const live = async () => Number((await rows(`SELECT COUNT(*) n FROM ${'livechat_bot_test_m_merch_a'}.chat_sessions WHERE source = 'live'`))[0].n);
    const before = await live();
    const r = (await as(admin, 'POST', '/api/admin/merchants/MERCH_A/test-link', { question: 'depo how' })).json();
    expect(r.ok).toBe(true); expect(r.answer).toContain('Wallet > Deposit'); expect(r.decision).toBe('answer');
    expect(await live()).toBe(before);
    expect(Number((await rows(`SELECT COUNT(*) n FROM livechat_bot_test_m_merch_a.chat_sessions WHERE source = 'test'`))[0].n)).toBeGreaterThan(0);
  });

  it('a merchant with its own key uses it, the others use the shared key', async () => {
    const keys = new MerchantAiKeys(pool!, 0);
    await keys.set('MERCH_A', 'anthropic', 'sk-ant-merchant-a-key-aaaa', 'test');
    const used: string[] = [];
    // A stand-in for the real Claude: records which key built the client
    const base = { anthropicKey: 'sk-ant-shared-key-ssss', anthropic: undefined, fetch: (async (_u: unknown, init?: RequestInit) => {
      used.push((new Headers(init?.headers).get('authorization') ?? '').replace(/^Bearer /, '')); return new Response(JSON.stringify({ id: 'x', type: 'message', role: 'assistant', model: 'm', content: [{ type: 'text', text: '{"intent_key":"deposit_how","confidence":0.9}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch };
    const ai = createRoutedAi(base, keys);
    expect(ai.canPick).toBe(true);
    const input = (merchant?: string): PickInput => ({ merchant, merchantName: 'M', text: 'hi', lang: 'en', entries: [{ key: 'deposit_how', topic: 'deposit', aspect: null, examples: [] }] });
    await ai.pickEntry(input('MERCH_A')); await ai.pickEntry(input('MERCH_B')); await ai.pickEntry(input());
    expect(used).toEqual(['sk-ant-merchant-a-key-aaaa', 'sk-ant-shared-key-ssss', 'sk-ant-shared-key-ssss']);
    await keys.clear('MERCH_A', 'anthropic'); await ai.pickEntry(input('MERCH_A'));
    expect(used.at(-1)).toBe('sk-ant-shared-key-ssss');                                   // removed: back to the shared key
  });
});
