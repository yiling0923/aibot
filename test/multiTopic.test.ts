import { describe, it, expect } from 'vitest';
import { Bot, newSession } from '../src/bot/responder';
import { knowledgeFromSeed } from '../src/engine';
import type { KbEntry } from '../src/engine/types';
import { seedJson, accountsJson } from './helpers';

const entry = (id: number, key: string, topic: string, ex: string[], answer: string): KbEntry =>
  ({ id, merchant: 'MERCH_A', category: 'x', intentKey: key, topic, aspect: null, topicOptional: false, entryType: 'answer', translations: { en: { questionExamples: ex, answerText: answer } } });

/** A merchant with its own "bonus" topic and its own "referral" topic: "referral bonus" names both. */
function make() {
  const k = knowledgeFromSeed(seedJson, accountsJson); const cfg = k.merchants.find((m) => m.code === 'MERCH_A')!;
  for (const w of ['bonus', 'bonuses']) cfg.aliases.push({ language: 'en', variant: w, canonical: 'bonus' });
  for (const w of ['referral', 'rujukan']) cfg.aliases.push({ language: 'en', variant: w, canonical: 'referral' });
  k.kbEntries.push(
    entry(9201, 'bonus_how_to_claim', 'bonus', ['how to claim a bonus', 'how to claim promotion', 'how do i get the bonus'], 'Choose the bonus on the Promotion page.'),
    entry(9202, 'welcome_bonus_new_member', 'bonus', ['what is the welcome bonus', 'new member promotion'], 'RM30 gets RM60.'),
    entry(9203, 'daily_promotion', 'bonus', ['daily bonus', 'daily promotion'], 'Daily promotion 40%.'),
    entry(9204, 'referral_bonus', 'referral', ['how to claim the referral bonus', 'referral bonus', 'refer a friend'], 'REFERRAL BONUS RM6 - RM30'),
    entry(9205, 'share_daily', 'referral', ['share to friends and get money'], 'Share reward.'));
  return new Bot(k);
}
const say = async (bot: Bot, text: string) => { const t = (await bot.message(newSession('m' + Math.random(), 'MERCH_A', null), text))!; return { d: String(t.trace.decision), topic: t.trace.topic as string | null, keys: (t.buttons ?? []).map((b) => b.key), text: t.messages.map((m) => m.text).join(' ') }; };

describe('a sentence that names two topics ("referral bonus") goes to the entry that fits the whole message', () => {
  it('answers the referral entry, not a choice between the bonus entries', async () => {
    const bot = make();
    for (const q of ['i want referral bonus', 'how to claim referral bonus', 'referral bonus please']) {
      const r = await say(bot, q); expect(r.d, q).toBe('ANSWER'); expect(r.text, q).toMatch(/REFERRAL BONUS RM6/);
    }
  });
  it('a single topic word still asks which one: "bonus" and "referral" alone', async () => {
    const bot = make();
    const b = await say(bot, 'bonus'); expect(b.d).toBe('CHOICE'); expect(b.keys).toContain('bonus_how_to_claim'); expect(b.keys).not.toContain('referral_bonus');
    const r = await say(bot, 'referral'); expect(r.d).toBe('CHOICE'); expect(r.keys).toEqual(expect.arrayContaining(['referral_bonus', 'share_daily']));
  });
  it('when no entry is clearly the closest, the choices put the closest first, so the one meant is never cut off', async () => {
    const bot = make();
    const r = await say(bot, 'referral and daily bonus');
    expect(r.d).toBe('CHOICE'); expect(r.keys.slice(0, 2).sort()).toEqual(['daily_promotion', 'referral_bonus']);
  });
});
