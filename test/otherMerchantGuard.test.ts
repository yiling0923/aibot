import { describe, it, expect } from 'vitest';
import { Bot, newSession } from '../src/bot/responder';
import { knowledgeFromSeed } from '../src/engine';
import { seedJson, accountsJson } from './helpers';

/** A bot where the merchants include ones with digits in the code, like the real "77Y8", "7ST" and "DJ8 SG". */
function botWith(...extra: { code: string; name: string }[]) {
  const k = knowledgeFromSeed(seedJson, accountsJson); const base = k.merchants.find((m) => m.code === 'MERCH_A')!;
  for (const x of extra) k.merchants.push({ ...base, ...x, aliases: [], tools: [...base.tools] });
  return new Bot(k);
}
const decision = async (bot: Bot, text: string) => String((await bot.message(newSession('g' + Math.random(), 'MERCH_A', null), text))!.trace.decision);
const guard = async (bot: Bot, text: string) => (await bot.message(newSession('g' + Math.random(), 'MERCH_A', null), text))!.trace.guard as { kind: string } | null;

describe('naming another merchant hands over, but a code with digits must not match ordinary words', () => {
  const bot = botWith({ code: '77Y8', name: '77Y8' }, { code: '7ST', name: '7ST' }, { code: 'DJ8_SG', name: 'DJ8 SG' });

  it('a message with the letter y (the code 77Y8 without its digits) is NOT taken as naming another merchant', async () => {
    for (const q of ['my balance', 'deposit not in yet', 'how long does deposit take', 'my money not in', 'any bonus today']) expect((await guard(bot, q))?.kind, q).not.toBe('other-merchant');
    expect(await decision(bot, 'how long does deposit take')).toBe('ANSWER');
  });
  it('still hands over when another merchant is really named, in any spelling', async () => {
    for (const q of ['I want to ask about 77Y8', 'can i deposit in 77 y8', 'is mega play better', 'dj8 sg bonus', 'what about 7st', 'swiftwallet']) expect((await guard(bot, q))?.kind, q).toBe('other-merchant');
  });
  it('a very short name is not looked for (it would match ordinary words)', async () => {
    const b = botWith({ code: 'AB', name: 'AB' }, { code: 'X1', name: 'X1' });
    expect((await guard(b, 'about my deposit and the balance'))?.kind).not.toBe('other-merchant');
  });
});
