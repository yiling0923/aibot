import { describe, it, expect } from 'vitest';
import { Bot, newSession } from '../src/bot/responder';
import { knowledgeFromSeed } from '../src/engine';
import { seedJson, accountsJson } from './helpers';

const bot = () => new Bot(knowledgeFromSeed(seedJson, accountsJson));
const say = async (b: Bot, text: string) => { const t = (await b.message(newSession('t' + Math.random(), 'MERCH_A', null), text))!; return { d: String(t.trace.decision), compound: (t.trace.compound as string[] | undefined) ?? null, text: t.messages.map((m) => m.text).join(' '), cacheable: !!t.cacheable }; };

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
  it('never mixes in a person or a rude message: those keep their own rules', async () => {
    const b = bot();
    const a = await say(b, 'deposit time and talk to agent'); expect(a.d).toBe('HANDOFF'); expect(a.compound).toBeNull();
    const c = await say(b, 'deposit time and you are stupid'); expect(c.d).toBe('ABUSE'); expect(c.compound).toBeNull();
  });
});
