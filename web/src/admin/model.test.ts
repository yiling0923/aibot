import { describe, expect, it } from 'vitest';
import { analyzeImport, classify, groupKeywords, kwKind, findDup, kbToCSV, kwStatus, parseTable, slug, snapshotOf, unassign, type Draft } from './model';

const draft = (): Draft => ({
  kb: [{ id: 1, merchant: 'M', category: 'x', intent_key: 'deposit_how', topic: 'deposit', aspect: null, topic_optional: false, status: 'live', dirty: true, updated: 'now', translations: { en: { answer_text: 'Go to Wallet.', question_examples: ['depo how', 'how to deposit', 'dep how'] } } }],
  aliases: { deposit: { en: ['deposit', 'depo'], ms: [], zh: ['存款'] }, withdraw: { en: ['withdraw'], ms: [], zh: [] } },
  mAliases: { M: [{ language: 'en', variant: 'dpt', canonical: 'deposit' }] },
  aspects: { time: { en: ['how long'], ms: [], zh: [] } }, smalltalk: { thanks: { en: ['thanks'], ms: [], zh: [] } },
  guard: { abuse: { en: ['idiot'], ms: [], zh: [] }, abuse_soft: { en: ['md'], ms: [], zh: [] } }, fillers: { en: ['lah'], ms: [], zh: [] },
  settings: {},
});

describe('keyword status', () => {
  const d = draft();
  it('names where a word is used', () => {
    expect(kwStatus(d, 'M', 'depo').t).toBe('Topic: deposit');
    expect(kwStatus(d, 'M', 'DPT').t).toBe('Topic: deposit (this merchant)');
    expect(kwStatus(d, 'M', 'how long').t).toBe('Question word: time');
    expect(kwStatus(d, 'M', 'lah').t).toBe('Filler');
    expect(kwStatus(d, 'M', 'idiot')).toEqual({ c: 'bad', t: 'Rude word' });
    expect(kwStatus(d, 'M', 'md').c).toBe('warn');
    expect(kwStatus(d, 'M', 'zzz').t).toBe('Not set yet');
  });
  it('tells a topic word from a short form', () => {
    expect(classify(d, 'M', {}, 'deposit')).toBe('topic');
    expect(classify(d, 'M', {}, 'depo')).toBe('slang');
    expect(classify(d, 'M', {}, 'lah')).toBe('filler');
    expect(classify(d, 'M', { zzz: { w: 'zzz', n: 1, lg: 'en', h: '', guess: 'rude' } }, 'zzz')).toBe('rude');
  });
  it('never allows the same word twice', () => {
    expect(findDup(d, 'M', 'Merchant', 'Depo')).toEqual(['a short form of "deposit"']);
    expect(findDup(d, 'M', 'Merchant', 'new')).toEqual([]);
  });
  it('removes a word from every list', () => {
    const x = draft(); unassign(x, 'M', 'depo'); unassign(x, 'M', 'dpt'); unassign(x, 'M', 'lah');
    expect(kwStatus(x, 'M', 'depo').t).toBe('Not set yet'); expect(kwStatus(x, 'M', 'dpt').t).toBe('Not set yet'); expect(kwStatus(x, 'M', 'lah').t).toBe('Not set yet');
  });
});

describe('what is sent to the server', () => {
  it('drops the display-only fields', () => {
    const kb = snapshotOf(draft()).kb[0] as unknown as Record<string, unknown>;
    expect(kb.dirty).toBeUndefined(); expect(kb.updated).toBeUndefined(); expect(kb.intent_key).toBe('deposit_how');
  });
  it('makes a safe entry name', () => expect(slug(' Delete Account! ')).toBe('delete_account'));
});

describe('csv import', () => {
  it('reads quoted cells and tabs', () => {
    expect(parseTable('a,b\n"x, y","say ""hi"""')).toEqual([['a', 'b'], ['x, y', 'say "hi"']]);
    expect(parseTable('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('blocks a file without the needed columns', () => expect(analyzeImport('foo,bar\n1,2', draft(), 'M', 'Merchant').fatal).toMatch(/Missing column/));
  it('marks new and existing entries, and flags problems', () => {
    const csv = 'intent_key,topic,language,question_examples,answer_text\ndeposit_how,deposit,en,a|b|c,New answer\nDelete Account,,en,x,\nrefund_how,refund,en,a|b,Refunds in 7 days';
    const r = analyzeImport(csv, draft(), 'M', 'Merchant'); const by = Object.fromEntries(r.entries.map((g) => [g.key, g]));
    expect(by.deposit_how.exists).toBe(true); expect(by.deposit_how.errors).toEqual([]);
    expect(by.delete_account.errors.join()).toMatch(/English answer is required/); expect(by.delete_account.errors.join()).toMatch(/topic is required/i);
    expect(by.refund_how.exists).toBe(false); expect(by.refund_how.issues.join()).toMatch(/New topic word "refund"/);
  });
  it('skips rows for another merchant', () => {
    const csv = 'intent_key,language,answer_text,topic,merchant\na,en,Hi,deposit,OTHER\nb,en,Hi,deposit,Merchant';
    const r = analyzeImport(csv, draft(), 'M', 'Merchant'); expect(r.skippedRows).toBe(1); expect(r.entries.map((g) => g.key)).toEqual(['b']);
  });
  it('exports a merchant knowledge base that imports back', () => {
    const d = draft(); const r = analyzeImport(kbToCSV(d.kb), d, 'M', 'Merchant');
    expect(r.entries).toHaveLength(1); expect(r.entries[0].errors).toEqual([]); expect(r.entries[0].exists).toBe(true);
  });
});

describe('a main keyword and the words under it', () => {
  it('puts abbreviations under Short forms, other scripts under Other languages and the rest under Same meaning', () => {
    for (const w of ['dep', 'depo', 'dp', 'deps']) expect(kwKind('deposit', { variant: w, language: 'en' })).toBe('short');
    expect(kwKind('withdraw', { variant: 'wd', language: 'en' })).toBe('short');
    expect(kwKind('deposit', { variant: 'topup', language: 'en' })).toBe('meaning');
    expect(kwKind('deposit', { variant: '充值', language: 'zh' })).toBe('lang');
    expect(kwKind('deposit', { variant: 'tambah nilai', language: 'ms' })).toBe('lang');
    expect(kwKind('deposit', { variant: 'x', language: 'en' })).toBe('meaning');            // one letter is not a short form
  });
  it('a kind chosen by a person wins over the guess', () => {
    expect(kwKind('deposit', { variant: 'dp', language: 'en', kind: 'slang' })).toBe('slang');
    expect(kwKind('deposit', { variant: 'topup', language: 'en', kind: 'short' })).toBe('short');
    expect(kwKind('deposit', { variant: 'dp', language: 'en', kind: 'nonsense' })).toBe('short');   // an unknown kind is ignored
  });
  it('groups in a fixed order and leaves empty groups out', () => {
    const g = groupKeywords('deposit', [{ variant: '充值', language: 'zh' }, { variant: 'topup', language: 'en' }, { variant: 'dp', language: 'en' }, { variant: 'depo', language: 'en' }, { variant: 'cash in', language: 'en', kind: 'slang' }]);
    expect(g.map((x) => x.label)).toEqual(['Short forms', 'Slang', 'Same meaning', 'Other languages']);
    expect(g[0].items.map((x) => x.variant)).toEqual(['dp', 'depo']);
    expect(groupKeywords('deposit', [{ variant: 'dp', language: 'en' }]).map((x) => x.kind)).toEqual(['short']);
  });
});
