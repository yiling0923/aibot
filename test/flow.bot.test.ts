import { describe, it, expect } from 'vitest';
import { Bot, newSession } from '../src/bot/responder';
import { knowledgeFromSeed } from '../src/engine';
import type { Flow } from '../src/engine/flowTypes';
import { seedJson, accountsJson } from './helpers';

const flow: Flow = {
  id: 5, name: 'Deposit help', topic: 'deposit', status: 'live', blocks: [
    { id: 'q', type: 'question', text: { en: 'What do you need for your deposit?' }, options: [
      { id: 'how', label: { en: 'How to deposit' }, next: 'ans' }, { id: 'late', label: { en: 'It is late' }, next: 'who' },
      { id: 'lim', label: { en: 'The limits' }, next: '__end' }, { id: 'oth', label: { en: 'Something else' }, next: '__end' }] },
    { id: 'ans', type: 'answer', intent: 'deposit_how', next: '__end' },
    { id: 'who', type: 'ask', text: { en: 'What is your username?' }, field: 'user' },
    { id: 'h', type: 'handoff', text: { en: 'Thanks {user}, a person checks it now.' } },
  ],
};
const bot = () => { const k = knowledgeFromSeed(seedJson, accountsJson); k.merchants.find((m) => m.code === 'MERCH_A')!.flows = [flow]; return new Bot(k); };
const text = (t: Awaited<ReturnType<Bot['message']>>) => t!.messages.map((m) => m.text).join('\n');

describe('flows inside the bot', () => {
  it('runs the flow when the customer asks about its topic, with all of its choices (not cut to 3)', async () => {
    const b = bot(), s = newSession('f1', 'MERCH_A', null);
    const t = (await b.message(s, 'deposit'))!;
    expect(text(t)).toContain('What do you need for your deposit?');
    expect(t.buttons!.filter((x) => x.kind === 'flow').map((x) => x.label)).toEqual(['How to deposit', 'It is late', 'The limits', 'Something else']);
    expect(s.flow?.at).toBe('q');
  });
  it('a tapped choice goes on, and the Knowledge base answer is said', async () => {
    const b = bot(), s = newSession('f2', 'MERCH_A', null); await b.message(s, 'deposit');
    const t = b.pick(s, { kind: 'flow', key: 'how', label: 'How to deposit', lang: 'en' })!;
    expect(text(t)).toContain('Wallet'); expect(s.flow).toBeNull(); expect(s.handed).toBe(false);
  });
  it('a typed choice works too, and a detail the customer types is used in the hand-over', async () => {
    const b = bot(), s = newSession('f3', 'MERCH_A', null); await b.message(s, 'deposit');
    const ask = (await b.message(s, 'it is late'))!;
    expect(text(ask)).toContain('What is your username?'); expect(s.flow?.at).toBe('who');
    const done = (await b.message(s, 'tom88'))!;
    expect(text(done)).toContain('Thanks tom88, a person checks it now.'); expect(s.handed).toBe(true); expect(s.flow).toBeNull();
  });
  it('asking for a person leaves the flow', async () => {
    const b = bot(), s = newSession('f4', 'MERCH_A', null); await b.message(s, 'deposit');
    await b.message(s, 'talk to a real person');
    expect(s.flow).toBeNull(); expect(s.handed).toBe(true);
  });
  it('other topics are not touched by the flow', async () => {
    const b = bot(), s = newSession('f5', 'MERCH_A', null);
    const t = (await b.message(s, 'how to withdraw'))!;
    expect(s.flow ?? null).toBeNull(); expect(text(t)).toContain('withdraw');
  });
  it('a draft flow is not used by the live bot (only live flows are loaded)', async () => {
    const k = knowledgeFromSeed(seedJson, accountsJson); const b = new Bot(k), s = newSession('f6', 'MERCH_A', null);
    await b.message(s, 'deposit'); expect(s.flow ?? null).toBeNull();
  });
});
