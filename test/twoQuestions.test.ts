import { describe, it, expect } from 'vitest';
import { Bot, newSession } from '../src/bot/responder';
import { knowledgeFromSeed } from '../src/engine';
import type { KbEntry } from '../src/engine/types';
import { seedJson, accountsJson } from './helpers';

const bot = () => new Bot(knowledgeFromSeed(seedJson, accountsJson));
const say = async (b: Bot, text: string) => { const t = (await b.message(newSession('t' + Math.random(), 'MERCH_A', null), text))!; return { d: String(t.trace.decision), compound: (t.trace.compound as string[] | undefined) ?? null, text: t.messages.map((m) => m.text).join(' '), cacheable: !!t.cacheable }; };

/** A merchant whose imported entries have a topic but no question type: every deposit word matches all of them. */
const withImported = () => {
  const k = knowledgeFromSeed(seedJson, accountsJson);
  const e = (id: number, key: string, topic: string, ex: string[], a: string): KbEntry => ({ id, merchant: 'MERCH_A', category: 'x', intentKey: key, topic, aspect: null, topicOptional: false, entryType: 'answer', translations: { en: { questionExamples: ex, answerText: a } } });
  k.kbEntries.push(e(9301, 'deposit_not_credited', 'deposit', ['deposit not received', 'my topup not in'], 'Send the full receipt.'), e(9302, 'deposit_tng', 'deposit', ['deposit with tng'], 'Use TnG.'),
    e(9303, 'claim_receipt_once', 'deposit', ['receipt already used'], 'One claim per receipt.'), e(9304, 'withdraw_processing', 'withdraw', ['withdraw not in yet'], 'Wait 5 minutes.'), e(9305, 'withdraw_own_bank', 'withdraw', ['withdraw to friend bank'], 'Own bank only.'));
  return new Bot(k);
};

describe('a message that asks two different things gets both answers, word for word', () => {
  it('answers a deposit question and a withdraw question one after the other', async () => {
    const r = await say(bot(), 'how long does deposit take and what is the withdraw limit');
    expect(r.d).toBe('ANSWER'); expect(r.compound).toEqual(['deposit_time', 'withdraw_limit']);
    expect(r.text).toMatch(/credited within 5 minutes/); expect(r.text).toMatch(/minimum withdrawal is MYR 20/); expect(r.cacheable).toBe(false);   // not kept by LiveChat by its words
    expect(r.text.indexOf('credited within 5 minutes')).toBeLessThan(r.text.indexOf('minimum withdrawal'));                // in the order they were asked
  });
  it('works with a comma, in Malay, and in Chinese', async () => {
    expect((await say(bot(), 'how to deposit, how to withdraw')).compound).toEqual(['deposit_how', 'withdraw_how']);
    expect((await say(bot(), 'berapa lama deposit masuk dan cara nak withdraw')).compound).toEqual(['deposit_time', 'withdraw_how']);
    expect((await say(bot(), '充值要多久和提款限额')).compound).toEqual(['deposit_time', 'withdraw_limit']);
  });
  it('also when the whole message first looked like one answer: "minimum deposit and forgot password"', async () => {
    expect((await say(bot(), 'minimum deposit and forgot password')).compound).toEqual(['deposit_limit', 'forgot_password']);
  });
  it('does nothing when a part is unclear, or when both parts mean the same answer', async () => {
    const b = bot();
    expect((await say(b, 'deposit and withdraw')).compound).toBeNull();                                  // each part is only a topic: it still asks which one
    expect((await say(b, 'how to deposit and how to deposit')).compound).toBeNull();                     // the same answer twice is one answer
    expect((await say(b, 'how to deposit')).compound).toBeNull();                                        // a single question is as before
    expect((await say(b, 'how to deposit and blah blah')).compound).toBeNull();
  });
  it('also straight after the bot asked a question: the repeated message is not glued to the earlier one, both answers come at once', async () => {
    const b = bot(); const s = newSession('t-after', 'MERCH_A', null);
    const first = (await b.message(s, 'deposit and withdraw'))!; expect(String(first.trace.decision)).toBe('CHOICE');                  // the bot asks which one
    const second = (await b.message(s, 'how long does deposit take and what is the withdraw limit'))!;
    expect(second.trace.compound).toEqual(['deposit_time', 'withdraw_limit']);
    const s2 = newSession('t-twice2', 'MERCH_A', null); await b.message(s2, 'how long does deposit take and what is the withdraw limit');
    expect((await b.message(s2, 'how long does deposit take and what is the withdraw limit'))!.trace.compound).toEqual(['deposit_time', 'withdraw_limit']);   // asking it twice gives the same
  });
  it('still works when the merchant has imported entries with no question type (they must not hide the one the question type points to)', async () => {
    const b = withImported();
    for (const q of ['how long does deposit take and what is the withdraw limit', 'deposit time and withdraw limit', '充值要多久和提款限额']) {
      const r = await say(b, q); expect(r.compound, q).toEqual(['deposit_time', 'withdraw_limit']);
    }
    expect((await say(b, 'deposit and withdraw')).compound).toBeNull();                                  // topics only: still asks
  });
  it('never mixes in a person or a rude message: those keep their own rules', async () => {
    const b = bot();
    const a = await say(b, 'deposit time and talk to agent'); expect(a.d).toBe('HANDOFF'); expect(a.compound).toBeNull();
    const c = await say(b, 'deposit time and you are stupid'); expect(c.d).toBe('ABUSE'); expect(c.compound).toBeNull();
  });
});

describe('the name of an entry is a direct answer', () => {
  it('"deposit time" answers the entry deposit_time even when other deposit entries are close', async () => {
    const b = withImported();
    const r = await say(b, 'deposit time'); expect(r.d).toBe('ANSWER'); 
    expect(r.text).toMatch(/credited within 5 minutes/);
  });
});
