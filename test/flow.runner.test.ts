import { describe, it, expect } from 'vitest';
import { startFlow, continueFlow } from '../src/engine/flow';
import type { Flow } from '../src/engine/flowTypes';

const T = (en: string, ms?: string): Record<string, string> => (ms ? { en, ms } : { en });
const flow: Flow = {
  id: 1, name: 'Deposit help', topic: 'deposit', status: 'live', blocks: [
    { id: 'a', type: 'message', text: T('Hi! Let me help with your deposit.', 'Hai! Saya bantu deposit anda.') },
    { id: 'q', type: 'question', text: T('What do you need?'), options: [{ id: 'how', label: T('How to deposit'), next: 'ans' }, { id: 'late', label: T('My deposit is late'), next: 'who' }, { id: 'bye', label: T('Nothing'), next: 'end' }] },
    { id: 'ans', type: 'answer', intent: 'deposit_how', next: 'end' },
    { id: 'who', type: 'ask', text: T('What is your username?'), field: 'user' },
    { id: 'h', type: 'handoff', text: T('Thanks {user}, a person will check it now.') },
    { id: 'end', type: 'end', text: T('Anything else?') },
  ],
};
const answers = (k: string) => (k === 'deposit_how' ? 'Go to Wallet > Deposit.' : '');

describe('flow runner', () => {
  it('starts with a message and waits at the first question with its choices', () => {
    const o = startFlow(flow, 'en', answers);
    expect(o.messages).toEqual(['Hi! Let me help with your deposit.', 'What do you need?']);
    expect(o.buttons?.map((b) => b.label)).toEqual(['How to deposit', 'My deposit is late', 'Nothing']);
    expect(o.state?.at).toBe('q'); expect(o.handed).toBe(false);
  });
  it('uses the customer language, and English when a language is missing', () => {
    expect(startFlow(flow, 'ms', answers).messages[0]).toBe('Hai! Saya bantu deposit anda.');
    expect(startFlow(flow, 'th', answers).messages[0]).toBe('Hi! Let me help with your deposit.');
  });
  it('follows a tapped choice to a Knowledge base answer and ends', () => {
    const s = startFlow(flow, 'en', answers).state!;
    const o = continueFlow(flow, s, { pick: 'how' }, 'en', answers);
    expect(o.messages).toEqual(['Go to Wallet > Deposit.', 'Anything else?']); expect(o.done).toBe(true); expect(o.state).toBeNull();
  });
  it('asks for a detail, remembers it, and uses it in a later text before handing over', () => {
    const s = startFlow(flow, 'en', answers).state!;
    const ask = continueFlow(flow, s, { pick: 'late' }, 'en', answers);
    expect(ask.messages).toEqual(['What is your username?']); expect(ask.state?.at).toBe('who');
    const o = continueFlow(flow, ask.state!, { text: 'tom88' }, 'en', answers);
    expect(o.messages).toEqual(['Thanks tom88, a person will check it now.']); expect(o.handed).toBe(true);
  });
  it('understands a choice typed as words', () => {
    const s = startFlow(flow, 'en', answers).state!;
    expect(continueFlow(flow, s, { text: 'how to deposit please' }, 'en', answers).messages[0]).toBe('Go to Wallet > Deposit.');
  });
  it('asks again once when the reply is unclear, then hands over', () => {
    const s = startFlow(flow, 'en', answers).state!;
    const again = continueFlow(flow, s, { text: 'asdf' }, 'en', answers);
    expect(again.buttons?.length).toBe(3); expect(again.state?.misses).toBe(1);
    const out = continueFlow(flow, again.state!, { text: 'qwer' }, 'en', answers);
    expect(out.handed).toBe(true);
  });
  it('stops a flow that loops by mistake', () => {
    const loop: Flow = { id: 2, name: 'loop', topic: 'x', status: 'live', blocks: [{ id: 'a', type: 'message', text: T('again'), next: 'a' }] };
    expect(startFlow(loop, 'en', answers).done).toBe(true);
  });
  it('an empty flow does nothing', () => { expect(startFlow({ ...flow, blocks: [] }, 'en', answers).done).toBe(true); });
});
