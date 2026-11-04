import { describe, it, expect } from 'vitest';
import { Bot, newSession } from '../src/bot/responder';
import { makeToken, checkToken } from '../src/bot/token';
import { tokensOf } from '../src/bot/store';
import { knowledgeFromSeed } from '../src/engine';
import { seedJson, accountsJson } from './helpers';

const bot = new Bot(knowledgeFromSeed(seedJson, accountsJson));
const tom = makeToken({ customer_id: 8841, name: 'Tom' });
const text = (t: ReturnType<Bot['message']>) => t!.messages.map((m) => m.text).join('\n');

describe('customer token', () => {
  it('accepts a signed token and rejects a tampered one', () => {
    expect(checkToken(tom)).toEqual({ state: 'valid', id: '8841', name: 'Tom' });
    expect(checkToken(null)).toEqual({ state: 'none' });
    const mary = makeToken({ customer_id: 9120, name: 'Mary' });
    expect(checkToken(mary.split('.')[0] + '.' + tom.split('.')[1]).state).toBe('invalid');     // Mary's ID with Tom's signature
    expect(checkToken('garbage').state).toBe('invalid');
    expect(checkToken(tom, 'another-secret').state).toBe('invalid');
  });
});

describe('replies', () => {
  it('answers from the merchant knowledge base in the customer language, with the merchant tone', () => {
    const t = bot.message(newSession('1', 'MERCH_A', null), 'depo how lah boss')!;
    expect(t.trace.decision).toBe('ANSWER');
    expect(text(t)).toContain('Wallet > Deposit');
    expect(text(t)).toMatch(/^Hai!/);                                                   // friendly tone, Malay
  });

  it('reads account data only for a verified customer', () => {
    expect(text(bot.message(newSession('2', 'MERCH_A', tom), 'my balance'))).toContain('Tom');
    const guest = bot.message(newSession('3', 'MERCH_A', null), 'my balance')!;
    expect(text(guest)).toMatch(/log in/i);
    expect(text(guest)).not.toMatch(/MYR/);
    const forged = makeToken({ customer_id: 9120, name: 'Mary' }).split('.')[0] + '.' + tom.split('.')[1];
    expect(text(bot.message(newSession('4', 'MERCH_A', forged), 'my balance'))).not.toMatch(/MYR/);
  });

  it('never shows secrets, even to a verified customer', () => {
    const t = bot.message(newSession('5', 'MERCH_A', tom), 'what is my otp')!;
    expect(t.trace.decision).toBe('REFUSE');
    expect(text(t)).not.toMatch(/\d{4,}/);
  });

  it('is kind first and closes the chat only after the merchant limit of rude messages', () => {
    const s = newSession('6', 'MERCH_A', null);
    const limit = bot.engine.merchant('MERCH_A').abuseCloseAfter;
    for (let i = 1; i < limit; i++) { const t = bot.message(s, 'pukima')!; expect(t.locked).toBe(false); expect(s.closed).toBe(false); }
    const last = bot.message(s, 'pukima')!;
    expect(last.locked).toBe(true); expect(s.closed).toBe(true);
    expect(bot.message(s, 'hello')).toBeNull();                                          // a closed chat gets no more replies
  });

  it('hands off to a human and then stays quiet', () => {
    const s = newSession('7', 'MERCH_B', null);
    const t = bot.message(s, 'any promotion?')!;
    expect(t.trace.decision).toBe('HANDOFF'); expect(s.handed).toBe(true);
    expect(text(bot.message(s, 'hello'))).toMatch(/human agent/);
  });

  it('shows buttons for a bare topic and answers when a button is tapped', () => {
    const s = newSession('8', 'MERCH_A', null);
    const t = bot.message(s, 'dep')!;
    expect(t.trace.decision).toBe('CHOICE');
    const how = t.buttons!.find((b) => b.key === 'deposit_how')!;
    expect(t.buttons!.at(-1)!.kind).toBe('agent');
    expect(text(bot.pick(s, { kind: how.kind, key: how.key, label: how.label, lang: 'en' }))).toContain('Wallet > Deposit');
  });

  it('confirms an amount instead of guessing, and checks it against the merchant limits', () => {
    const s = newSession('9', 'MERCH_A', null);
    const t = bot.message(s, 'cash 500')!;
    expect(t.trace.decision).toBe('AMOUNT'); expect(t.buttons!.some((b) => b.kind === 'amt' && b.key === 'deposit')).toBe(true);
    expect(text(bot.pick(s, { kind: 'amt', key: 'withdraw', amt: 500, label: 'Withdraw RM500', lang: 'en' }))).toMatch(/RM500/);
  });
});

describe('keyword saving', () => {
  it('keeps real words and drops stop words, and keeps Chinese runs', () => {
    expect(tokensOf('I nak wd the 存款 lah')).toEqual(['nak', 'wd', 'lah', '存款']);
  });
});
