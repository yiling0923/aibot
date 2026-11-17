import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createPool, type Pool } from '../src/db/pool';
import { migrate } from '../src/db/migrate';
import { seed } from '../src/db/seed';
import { readSnapshot, writeSnapshot, knowledgeFromSnapshot, readMerchants } from '../src/admin/snapshot';
import { loadKnowledge } from '../src/db/loadKnowledge';
import { Bot, newSession } from '../src/bot/responder';
import { isPlaceholder, withoutPlaceholders } from '../src/engine/placeholders';
import type { KbEntry } from '../src/engine/types';

const entry = (o: Partial<KbEntry>): KbEntry => ({ id: 1, merchant: 'M', category: 'x', intentKey: 'k', topic: 't', aspect: null, topicOptional: false, entryType: 'answer', endsOn: null, translations: {}, ...o });
const T = (answerText: string) => ({ questionExamples: ['a', 'b', 'c'], answerText });

describe('answers that are not written yet', () => {
  it('knows the marker, and never lets a TO WRITE answer through', () => {
    expect(isPlaceholder('TO WRITE: the steps')).toBe(true); expect(isPlaceholder('  to write: x')).toBe(true); expect(isPlaceholder('Go to Wallet.')).toBe(false); expect(isPlaceholder(undefined)).toBe(false);
    expect(withoutPlaceholders(entry({ translations: { en: T('TO WRITE: a'), ms: T('TO WRITE: b') } }))).toBeNull();                                  // nothing real to say: left out
    const kept = withoutPlaceholders(entry({ translations: { en: T('TO WRITE: a'), ms: T('Pergi ke Dompet.') } }))!;
    expect(Object.keys(kept.translations)).toEqual(['ms']);                                                                                          // only the written language stays
    const staff = entry({ entryType: 'needs_staff', translations: { en: T('TO WRITE: a person answers') } });
    expect(withoutPlaceholders(staff)).toBe(staff);                                                                                                  // a person answers: kept, the bot says nothing of its own
  });
});

const url = process.env.TEST_DATABASE_URL;
let pool: Pool | null = null; let reachable = false;
if (url) { pool = createPool(url, 6); try { await pool.query('select 1'); reachable = true; } catch { /* skipped below */ } }

describe.skipIf(!reachable)('the starter entries set live: what a customer gets (needs TEST_DATABASE_URL)', () => {
  beforeAll(async () => { await migrate(pool!, { reset: true }); await seed(pool!); });
  afterAll(async () => { await pool?.end(); });
  const live = (key: string, topic: string, type: 'answer' | 'needs_staff', q: string[], a: string, id: number) => ({ id, merchant: 'MERCH_A', category: 'Imported', intent_key: key, topic, aspect: null, topic_optional: false, status: 'live' as const, entry_type: type,
    translations: { en: { question_examples: q, answer_text: a } } });

  it('does not say TO WRITE to a customer, and hands over for an entry a person answers', async () => {
    const snap = await readSnapshot(pool!);
    snap.mAliases.MERCH_A.push({ language: 'en', variant: 'free', canonical: 'free_credit' }, { language: 'en', variant: 'free credit', canonical: 'free_credit' },
      { language: 'en', variant: 'game credit', canonical: 'game' }, { language: 'en', variant: 'credit missing', canonical: 'game' });
    snap.kb.push(
      live('free_credit_info', 'free_credit', 'answer', ['is there free credit', 'how to claim free credit', 'any free credit for new users'], 'TO WRITE: whether there is free credit.', 9001),
      live('credit_missing', 'game', 'needs_staff', ['my game credit is missing', 'credit missing in the game', 'game credit not showing'], 'TO WRITE: a person checks.', 9002),
      live('game_tips', 'game', 'answer', ['any game tips', 'how to win the game', 'game tips please'], 'We do not give game tips, but our team can help with anything else.', 9003));
    await writeSnapshot(pool!, snap, { merchants: ['MERCH_A'], shared: false });
    const k = await loadKnowledge(pool!); const keys = k.kbEntries.filter((e) => e.merchant === 'MERCH_A').map((e) => e.intentKey);
    expect(keys).toEqual(expect.arrayContaining(['credit_missing', 'game_tips'])); expect(keys).not.toContain('free_credit_info');                    // the unwritten answer never reaches the bot
    const bot = new Bot(k); const say = async (m: string) => { const s = newSession('sp-' + Math.random(), 'MERCH_A', null); const t = (await bot.message(s, m))!; return { s, t, text: t.messages.map((x) => x.text).join(' '), handed: s.handed }; };
    const free = await say('is there free credit for new users'); expect(free.text).not.toMatch(/TO WRITE/i);
    const missing = await say('my game credit is missing'); expect(missing.text).toMatch(/Which one/);                                                  // the topic has two entries: the customer picks
    expect(missing.t.buttons?.map((b) => b.key)).toContain('credit_missing');
    const picked = bot.pick(missing.s, { kind: 'intent', key: 'credit_missing', label: 'credit missing', lang: 'en' })!;                               // the one a person answers: the chat is handed over
    expect(missing.s.handed).toBe(true); expect(picked.messages.map((x) => x.text).join(' ')).not.toMatch(/TO WRITE/i);
    const tips = bot.pick((await say('game')).s, { kind: 'intent', key: 'game_tips', label: 'game tips', lang: 'en' })!;                               // a written answer is used
    expect(tips.messages.map((x) => x.text).join(' ')).toMatch(/do not give game tips/);
    const ms = await readMerchants(pool!); const draftBot = knowledgeFromSnapshot(await readSnapshot(pool!), ms, {}, true);
    expect(draftBot.kbEntries.map((e) => e.intentKey)).not.toContain('free_credit_info');                                                              // the same rule for the draft test
  });
});
