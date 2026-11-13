import { describe, it, expect } from 'vitest';
import { Engine } from '../src/engine/engine';
import { knowledgeFromSeed } from '../src/engine';
import { Bot, newSession, type Session } from '../src/bot/responder';
import { matchChoice } from '../src/bot/choices';
import type { AiService, PickInput } from '../src/ai/types';
import { seedJson, accountsJson } from './helpers';

const k = knowledgeFromSeed(seedJson, accountsJson);
const eng = new Engine(k);
const bot = new Bot(k);
const text = (t: Awaited<ReturnType<Bot['message']>>) => t!.messages.map((m) => m.text).join('\n');
const chat = (id = 'f') => newSession(id, 'MERCH_A', null);

describe('the flow of the plan: keywords, then the topic, then the answer', () => {
  it('reports the words the customer typed, the topic scores, and the answer', () => {
    const r = eng.analyze('depo how long boss', 'MERCH_A');
    expect(r.keywords.map((x) => `${x.word}>${x.to}`)).toEqual(['depo>deposit', 'how long>time']);          // step 1: the words, as typed
    expect(r.keywords.map((x) => x.kind)).toEqual(['topic', 'question']);
    expect(r.topicScores[0]).toEqual({ topic: 'deposit', score: 1 });                                       // step 2: the topic
    expect(r.decision).toBe('ANSWER'); expect(r.answerId).toBe(r.top.id); expect(r.top.intent).toBe('deposit_time');   // step 3: the answer
    expect(eng.analyze('blah', 'MERCH_A').keywords).toEqual([]);
    expect(eng.analyze('blah', 'MERCH_A').answerId).toBeNull();
  });
  it('knows the keywords in every language and without accents', () => {
    expect(eng.analyze('充值要多久', 'MERCH_A').keywords.map((x) => `${x.word}>${x.to}`)).toEqual(['充值>deposit', '多久>time']);
    expect(eng.analyze('nạp tiền chưa vào', 'MERCH_A').keywords.map((x) => x.to)).toEqual(['deposit', 'time']);
    expect(eng.analyze('ฝากเงินกี่นาทีเข้า', 'MERCH_A').keywords.map((x) => x.to)).toEqual(['deposit', 'time']);
  });
  it('a topic word is clear on its own, a question word alone is not', () => {
    expect(eng.analyze('withdraw 30 min', 'MERCH_A').decision).toBe('ANSWER');
    expect(eng.analyze('deposit', 'MERCH_A').decision).toBe('CHOICE');
    expect(eng.analyze('how long', 'MERCH_A').decision).toBe('CLARIFY');
  });
});

describe('"my money not in": the example of the plan', () => {
  it('has money words and a question about time, but no topic, so two topics score the same', () => {
    const r = eng.analyze('my money not in', 'MERCH_A');
    expect(r.keywords.map((x) => `${x.word}>${x.to}`)).toEqual(['not in>time', 'money>money']);
    expect(r.decision).toBe('CLARIFY'); expect(r.options.map((o) => `${o.kind}:${o.key}`)).toEqual(['topic:deposit', 'topic:withdraw']);
    expect(r.topicScores.map((t) => t.topic)).toEqual(expect.arrayContaining(['deposit', 'withdraw']));
  });
  it('asks ONE question with the two topics, and the answer to it gives the answer at once (no second question)', async () => {
    for (const reply of ['deposit', 'depo', '1', 'the first one', 'Deposits']) {
      const s = chat('m-' + reply);
      const ask = (await bot.message(s, 'my money not in'))!;
      expect(ask.trace.decision).toBe('CLARIFY'); expect(ask.buttons!.filter((b) => b.kind !== 'agent').map((b) => b.key)).toEqual(['deposit', 'withdraw']);
      expect(text(ask)).toMatch(/deposits or withdrawals/);
      const answer = (await bot.message(s, reply))!;
      expect(text(answer), `reply "${reply}"`).toContain('credited within 5 minutes');                        // "not in" = time, so the deposit time is answered, not a menu
      expect(answer.buttons).toBeNull(); expect(s.handed).toBe(false);
    }
    const w = chat('m-w'); await bot.message(w, 'my money not in');
    expect(text((await bot.message(w, 'withdrawal'))!)).toContain('processed within 30 minutes');
  });
  it('works in Malay, Chinese, Vietnamese, Thai and Filipino too', () => {
    for (const t of ['duit tak masuk', '钱还没到', 'tiền chưa vào', 'เงินยังไม่เข้า', 'hindi pa pumapasok ang pera']) {
      const r = eng.analyze(t, 'MERCH_A'); expect(r.decision, t).toBe('CLARIFY'); expect(r.options.map((o) => o.key), t).toEqual(['deposit', 'withdraw']);
    }
  });
});

describe('the clarify rule: one question with up to 3 choices, the reply in the customer\'s own words, then a person', () => {
  it('reads "deposit", "depo", "2" and "the second one" as answers to the choices', async () => {
    const pick = async (reply: string) => { const s = chat('p-' + reply); await bot.message(s, 'deposit'); return text((await bot.message(s, reply))!); };
    expect(await pick('2')).toContain('credited within 5 minutes');                                           // deposit time
    expect(await pick('the second one')).toContain('credited within 5 minutes');
    expect(await pick('deposit time')).toContain('credited within 5 minutes');
    expect(await pick('limits')).toContain('minimum deposit is MYR 10');
  });
  it('reads a short typed reply together with the earlier message', async () => {
    const s = chat('glue'); await bot.message(s, 'deposit');
    expect(text((await bot.message(s, 'how long'))!)).toContain('credited within 5 minutes');
  });
  it('never asks twice: a second unclear message goes to a person', async () => {
    const a = chat('a1'); expect((await bot.message(a, 'blah blah'))!.trace.decision).toBe('REASK');
    expect((await bot.message(a, 'asdf qwer'))!.trace.decision).toBe('HANDOFF'); expect(a.handed).toBe(true);
    const b = chat('a2'); expect((await bot.message(b, 'my money not in'))!.trace.decision).toBe('CLARIFY');
    expect((await bot.message(b, 'zzz yyy'))!.trace.decision).toBe('HANDOFF'); expect(b.handed).toBe(true);   // the reply did not answer the question
    const c = chat('a3'); await bot.message(c, 'deposit');                                                    // a menu, and the customer ignores it twice
    expect((await bot.message(c, 'deposit'))!.trace.decision).toBe('HANDOFF'); expect(c.handed).toBe(true);
  });
  it('lets a customer who was understood ask something new without being counted against', async () => {
    const s = chat('fresh'); await bot.message(s, 'blah blah');               // asked once
    await bot.message(s, 'deposit'); await bot.message(s, '2');               // understood and answered
    expect((await bot.message(s, 'xyz abc'))!.trace.decision).toBe('REASK'); expect(s.handed).toBe(false);      // a fresh question gets its one question again
  });
  it('shows at most 3 choices, and the agent', async () => {
    const t = (await bot.message(chat('three'), 'my money not in'))!;
    expect(t.buttons!.filter((b) => b.kind !== 'agent').length).toBeLessThanOrEqual(3); expect(t.buttons!.at(-1)!.kind).toBe('agent');
  });
  it('matches the reply by number, ordinal and words, in every language', () => {
    const choices = [{ kind: 'topic', key: 'deposit', label: 'Nạp tiền' }, { kind: 'topic', key: 'withdraw', label: 'Rút tiền' }, { kind: 'agent', key: 'agent', label: 'Gặp nhân viên hỗ trợ' }] as never[];
    expect(matchChoice('1', choices)?.key).toBe('deposit'); expect(matchChoice('nap tien', choices)?.key).toBe('deposit'); expect(matchChoice('rút', choices)?.key).toBe('withdraw');
    expect(matchChoice('hai', choices)?.key).toBe('withdraw'); expect(matchChoice('ข้อ 2', choices)?.key).toBe('withdraw'); expect(matchChoice('pangalawa', choices)?.key).toBe('withdraw');
    expect(matchChoice('where is my money', choices)).toBeNull();
  });
});

describe('the AI picks from a short list, or says none', () => {
  const stub = (answer: ((i: PickInput) => { intent: string; confidence: number } | null) = () => null) => {
    const seen: PickInput[] = [];
    const ai: AiService = { canPick: true, canWrite: false, canDescribe: false, canTranslate: false, pickEntry: async (i) => { seen.push(i); return answer(i); }, writeReply: async () => null, describeWord: async () => null, translate: async () => null };
    return { seen, bot: new Bot(k, undefined, ai) };
  };
  it('gets only the closest entries, never the whole knowledge base, with the keywords and topics found', async () => {
    const { seen, bot: b } = stub();
    await b.message(chat('ai1'), 'please help with my account details');                                    // one entry looks a little like it
    expect(seen).toHaveLength(1); expect(seen[0].entries.length).toBeLessThan(eng.entriesOf('MERCH_A').length); expect(seen[0].entries.length).toBeLessThanOrEqual(8);
    expect(seen[0].entries.every((e) => eng.entry('MERCH_A', e.key))).toBe(true);
    await b.message(chat('ai1b'), 'blorp quux');                                                             // nothing looks like it: a small knowledge base is offered whole, never more than 12
    expect(seen[1].entries.length).toBeLessThanOrEqual(12);
  });
  it('says none: the bot then asks once (it does not guess)', async () => {
    const { bot: b } = stub(() => null);
    expect((await b.message(chat('ai2'), 'xyz abc'))!.trace.decision).toBe('REASK');
  });
  it('an answer picked from the list is used, and is not marked cacheable', async () => {
    const { bot: b } = stub((i) => ({ intent: i.entries[0].key, confidence: 0.9 }));
    const t = (await b.message(chat('ai3'), 'xyz abc'))!;
    expect(t.trace.decision).toBe('ANSWER'); expect((t.trace.ai as { picked: string }).picked).toBeTruthy(); expect(t.cacheable).toBe(false);
  });
  it('is not asked when the rules are sure', async () => {
    const { seen, bot: b } = stub();
    await b.message(chat('ai4'), 'depo how long'); expect(seen).toHaveLength(0);
  });
});

describe('a channel that remembers replies by the words of the question (LiveChat)', () => {
  const live = (id: string): Session => ({ ...newSession(id, 'MERCH_A', null), noPersonal: true, member: { id: '8841', name: 'Tom' } });
  it('writes no personal account data, even for a signed-in member: it goes to staff', async () => {
    for (const q of ['my balance', 'transaction history', 'my points']) {
      const s = live('l-' + q); const t = (await bot.message(s, q))!;
      expect(t.trace.decision, q).toBe('HANDOFF'); expect(text(t)).not.toMatch(/1,250|Tom|points/); expect(s.handed).toBe(true);
    }
  });
  it('still gives the general answer to a question about a deposit that has not come (no lookup of the account)', async () => {
    const t = (await bot.message(live('l-dep'), 'my deposit has not arrived yet'))!;
    expect(t.trace.decision).toBe('ANSWER'); expect(text(t)).toContain('credited within 5 minutes'); expect(text(t)).not.toContain('Tom');
    expect(t.cacheable).toBe(true);
  });
  it('offers no account check among the choices', async () => {
    const t = (await bot.message(live('l-menu'), 'deposit'))!;
    expect(t.buttons!.some((b) => b.kind === 'status' || (b.kind === 'amt' && b.key === 'check'))).toBe(false);
  });
  it('marks only a plain answer as cacheable', async () => {
    expect((await bot.message(chat('c1'), 'depo how long'))!.cacheable).toBe(true);
    expect((await bot.message(chat('c2'), 'deposit'))!.cacheable).toBeFalsy();                                // a menu
    const s = chat('c3'); await bot.message(s, 'deposit'); expect((await bot.message(s, '2'))!.cacheable).toBe(false);     // depends on the menu before it
    const g = chat('c4'); await bot.message(g, 'deposit'); expect((await bot.message(g, 'how long'))!.cacheable).toBe(false);   // read together with the earlier message
  });
});
