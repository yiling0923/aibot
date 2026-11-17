import { describe, expect, it } from 'vitest';
import { analyzeImport, entryProblems, parseTable, type Draft } from './model';
import { STARTER_ENTRIES, STARTER_TAGS, STARTER_TOPICS_NEW, starterCsv } from './starterPack';

const draft = (): Draft => ({ kb: [], aliases: { deposit: { en: ['deposit'], ms: [], zh: [] }, withdraw: { en: ['withdraw'], ms: [], zh: [] }, password: { en: ['password'], ms: [], zh: [] }, verify: { en: ['verify'], ms: [], zh: [] },
  register: { en: ['register'], ms: [], zh: [] }, turnover: { en: ['turnover'], ms: [], zh: [] }, promotion: { en: ['promo'], ms: [], zh: [] } }, mAliases: { M: [] }, aspects: {}, smalltalk: {}, guard: { abuse: {}, abuse_soft: {} }, fillers: {}, settings: {} });

describe('the FAQ category starter pack', () => {
  const csv = starterCsv(); const r = analyzeImport(csv, draft(), 'M', 'Merchant');
  it('imports cleanly: every entry is read, none has an error, English and Malay are both there', () => {
    expect(r.fatal).toBeNull(); expect(r.entries).toHaveLength(STARTER_ENTRIES); expect(r.entries.filter((g) => g.errors.length)).toEqual([]);
    expect(r.entries.every((g) => g.langs.en && g.langs.ms)).toBe(true);
    expect(r.entries.every((g) => g.langs.en.examples.length >= 3 && g.langs.ms.examples.length >= 3)).toBe(true);        // the bot finds an entry by its example questions
    expect(parseTable(csv).every((row) => row.length === 8)).toBe(true);                                                 // no cell broke the table
  });
  it('makes the new topics with their keywords, and uses the existing topics where there is one', () => {
    expect(STARTER_TOPICS_NEW.sort()).toEqual(['complaint', 'free_credit', 'game', 'profile', 'referral', 'violation']);
    const g = r.entries.find((x) => x.key === 'free_credit_info')!; expect(g.topicWords).toContain('percuma'); expect(g.issues.join(' ')).toMatch(/New topic word "free_credit"/);
    expect(r.entries.find((x) => x.key === 'reset_turnover')!.issues.join(' ')).not.toMatch(/New topic word/);               // turnover is a topic already
    expect(r.entries.find((x) => x.key === 'cannot_login')!.topic).toBe('password');
  });
  it('marks what a person must answer, so the bot hands the chat over', () => {
    const staff = r.entries.filter((g) => g.entryType === 'needs_staff').map((g) => g.key);
    expect(staff).toEqual(expect.arrayContaining(['free_credit_request', 'referral_bonus_missing', 'withdraw_cant', 'credit_missing', 'complaint_lost_game', 'complaint_other', 'rule_violation', 'promo_poster', 'deposit_bank_details', 'update_details']));
    expect(r.entries.find((g) => g.key === 'free_credit_info')!.entryType).toBe('answer');
  });
  it('every entry comes from a tag of the list, and no entry name repeats', () => {
    expect(Object.keys(STARTER_TAGS)).toHaveLength(STARTER_ENTRIES); expect(new Set(r.entries.map((g) => g.key)).size).toBe(STARTER_ENTRIES);
  });
  it('is flagged until the answers are written: "TO WRITE" is a problem, and a person-answered entry needs no answer text', () => {
    const tr = { en: { question_examples: ['a', 'b', 'c'], answer_text: 'TO WRITE: the steps.' } };
    expect(entryProblems({ status: 'live', translations: tr }).join(' ')).toMatch(/still says "TO WRITE"/);
    expect(entryProblems({ status: 'live', translations: { en: { question_examples: ['a', 'b', 'c'], answer_text: 'Go to Wallet.' } } })).toEqual([]);
    expect(entryProblems({ status: 'live', entry_type: 'needs_staff', translations: tr })).toEqual([]);                      // a person answers: only the questions matter
    expect(entryProblems({ status: 'draft', entry_type: 'needs_staff', translations: tr })).toHaveLength(1);                // still a draft
  });
});

import { LUCKYPAY_ENTRIES, luckypayCsv, LUCKYPAY_TAGS } from './starterPack';
describe('LuckyPay promotions pack', () => {
  it('holds the seven named promotions and VIP, in English and Malay, all with TO WRITE answers', () => {
    expect(LUCKYPAY_ENTRIES).toBe(8);
    expect(Object.values(LUCKYPAY_TAGS).filter((t) => t.startsWith('PROMOTION')).length).toBe(7);
    expect(LUCKYPAY_TAGS.vip_info).toBe('VIP');
    const csv = luckypayCsv();
    expect(csv).toMatch(/promo_first_deposit_120,promotion,,en,answer/);
    expect(csv).toMatch(/promo_daily_rescue_bonus,promotion,,ms,answer/);
    expect((csv.match(/TO WRITE:/g) || []).length).toBe(16);
  });
});
