import { describe, it, expect } from 'vitest';
import { dbNameFor, tbl } from '../src/db/tenants';
import { createAi, checkReply, checkTranslation, type AiService, type PickInput, type TranslateInput } from '../src/ai';
import { Bot, newSession } from '../src/bot/responder';
import { knowledgeFromSeed } from '../src/engine';
import { seedJson, accountsJson } from './helpers';

/* ---------- the checker that stops ChatGPT from changing facts ---------- */
describe('reply checker', () => {
  const facts = 'To deposit, go to Wallet > Deposit, choose a payment method and follow the steps. The minimum is MYR 10 and the maximum is MYR 30,000.';
  it('accepts a reply that keeps the facts', () => {
    expect(checkReply('Sure! Open Wallet > Deposit, pick a payment method and follow the steps. The minimum is MYR 10, the maximum MYR 30000.', facts).ok).toBe(true);
  });
  it('rejects a changed, added or missing number', () => {
    expect(checkReply('Open Wallet > Deposit. The minimum is MYR 20 and the maximum is MYR 30,000.', facts).ok).toBe(false);
    expect(checkReply('Open Wallet > Deposit. Minimum MYR 10, maximum MYR 30,000, and it takes 5 minutes.', facts).ok).toBe(false);
    expect(checkReply('Open Wallet > Deposit. The minimum is MYR 10.', facts).reason).toMatch(/left out/);
  });
  it('rejects links and menu paths that are not in the answer', () => {
    expect(checkReply('Open Wallet > Deposit. MYR 10 to MYR 30,000. More at https://example.com/help', facts).ok).toBe(false);
    expect(checkReply('Open Menu > Payments. MYR 10 to MYR 30,000.', facts).ok).toBe(false);
  });
  it('rejects an empty or very long reply', () => {
    expect(checkReply('   ', facts).ok).toBe(false);
    expect(checkReply('x'.repeat(701), 'no numbers here').ok).toBe(false);
  });
});

/* ---------- Claude and ChatGPT through their official SDKs, on a fake network ---------- */
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const claudeReply = (text: string) => ({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } });
const gptReply = (text: string) => ({ id: 'c1', object: 'chat.completion', created: 1, model: 'm', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] });

function fakeNet(handler: (url: string, body: any) => Response) {                       // eslint-disable-line @typescript-eslint/no-explicit-any
  const calls: { url: string; body: any; headers: Record<string, string> }[] = [];     // eslint-disable-line @typescript-eslint/no-explicit-any
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = String(input), body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ url, body, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    return handler(url, body);
  }) as typeof fetch;
  return { fetchImpl, calls };
}
const pickInput: PickInput = { merchantName: 'LuckyPay', text: 'apa tu', lang: 'ms', entries: [
  { key: 'deposit_how', topic: 'deposit', aspect: 'how', examples: ['how to deposit', 'cara depo'] }, { key: 'withdraw_how', topic: 'withdraw', aspect: 'how', examples: ['how to withdraw'] }] };

describe('Claude and ChatGPT calls', () => {
  it('everything is off without keys', async () => {
    const ai = createAi({});
    expect([ai.canPick, ai.canWrite, ai.canDescribe, ai.canTranslate]).toEqual([false, false, false, false]);
    expect(await ai.translate({ merchantName: 'x', from: 'en', to: 'ms', answer: 'Hi', examples: [] })).toBeNull();
    expect(await ai.pickEntry(pickInput)).toBeNull();
    expect(await ai.writeReply({ merchantName: 'x', tone: 'friendly', lang: 'en', customerText: 'hi', facts: 'f' })).toBeNull();
    expect(createAi({ openaiKey: 'k' }).canWrite).toBe(false);                            // ChatGPT also needs a model name
  });

  it('Claude picks an entry: sends the entries and the message safely, and returns the pick', async () => {
    const net = fakeNet(() => json(claudeReply('{"intent_key":"deposit_how","confidence":0.91}')));
    const ai = createAi({ anthropicKey: 'sk-ant-test', fetch: net.fetchImpl });
    expect(await ai.pickEntry(pickInput)).toEqual({ intent: 'deposit_how', confidence: 0.91 });
    const c = net.calls[0];
    expect(c.url).toContain('/v1/messages');
    expect(c.headers.authorization).toBe('Bearer sk-ant-test');                         // the SDK sends the key; it is never put in a prompt
    expect(c.body.model).toBe('claude-haiku-5-5');
    expect(c.body.temperature).toBeUndefined();                                           // sampling settings are rejected by this model
    expect(c.body.output_config.format.type).toBe('json_schema');                         // the answer must be JSON in a fixed shape
    expect(c.body.system).toMatch(/untrusted/i);                                          // told not to obey the customer's text
    expect(JSON.stringify(c.body.messages)).toContain('<customer_message>apa tu</customer_message>');
    expect(JSON.stringify(c.body.messages)).toContain('deposit_how');
  });

  it('ignores a made-up key, no match, bad JSON, and a failing service', async () => {
    const answers = ['{"intent_key":"made_up","confidence":0.99}', '{"intent_key":null,"confidence":0.2}', 'not json at all'];
    for (const a of answers) {
      const ai = createAi({ anthropicKey: 'k', fetch: fakeNet(() => json(claudeReply(a))).fetchImpl });
      expect(await ai.pickEntry(pickInput)).toBeNull();
    }
    const bad = createAi({ anthropicKey: 'bad', fetch: fakeNet(() => json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401)).fetchImpl });
    expect(await bad.pickEntry(pickInput)).toBeNull();                                    // no throw: the bot just carries on
  });

  it('Claude describes a new keyword: a short note and a type from the allowed list', async () => {
    const net = fakeNet(() => json(claudeReply('{"note":"short for \\"dah\\" (already)","type":"slang"}')));
    const ai = createAi({ anthropicKey: 'k', fetch: net.fetchImpl });
    expect(await ai.describeWord({ word: 'dh', sample: 'dh 2 jam tak masuk', merchantName: 'LuckyPay', topics: ['deposit', 'withdraw'] })).toEqual({ note: 'short for "dah" (already)', type: 'slang' });
    expect(net.calls[0].body.system).toMatch(/untrusted/i);
    const wrong = createAi({ anthropicKey: 'k', fetch: fakeNet(() => json(claudeReply('{"note":"x","type":"unicorn"}'))).fetchImpl });
    expect(await wrong.describeWord({ word: 'x', sample: 'x', merchantName: 'm', topics: [] })).toBeNull();     // a type outside the list is refused
  });

  it('ChatGPT writes a reply using the model from the settings', async () => {
    const net = fakeNet(() => json(gptReply('Sure! Open Wallet > Deposit.')));
    const ai = createAi({ openaiKey: 'sk-test', openaiModel: 'my-model', fetch: net.fetchImpl });
    expect(ai.canWrite).toBe(true);
    expect(await ai.writeReply({ merchantName: 'LuckyPay', tone: 'friendly', lang: 'en', customerText: 'how to deposit', facts: 'Go to Wallet > Deposit.' })).toBe('Sure! Open Wallet > Deposit.');
    const c = net.calls[0];
    expect(c.url).toContain('/chat/completions'); expect(c.headers.authorization).toBe('Bearer sk-test'); expect(c.body.model).toBe('my-model');
    const all = JSON.stringify(c.body.messages);
    expect(all).toContain('FACTS:'); expect(all).toContain('Go to Wallet > Deposit.'); expect(all).toMatch(/untrusted/i);
  });

  it('stops calling the AI after the hourly limit', async () => {
    const net = fakeNet(() => json(claudeReply('{"intent_key":"deposit_how","confidence":0.9}')));
    const ai = createAi({ anthropicKey: 'k', fetch: net.fetchImpl, maxCallsPerHour: 2 });
    expect(await ai.pickEntry(pickInput)).not.toBeNull(); expect(await ai.pickEntry(pickInput)).not.toBeNull();
    expect(await ai.pickEntry(pickInput)).toBeNull();
    expect(net.calls.length).toBe(2);
  });
});

/* ---------- how the bot uses the AI ---------- */
function fakeAi(p: Partial<AiService> & { picks?: { intent: string; confidence: number } | null; written?: string | null }) {
  const log = { pick: 0, write: 0, writeFacts: [] as string[] };
  const ai: AiService = {
    canPick: p.canPick ?? true, canWrite: p.canWrite ?? true, canDescribe: false, canTranslate: false, translate: async () => null,
    pickEntry: async () => { log.pick++; return p.picks ?? null; },
    writeReply: async (i) => { log.write++; log.writeFacts.push(i.facts); return p.written ?? null; },
    describeWord: async () => null,
  };
  return { ai, log };
}
const botWith = (ai?: AiService) => new Bot(knowledgeFromSeed(seedJson, accountsJson), undefined, ai);

describe('the bot with the AI on', () => {
  it('Claude gets a second chance on a message no keyword matched', async () => {
    const { ai, log } = fakeAi({ picks: { intent: 'deposit_how', confidence: 0.9 }, canWrite: false });
    const t = (await botWith(ai).message(newSession('a1', 'MERCH_A', null), 'apa tu'))!;
    expect(log.pick).toBe(1);
    expect(t.trace.decision).toBe('ANSWER'); expect(t.trace.via).toBe('ai');
    expect((t.trace.ai as { picked: string }).picked).toBe('deposit_how');
    expect(t.messages[0].text).toContain('Wallet > Deposit');
    expect(t.log!.notUnderstood).toBe(true);                                              // still counted as a phrase the keywords missed
  });

  it('a low-confidence or missing pick changes nothing: the bot asks again as before', async () => {
    for (const picks of [{ intent: 'deposit_how', confidence: 0.5 }, { intent: 'not_an_entry', confidence: 0.99 }, null]) {
      const t = (await botWith(fakeAi({ picks }).ai).message(newSession('a2', 'MERCH_A', null), 'apa tu'))!;
      expect(t.trace.decision).toBe('REASK');
    }
  });

  it('Claude is not asked when the keywords already understood the message', async () => {
    const { ai, log } = fakeAi({ picks: { intent: 'withdraw_how', confidence: 0.99 } });
    const t = (await botWith(ai).message(newSession('a3', 'MERCH_A', null), 'depo how'))!;
    expect(log.pick).toBe(0); expect(t.trace.via).toBe('keywords');
  });

  it('ChatGPT\'s wording is used when it keeps the facts, and the standard wording when it does not', async () => {
    const good = fakeAi({ written: 'Sure! Open Wallet > Deposit, choose a payment method and follow the steps.' });
    const t1 = (await botWith(good.ai).message(newSession('b1', 'MERCH_A', null), 'depo how'))!;
    expect(t1.messages[0].text).toBe('Sure! Open Wallet > Deposit, choose a payment method and follow the steps.');
    expect((t1.trace.ai as { written: boolean }).written).toBe(true);

    const bad = fakeAi({ written: 'Open Wallet > Deposit. It takes 99 minutes.' });
    const t2 = (await botWith(bad.ai).message(newSession('b2', 'MERCH_A', null), 'depo how'))!;
    expect(t2.messages[0].text).toContain('Wallet > Deposit, choose a payment method');   // the standard reply
    expect(t2.messages[0].text).not.toContain('99');
    expect((t2.trace.ai as { written: boolean; rejected: string }).written).toBe(false);
    expect((t2.trace.ai as { rejected: string }).rejected).toMatch(/99/);

    const down = fakeAi({ written: null });
    expect((await botWith(down.ai).message(newSession('b3', 'MERCH_A', null), 'depo how'))!.messages[0].text).toMatch(/^Hi!/);
  });

  it('ChatGPT only ever sees the knowledge base answer, never account data', async () => {
    const { ai, log } = fakeAi({ written: 'x' });
    const tom = (await import('../src/bot/token')).makeToken({ customer_id: 8841, name: 'Tom' });
    await botWith(ai).message(newSession('c1', 'MERCH_A', tom), 'my balance');             // an account answer
    expect(log.write).toBe(0);
    await botWith(ai).message(newSession('c2', 'MERCH_A', tom), 'my deposit still pending');
    expect(log.write).toBe(0);
    await botWith(ai).message(newSession('c3', 'MERCH_A', null), 'any promo for new member?');
    expect(log.writeFacts.every((f) => !/MYR 1,250|D-20931|Tom/.test(f))).toBe(true);
  });

  it('with no AI the bot behaves as before', async () => {
    const t = (await botWith(undefined).message(newSession('d1', 'MERCH_A', null), 'apa tu'))!;
    expect(t.trace.decision).toBe('REASK'); expect(t.trace.ai).toBeUndefined();
  });
});

/* ---------- through the real server and database ---------- */
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed, DEMO_ADMIN } from '../src/db/seed';
import { buildApp } from '../src/server/app';

const dbUrl = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null;
let reachable = false;
if (dbUrl) { pool = createPool(dbUrl, 4); try { await pool.query('select 1'); reachable = true; } catch { /* skipped below */ } }

describe.skipIf(!reachable)('AI through the server (needs TEST_DATABASE_URL)', () => {
  const described: string[] = [];
  const ai: AiService = {
    canPick: true, canWrite: false, canDescribe: true, canTranslate: true,
    translate: async (i) => (i.answer.includes('Wallet') ? { answer: i.to === 'zh' ? '请到 Wallet > Deposit，选择付款方式，按步骤操作。最低 MYR 10。' : 'Pergi ke Wallet > Deposit, pilih kaedah bayaran. Minimum MYR 10.', examples: i.examples.map((x) => `[${i.to}] ${x}`) } : { answer: 'Minimum MYR 99', examples: [] }),
    pickEntry: async (i) => (i.text === 'apa tu' ? { intent: 'deposit_how', confidence: 0.9 } : null),
    writeReply: async () => null,
    describeWord: async (i) => { described.push(i.word); return { note: `note for ${i.word}`, type: 'slang' }; },
  };
  const off: AiService = { canPick: false, canWrite: false, canDescribe: false, canTranslate: false, translate: async () => null, pickEntry: async () => null, writeReply: async () => null, describeWord: async () => null };
  let app: Awaited<ReturnType<typeof buildApp>>, appOff: Awaited<ReturnType<typeof buildApp>>, cookie = '', cookieOff = '';

  const signIn = async (a: typeof app) => {
    const r = await a.inject({ method: 'POST', url: '/api/auth/login', payload: DEMO_ADMIN });
    return String(r.headers['set-cookie']).split(';')[0];
  };
  const post = (a: typeof app, c: string, url: string, payload: object) => a.inject({ method: 'POST', url, payload, headers: { cookie: c } });
  const get = (a: typeof app, c: string, url: string) => a.inject({ method: 'GET', url, headers: { cookie: c } });

  it('sets everything up', async () => {
    await migrate(pool!, { reset: true }); await seed(pool!);
    app = await buildApp({ pool: pool!, logger: false, ai }); appOff = await buildApp({ pool: pool!, logger: false, ai: off });
    cookie = await signIn(app); cookieOff = await signIn(appOff);
    expect(((await get(app, cookie, '/api/admin/state')).json()).ai).toEqual({ pick: true, write: false, describe: true, translate: true });
    expect(((await get(appOff, cookieOff, '/api/admin/state')).json()).ai).toEqual({ pick: false, write: false, describe: false, translate: false });
  });

  it('Claude rescues a message through the chat endpoint', async () => {
    const s = (await post(app, cookie, '/api/chat/start', { merchant: 'MERCH_A' })).json();
    const r = (await post(app, cookie, '/api/chat/message', { sessionId: s.sessionId, text: 'apa tu' })).json();
    expect(r.turn.trace.decision).toBe('ANSWER'); expect(r.turn.trace.via).toBe('ai');
    expect(r.turn.messages[0].text).toContain('Wallet > Deposit');
    const s2 = (await post(appOff, cookieOff, '/api/chat/start', { merchant: 'MERCH_A' })).json();
    expect((await post(appOff, cookieOff, '/api/chat/message', { sessionId: s2.sessionId, text: 'apa tu' })).json().turn.trace.decision).toBe('REASK');
  });

  it('describes new keywords in the background and saves the note and type', async () => {
    const s = (await post(app, cookie, '/api/chat/start', { merchant: 'MERCH_A' })).json();
    await post(app, cookie, '/api/chat/message', { sessionId: s.sessionId, text: 'zzqq blorp' });
    for (let i = 0; i < 20 && !described.includes('blorp'); i++) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 100));
    const rows = (await get(app, cookie, '/api/admin/keywords?merchant=MERCH_A')).json();
    const w = rows.find((k: { w: string }) => k.w === 'zzqq');
    expect(w.h).toBe('note for zzqq'); expect(w.guess).toBe('slang');
    expect(rows.find((k: { w: string }) => k.w === 'lh').h).toBe('"lah", a particle');       // a note someone wrote is never replaced
  });

  it('translates an answer for the entry editor, refuses a changed number, and says so when AI is off', async () => {
    const ok = await post(app, cookie, '/api/admin/translate', { merchant: 'MERCH_A', from: 'en', to: 'ms', answer: 'Go to Wallet > Deposit. Minimum MYR 10.', examples: ['depo how'] });
    expect(ok.statusCode).toBe(200); expect(ok.json()).toEqual({ answer: 'Pergi ke Wallet > Deposit, pilih kaedah bayaran. Minimum MYR 10.', examples: ['[ms] depo how'] });
    expect((await post(app, cookie, '/api/admin/translate', { merchant: 'MERCH_A', to: 'zh', answer: 'Go to Wallet > Deposit. Minimum MYR 10.' })).json().answer).toContain('MYR 10');
    const bad = await post(app, cookie, '/api/admin/translate', { merchant: 'MERCH_A', to: 'ms', answer: 'Please wait 5 minutes.' });     // the fake returns "MYR 99", a number that is not in the original
    expect(bad.statusCode).toBe(422); expect(bad.json().error).toContain('refused');
    expect((await post(app, cookie, '/api/admin/translate', { merchant: 'MERCH_A', to: 'ms', answer: '  ' })).statusCode).toBe(400);
    expect((await post(app, cookie, '/api/admin/translate', { merchant: 'MERCH_A', to: 'en', answer: 'x' })).statusCode).toBe(400);
    expect((await post(appOff, cookieOff, '/api/admin/translate', { merchant: 'MERCH_A', to: 'ms', answer: 'Go to Wallet.' })).statusCode).toBe(409);
  });

  it('the "Describe new words" button fills the words that have no note, and says so when AI is off', async () => {
    await pool!.query(`UPDATE ${tbl(dbNameFor('livechat_bot_test', 'MERCH_A'), 'keyword_store')} SET note = NULL WHERE word IN ('dh','nk')`);
    const r = await post(app, cookie, '/api/admin/keywords/describe', { merchant: 'MERCH_A' });
    expect(r.statusCode).toBe(200); expect(r.json().done).toBeGreaterThanOrEqual(2);
    const rows = (await get(app, cookie, '/api/admin/keywords?merchant=MERCH_A')).json();
    expect(rows.find((k: { w: string }) => k.w === 'dh').h).toBe('note for dh');
    expect((await post(appOff, cookieOff, '/api/admin/keywords/describe', { merchant: 'MERCH_A' })).statusCode).toBe(409);
  });

  it('staff can only describe their own merchant\'s words', async () => {
    const staff = String((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'luckypay', password: 'demo123' } })).headers['set-cookie']).split(';')[0];
    expect((await post(app, staff, '/api/admin/keywords/describe', { merchant: 'MERCH_B' })).statusCode).toBe(403);
    expect((await post(app, staff, '/api/admin/keywords/describe', { merchant: 'MERCH_A' })).statusCode).toBe(200);
    await app.close(); await appOff.close(); await pool?.end();
  });
});

/* ---------- translating an answer ---------- */
describe('translation checker', () => {
  const en = 'To deposit, go to Wallet > Deposit and choose a payment method. The minimum is MYR 10 and it takes 5 minutes. See https://pay.example.com/help.';
  it('accepts a faithful translation', () => {
    expect(checkTranslation('Untuk deposit, pergi ke Wallet > Deposit dan pilih kaedah bayaran. Minimum ialah MYR 10 dan ambil masa 5 minit. Lihat https://pay.example.com/help.', en).ok).toBe(true);
    expect(checkTranslation('充值请到 Wallet > Deposit 选择付款方式。最低 MYR 10，需要 5 分钟。详见 https://pay.example.com/help。', en).ok).toBe(true);
  });
  it('refuses a changed or missing number, an added link, a changed menu path or an empty text', () => {
    expect(checkTranslation('Minimum MYR 100, 5 minit, Wallet > Deposit https://pay.example.com/help', en)).toMatchObject({ ok: false, reason: expect.stringContaining('100') });
    expect(checkTranslation('Minimum MYR 10, Wallet > Deposit https://pay.example.com/help', en)).toMatchObject({ ok: false, reason: expect.stringContaining('left out the number 5') });
    expect(checkTranslation('MYR 10, 5 minit, Wallet > Deposit https://pay.example.com/help https://evil.test/x', en).ok).toBe(false);
    expect(checkTranslation('MYR 10, 5 minit, Dompet > Deposit https://pay.example.com/help', en)).toMatchObject({ ok: false, reason: expect.stringContaining('menu path') });
    expect(checkTranslation('   ', en).ok).toBe(false);
  });
});

describe('Claude translation on a fake network', () => {
  const input: TranslateInput = { merchantName: 'LuckyPay', from: 'en', to: 'ms', answer: 'Go to Wallet > Deposit. The minimum is MYR 10.', examples: ['depo how', 'how to deposit'] };
  it('returns the translated answer and examples, and sends the original text as data', async () => {
    const net = fakeNet(() => json(claudeReply('{"answer":"Pergi ke Wallet > Deposit. Minimum ialah MYR 10.","examples":["depo macam mana","cara deposit"]}')));
    const ai = createAi({ anthropicKey: 'k', fetch: net.fetchImpl });
    expect(ai.canTranslate).toBe(true);
    expect(await ai.translate(input)).toEqual({ answer: 'Pergi ke Wallet > Deposit. Minimum ialah MYR 10.', examples: ['depo macam mana', 'cara deposit'] });
    const sent = JSON.stringify(net.calls[0].body);
    expect(sent).toContain('<answer>Go to Wallet > Deposit.'); expect(sent).toContain('Bahasa Melayu');
  });
  it('gives null for an empty answer or a failing service', async () => {
    expect(await createAi({ anthropicKey: 'k', fetch: fakeNet(() => json(claudeReply('{"answer":"  ","examples":[]}'))).fetchImpl }).translate(input)).toBeNull();
    expect(await createAi({ anthropicKey: 'bad', fetch: fakeNet(() => json({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 401)).fetchImpl }).translate(input)).toBeNull();
  });
});
