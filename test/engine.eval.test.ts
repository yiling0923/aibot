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
