import { describe, expect, it } from 'vitest';


import { suggestTopic } from './model';
describe('suggestTopic', () => {
  const words = new Map([['deposit', 'deposit'], ['depo', 'deposit'], ['withdraw', 'withdraw'], ['充值', 'deposit']]);
  it('picks the topic that sits in the same messages most often', () => {
    expect(suggestTopic('topup', ['my topup not in', 'topup depo slow', 'topup deposit please', 'topup withdraw?'], words)).toEqual({ topic: 'deposit', hits: 2, of: 4 });
    expect(suggestTopic('充值失败', ['充值失败了'], words)).toEqual({ topic: 'deposit', hits: 1, of: 1 });
  });
  it('does not guess when there is no topic or two topics tie', () => {
    expect(suggestTopic('lol', ['lol ok', 'lol hello'], words)).toBeNull();
    expect(suggestTopic('x', ['x deposit', 'x withdraw'], words)).toBeNull();
    expect(suggestTopic('x', [], words)).toBeNull();
  });
});
