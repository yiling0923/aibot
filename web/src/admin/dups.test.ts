import { describe, expect, it } from 'vitest';
import { findDuplicateEntries, type Entry } from './model';

const e = (id: number, key: string, topic: string, aspect: string | null, qs: string[], a: string): Entry => ({ id, merchant: 'A', intent_key: key, topic, aspect, topic_optional: false, status: 'live', category: 'x', translations: { en: { question_examples: qs, answer_text: a } } } as unknown as Entry);

describe('findDuplicateEntries', () => {
  it('finds the same answer and the same example question, and ignores entries that differ', () => {
    const list = [
      e(1, 'deposit_time', 'deposit', 'time', ['how long deposit'], 'Deposits are credited within 5 minutes.'),
      e(2, 'deposit_wait', 'deposit', 'time', ['How long  deposit?'], 'Deposits are credited within 5 minutes.'),
      e(3, 'withdraw_limit', 'withdraw', 'limit', ['withdraw limit'], 'The minimum withdrawal is MYR 100.'),
    ];
    const r = findDuplicateEntries(list);
    expect(r).toHaveLength(1);
    expect([r[0].a.id, r[0].b.id]).toEqual([1, 2]);
    expect(r[0].reasons).toEqual(['Same answer', 'Same example question', 'Same topic and question type']);
  });
  it('finds nothing when all entries are different', () => {
    expect(findDuplicateEntries([e(1, 'a', 'deposit', 'time', ['x one'], 'Short.'), e(2, 'b', 'withdraw', 'time', ['y two'], 'Other.')])).toEqual([]);
  });
});
