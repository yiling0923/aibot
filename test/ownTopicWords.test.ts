import { describe, it, expect } from 'vitest';
import { Bot, newSession } from '../src/bot/responder';
import { knowledgeFromSeed } from '../src/engine';
import type { KbEntry } from '../src/engine/types';
import { seedJson, accountsJson } from './helpers';

const entry = (id: number, key: string, topic: string, type: 'answer' | 'needs_staff', examples: string[], answer: string): KbEntry =>
  ({ id, merchant: 'MERCH_A', category: 'x', intentKey: key, topic, aspect: null, topicOptional: false, entryType: type, translations: { en: { questionExamples: examples, answerText: answer } } });

function make(withOwnTopic: boolean) {
  const k = knowledgeFromSeed(seedJson, accountsJson);
  if (withOwnTopic) {
    const cfg = k.merchants.find((m) => m.code === 'MERCH_A')!;
    for (const w of ['free credit', 'freecredit']) cfg.aliases.push({ language: 'en', variant: w, canonical: 'free_credit' });
    k.kbEntries.push(
      entry(9101, 'free_credit_info', 'free_credit', 'answer', ['is there free credit', 'how to claim free credit', 'do new users get free credit'], 'New members get RM10 free credit after verifying the phone.'),
      entry(9102, 'free_credit_request', 'free_credit', 'needs_staff', ['boss give me free credit', 'please give free credit to play'], ''));
  }
  return new Bot(k);
}
const say = async (bot: Bot, text: string, merchant = 'MERCH_A') => { const t = (await bot.message(newSession('o' + Math.random(), merchant, null), text))!; return { d: String(t.trace.decision), topic: t.trace.topic as string | null, text: t.messages.filter((m) => m.kind === 'bot').map((m) => m.text).join(' '), buttons: (t.buttons ?? []).map((b) => b.key) }; };

describe("a merchant's own word for its own topic beats the shared word", () => {
  it('without its own topic, "free credit" means the shared promotion topic', async () => {
    expect((await say(make(false), 'free credit')).topic).toBe('promotion');
  });
  it('with its own free_credit topic, "free credit" means that topic for this merchant', async () => {
    const r = await say(make(true), 'is there free credit');
    expect(r.d).toBe('ANSWER'); expect(r.topic).toBe('free_credit'); expect(r.text).toMatch(/RM10 free credit/);
  });
  it('other merchants keep the shared meaning of the word', async () => {
    const bot = make(true);
    expect((await say(bot, 'free credit', 'MERCH_B')).topic).toBe('promotion');
  });
});

describe('a question that is the same words as one example is answered, not turned into a menu', () => {
  const bot = make(true);
  it('answers a question that is the same words as an example of one entry', async () => {
    for (const q of ['is there free credit', 'how to claim free credit', 'do new users get free credit']) { const r = await say(bot, q); expect(r.d, q).toBe('ANSWER'); expect(r.text, q).toMatch(/RM10 free credit/); }
  });
  it('hands over when the matching example belongs to an entry a person answers', async () => {
    expect((await say(bot, 'boss give me free credit')).d).toBe('HANDOFF');
  });
  it('still asks which one when only the topic word is typed, and offers both entries', async () => {
    const r = await say(bot, 'free credit'); expect(r.d).toBe('CHOICE'); expect(r.buttons).toEqual(expect.arrayContaining(['free_credit_info', 'free_credit_request']));
  });
});
