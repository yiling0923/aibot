import { describe, it, expect, afterEach } from 'vitest';
import { Bot, newSession } from '../src/bot/responder';
import { knowledgeFromSeed } from '../src/engine';
import { seedJson, accountsJson } from './helpers';

const bot = new Bot(knowledgeFromSeed(seedJson, accountsJson));
const entry = bot.engine.entriesOf('MERCH_A').find((e) => e.topic === 'deposit' && e.aspect === 'time')!;
const orig = { entryType: entry.entryType, endsOn: entry.endsOn };
afterEach(() => { Object.assign(entry, orig); });
const say = async (text: string) => (await bot.message(newSession('f-' + Math.random(), 'MERCH_A', null), text))!;
const text = (t: { messages: { kind: string; text: string }[] }) => t.messages.filter((m) => m.kind === 'bot').map((m) => m.text).join(' ');
const ymd = (offsetDays: number) => { const d = new Date(Date.now() + offsetDays * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

describe('knowledge base entry fields: type and end date', () => {
  it('an Answer entry answers, as before', async () => {
    const t = await say('deposit how long'); expect(t.trace.decision).toBe('ANSWER'); expect(t.trace.top).toMatchObject({ intent: entry.intentKey });
  });

  it('a "needs staff" entry is never answered by the bot: the chat goes to a person', async () => {
    entry.entryType = 'needs_staff';
    const t = await say('deposit how long'); expect(t.trace.decision).toBe('HANDOFF'); expect(t.trace.why).toMatch(/needs staff/);
    expect(text(t)).not.toContain(entry.translations.en!.answerText.slice(0, 30));
  });

  it('a promotion hides itself after its end date, and still works on the last day', async () => {
    entry.entryType = 'promotion';
    entry.endsOn = ymd(0); expect((await say('deposit how long')).trace.decision).toBe('ANSWER');         // the last day counts
    entry.endsOn = ymd(1); expect((await say('deposit how long')).trace.decision).toBe('ANSWER');
    entry.endsOn = ymd(-1); const t = await say('deposit how long'); expect(t.trace.decision).not.toBe('ANSWER');
    expect(text(t)).not.toContain(entry.translations.en!.answerText.slice(0, 30));
  });
});
