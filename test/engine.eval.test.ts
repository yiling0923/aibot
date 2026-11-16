import { describe, it, expect } from 'vitest';
import { Engine, knowledgeFromSeed } from '../src/engine';
import { seedJson, accountsJson, evalCases, judge } from './helpers';

const engine = new Engine(knowledgeFromSeed(seedJson, accountsJson));

describe('engine: acceptance cases from the seed JSON', () => {
  it('has the 149 acceptance cases', () => { expect(evalCases.length).toBeGreaterThanOrEqual(149); });
  for (const c of evalCases) {
    it(`${c.merchant}: "${c.message}" -> ${c.expected_decision}${c.expected_intent ? ' ' + c.expected_intent : ''}`, () => {
      const r = engine.analyze(c.message, c.merchant, 0);
      expect({ decision: r.decision, intent: r.decision === 'ANSWER' ? r.top.intent : null })
        .toEqual({ decision: c.expected_decision, intent: c.expected_decision === 'ANSWER' ? c.expected_intent : null });
      expect(judge(r, c)).toBe(true);
    });
  }
});

describe('engine: words learned from real customer chats', () => {
  it.each([['maybank', 'HANDOFF'], ['send me paynow scan', 'HANDOFF'], ['cdm', 'HANDOFF'], ['provide me bank acc for deposit', 'HANDOFF'], ['account for deposit 50', 'HANDOFF'], ['hi bro topup dbs bank acc', 'HANDOFF'], ['claim', 'ANSWER'], ['tng free spin', 'ANSWER'], ['done', 'SMALLTALK'], ['halo', 'SMALLTALK'],
    ['pls check', 'HANDOFF'], ['hurry', 'HANDOFF'], ['leave message', 'HANDOFF'], ['help to approve', 'HANDOFF']])('"%s" -> %s', (text, decision) => {
    expect(engine.analyze(text, 'MERCH_A', 0).decision).toBe(decision);
  });
});

describe('engine: asking for the deposit account goes to a person, but questions about it do not', () => {
  it.each([['how to deposit', 'ANSWER'], ['how to deposit with paynow', 'ANSWER'], ['can i change my bank account', 'HANDOFF'], ['account number', 'CLARIFY'], ['withdraw to maybank', 'HANDOFF'], ['deposit', 'CHOICE']])('"%s" is not a plain account request (%s)', (text) => {
    const r = engine.analyze(text, 'MERCH_A', 0);
    expect(r.guard?.kind).not.toBe('pay-details');
  });
  it('is a hand-over that says why', () => { const r = engine.analyze('send me paynow scan', 'MERCH_A', 0); expect(r.guard?.kind).toBe('pay-details'); });
});

describe('engine: the language follows the customer', () => {
  it.each([['i want to claim welcome bonus?', 'en'], ['bonus', 'en'], ['how to claim the bonus', 'en'], ['nak claim bonus macam mana', 'ms'], ['dep dah 2 jam belum masuk', 'ms']])('"%s" is %s', (text, lang) => {
    expect(engine.detectLang(text)).toBe(lang);
  });
});

describe('engine: behaviour that does not fit one message', () => {
  it('asks for confirmation using the earlier topic', () => {
    const r = engine.analyze('500', 'MERCH_A', 0, { lastTopic: 'deposit' });
    expect(r.decision).toBe('AMOUNT'); expect(r.ctxDir).toBe('deposit'); expect(r.dir).toBeNull();
  });
  it('reads the amount and the direction', () => {
    const r = engine.analyze('wd rm1,000', 'MERCH_C', 0);
    expect(r.decision).toBe('AMOUNT'); expect(r.dir).toBe('withdraw'); expect(r.amt?.n).toBe(1000);
  });
  it('shows buttons once, then hands over', () => {
    expect(engine.analyze('how long?', 'MERCH_A', 0).decision).toBe('CLARIFY');
  });
  it('keeps merchants apart: only SwiftWallet lacks promotions', () => {
    expect(engine.analyze('any promotion?', 'MERCH_A', 0).decision).toBe('ANSWER');
    expect(engine.analyze('any promotion?', 'MERCH_B', 0).decision).toBe('HANDOFF');
  });
  it('turns tools off per merchant', () => {
    expect(engine.analyze('my points', 'MERCH_A', 0).decision).toBe('ACCOUNT');
    expect(engine.analyze('my points', 'MERCH_B', 0).decision).toBe('HANDOFF');
  });
  it('throws for an unknown merchant', () => { expect(() => engine.analyze('hi', 'NOPE')).toThrow(); });
});
