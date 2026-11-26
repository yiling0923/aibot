// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readXlsx, writeXlsx } from './xlsx';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Admin from './Admin';
import { LUCKYPAY_ENTRIES, luckypayCsv, STARTER_ENTRIES } from './starterPack';

const SET = () => ({ tone: 'friendly', handoff_group: 1, answer: 0.72, clarify: 0.45, abuse_close_after: 3, kind: {}, closing: {}, handoff: {}, tools: { deposit_status: true }, max_choices: 3, more_help_on: true, more_help: {}, ai_instructions: '', handoff_complaint: true, handoff_account: true, trigger_phrases: '' });
const BASICS = { retentionDays: 90, name: 'LuckyPay', domain: '', defaultLanguage: 'en', languages: ['en', 'ms', 'zh', 'vi', 'th', 'tl'], monthlyTokenLimit: 500000, tokensMonth: 12400, tokensToday: 300, entries: 11, questionsToday: 7, avgConfidence: 0.81 };
/** Entries of merchant B for the bulk-action test: two live and ready, one ready draft, one draft that still says TO WRITE. Empty in every other test. */
let withKb = false;
const kbEntry = (id: number, key: string, status: 'live' | 'draft', answer: string) => ({ id, merchant: 'B', category: 'General', intent_key: key, topic: 'deposit', aspect: null, topic_optional: false, status, translations: { en: { question_examples: [key + ' one', key + ' two', key + ' three'], answer_text: answer } } });
const kbList = () => (withKb ? [kbEntry(1, 'dep_how', 'live', 'Go to Wallet.'), kbEntry(2, 'dep_time', 'live', 'Five minutes.'), kbEntry(3, 'dep_limit', 'draft', 'RM30 to RM30,000.'), kbEntry(4, 'dep_bonus', 'draft', 'TO WRITE: the bonus rules')] : []);
const state = (role: 'admin' | 'staff') => ({
  versions: { A: 3, B: 2 }, sharedVer: 1, stamp: 9, merchants: role === 'admin' ? [{ code: 'A', name: 'LuckyPay', bot_mode: botMode, default_language: defA, languages: langsA, auto_translate: autoTr ? 1 : 0 }, { code: 'B', name: 'SwiftWallet', auto_translate: autoTr ? 1 : 0 }] : [{ code: 'B', name: 'SwiftWallet', auto_translate: autoTr ? 1 : 0 }],
  history: [{ kind: 'merchant', merchant: role === 'admin' ? 'A' : 'B', version: 3, actor: 'admin', summary: 'Edited', ago: 'today' }], user: { username: 'u', role, merchant: role === 'admin' ? null : 'B' }, ai: { pick: false, write: false, describe: false, translate: true, suggest: true },
  snapshot: {
    kb: kbList(), aliases: { deposit: { en: ['deposit', 'dep', 'depo', 'dps'], ms: [], zh: ['充值'] } }, mAliases: { A: [], B: [] }, aspects: {}, smalltalk: {}, guard: { abuse: {}, abuse_soft: {} }, fillers: { en: ['lah'], ms: [], zh: [] },
    settings: { A: SET(), B: SET() },
  },
});
const UNMATCHED = [{ text: 'tarik duit lambat', language: 'ms', hits: 5, resolved: false, resolution: null, first: '2 days ago', last: 'today' }, { text: 'abc xyz', language: 'en', hits: 1, resolved: true, resolution: 'ignored', first: 'x', last: 'y' }];
const RANKING = { rows: ['dep', 'wd', 'lh', 'tolonglh', 'deposit'].map((w, i) => ({ w, n: 50 - i * 9, c: i % 2 ? -12 : 20, lg: 'en', h: '', series: [1, 3, 2, 5, 4] })), total: 200, from: 'Nov 10', to: 'Nov 16' };
const REPORT = { chatsBy: { members: 12, visitors: 30 }, from: '2026-11-01', to: '2026-11-07', topTopics: [{ topic: 'deposit', n: 9 }], handedByTopic: [{ topic: 'withdraw', handed: 3, total: 6 }], topKeywords: [{ word: 'depo', n: 5 }], accuracy: { right: 3, wrong: 1, checked: 4, wrongRate: 0.25 }, recent: [{ id: 7, question: 'how to deposit', answer: 'Go to Wallet.', topic: 'deposit', at: '2026-11-12 10:00', verdict: null }], days: 7, total: 100, helped: 70, notUnderstood: 10, handedOver: 15, rude: 5, byDecision: {}, tests: 3, daily: Array.from({ length: 7 }, (_, i) => ({ day: '2026-11-0' + (i + 1), total: 14, helped: 10, notUnderstood: 1, handedOver: 2 })), topAnswers: [{ intent: 'deposit_how', n: 30 }, { intent: 'withdraw_time', n: 12 }], topMissing: [{ text: 'tarik duit lambat', hits: 5 }], prev: { total: 80, helped: 50, notUnderstood: 10, handedOver: 20 }, topicRates: [{ topic: 'deposit', n: 9, rate: 0.8, prevRate: 0.7 }], languages: [{ lang: 'zh', n: 60, notUnderstood: 3 }, { lang: 'en', n: 40, notUnderstood: 7 }], reasons: [{ reason: 'Customer asked for a person', n: 9 }] };
let botMode: 'listening' | 'answering' = 'answering';
let testsOverride: { results: object[]; pass: number; total: number } | null = null;     // what the sample-message check returns, when a test needs something else
let autoTr = false;                                     // automatic translation of the merchants (off in most tests, so they see no extra changes)
let defA: string | undefined;                          // the main language of LuckyPay (undefined: English)
let langsA: string | null = null;                       // the languages LuckyPay has switched on (null: it never chose)
let importedMsgs: { chat: string; from: string; text: string }[] = [];
const LEARN = () => ({ mode: botMode, since: '2026-11-01T00:00:00Z', days: 12, pairs: 40, chats: 18, withReply: 31, groups: [
  { key: 'topic:deposit', kind: 'topic', label: 'deposit', topic: 'deposit', intent: null, count: 14, withReply: 12, customers: [{ text: 'deposit not in yet', n: 6 }, { text: 'depo pending', n: 3 }], replies: [{ text: 'Please send your receipt, we check in 5 min.', n: 9 }] },
  { key: 'kb:withdraw_time', kind: 'covered', label: 'withdraw_time', topic: 'withdraw', intent: 'withdraw_time', count: 5, withReply: 5, customers: [{ text: 'how long withdraw', n: 5 }], replies: [{ text: 'About 30 minutes.', n: 5 }] }] });
const CHOICES = [{ id: 1, text: 'tng', intent: 'dep_how', hits: 3 }, { id: 2, text: 'put money in', intent: 'dep_time', hits: 1 }];
let setupDone = false;
const SETUP = () => (setupDone
  ? { done: 6, total: 6, items: [{ key: 'login', title: 'Staff login', state: 'done', detail: '1 staff login can sign in to the panel.' }] }
  : { done: 2, total: 5, items: [
    { key: 'login', title: 'Staff login', state: 'done', detail: '1 staff login can sign in to the panel.' },
    { key: 'key', title: 'Bot key', state: 'todo', detail: 'No bot key yet. LiveChat cannot use the bot.', action: { to: 'key', label: 'Make key' } },
    { key: 'livechat', title: 'LiveChat calls the bot', state: 'todo', detail: 'Make the bot key first, then put it into LiveChat.', action: { to: 'livechat', label: 'Show the address and key' } },
    { key: 'answers', title: 'Answers', state: 'todo', detail: 'No answers yet, so the bot hands every question to a person. Load the starter pack in Import (Starter packs).', action: { to: 'imp', label: 'Open Import' } },
    { key: 'tried', title: 'Tried it', state: 'done', detail: '3 chats so far (tests and real customers).' },
  ] });
const CONN = () => ({ setup: SETUP(), merchant: { code: 'A', name: 'LuckyPay', language: 'en', tone: 'friendly', entries: 11, logins: ['luckypay'] }, livechat: { baseUrl: 'http://localhost:3000', askUrl: 'http://localhost:3000/api/v1/ai/ask', keys: [], stoppedKeys: 0, liveChats7d: 4, lastLiveChat: null },
  ai: { anthropic: { provider: 'anthropic', configured: true, last4: 'wxyz', updatedAt: '2026-11-12T08:00:00Z', updatedBy: 'admin', using: 'merchant' }, openai: { provider: 'openai', configured: false, last4: null, updatedAt: null, updatedBy: null, using: 'none' } } });
const BILL = () => ({ from: '2026-11-01', to: '2026-11-12', markupPct: 20,
  merchants: [{ code: 'A', name: 'LuckyPay', chats: 40, calls: 120, inputTokens: 900000, outputTokens: 60000, totalTokens: 960000, cost: 0.12, charge: 0.144, ownKeyCalls: 5, ownKeyTokens: 3000, unpricedCalls: 0 },
    { code: 'B', name: 'SwiftWallet', chats: 12, calls: 3, inputTokens: 1000, outputTokens: 100, totalTokens: 1100, cost: 0, charge: 0, ownKeyCalls: 0, ownKeyTokens: 0, unpricedCalls: 3 }],
  totals: { chats: 52, calls: 123, inputTokens: 901000, outputTokens: 60100, totalTokens: 961100, cost: 0.12, charge: 0.144, ownKeyCalls: 5, ownKeyTokens: 3000, unpricedCalls: 3 },
  byKind: [{ kind: 'pick', calls: 120, totalTokens: 960000, cost: 0.12 }], unpricedModels: [{ provider: 'openai', model: 'gpt-new', calls: 3, tokens: 1100 }],
  prices: [{ provider: 'anthropic', model: 'claude-haiku-5-5', inputPerMTok: 0.1, outputPerMTok: 0.5, updatedBy: 'system', updatedAt: '2026-11-01T00:00:00Z' }] });
let peopleBig = false;                                                                               // many merchants and logins, for the search and the role filter
const BIG_PEOPLE = { merchants: ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'].map((n, i) => ({ code: 'M' + i, name: n, tone: 'friendly', entries: 5 + i, logins: [n.toLowerCase()], link: i ? { hasKey: true, lastUsedAt: null } : { hasKey: false, lastUsedAt: null } })), users: [{ username: 'admin', role: 'admin', merchant: null }, { username: 'boss', role: 'admin', merchant: null }, ...['alpha', 'bravo', 'charlie'].map((u, i) => ({ username: u, role: 'staff', merchant: 'M' + i }))] };
let lcRefuse = false;                                                                                // the LiveChat stand-in refuses a file
let lcLines: { from: string; sender: string; text: string }[] = [];
const lcReply = (init?: RequestInit) => {                                                          // a stand-in for the LiveChat test route
  const text = String(JSON.parse(String(init?.body ?? '{}')).text ?? '');
  if (text) lcLines = [...lcLines, { from: 'customer', sender: 'visitor', text }, { from: 'bot', sender: 'ai', text: 'Go to Wallet > Deposit.' }];
  return { conversationId: lcLines.length ? 'c1' : null, status: lcLines.length ? 'open' : null, handoff: lcLines.length ? 'none' : null, messages: lcLines, replied: !!text };
};
const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
const open = (role: 'admin' | 'staff', route = '/admin/kw', translate = true) => {
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => (lcRefuse && url === '/api/admin/livechat-chat' && String(init?.body).includes('"file"')
    ? Promise.resolve(new Response(JSON.stringify({ error: 'LiveChat refused this file: "Unsupported attachment type." It received a.png.' }), { status: 502, headers: { 'content-type': 'application/json' } })) : json(url.startsWith('/api/admin/livechat-chat/probe') ? { rows: [{ label: 'JPG picture', ok: true, answer: 'accepted' }, { label: 'WebP picture', ok: false, answer: 'Unsupported attachment type.' }] } : url.startsWith('/api/admin/livechat-chat') ? lcReply(init) : url.startsWith('/api/admin/billing') ? (url.includes('/price') || url.includes('/markup') ? { saved: true } : BILL()) : url.includes('/connection') ? CONN() : url.includes('/bot-key') ? { key: 'aib_FRESHKEY1234567890' } : url.startsWith('/api/admin/state') ? { ...state(role), ai: { ...state(role).ai, translate, suggest: translate, draft: translate } } : url.startsWith('/api/admin/suggest-questions') ? { questions: ['how to top up', 'depo how ah', 'cara deposit'] } : url.startsWith('/api/admin/translate') ? { answer: 'Pergi ke Wallet > Deposit.', examples: ['depo macam mana'] }
    : /\/merchants\/[^/]+\/basics/.test(url) ? BASICS
    : /\/merchants\/[^/]+\/livechat/.test(url) ? { configured: true, baseUrl: 'http://lc.test', email: 'a@b.test', handoffAfterReplies: 4, syncedAt: '2026-11-12T08:00:00Z', error: null }
    : url.startsWith('/api/admin/unmatched/resolve') ? { ok: true, changed: 1 }
    : url.startsWith('/api/admin/unmatched') ? UNMATCHED
    : url.startsWith('/api/admin/people') ? (peopleBig ? BIG_PEOPLE : { merchants: [{ code: 'A', name: 'LuckyPay', tone: 'friendly', entries: 11, logins: ['luckypay'], link: { hasKey: false, lastUsedAt: null } }], users: [{ username: 'u', role: 'admin', merchant: null }, { username: 'amy', role: 'staff', merchant: 'B' }] })
    : url.startsWith('/api/admin/learning/choices/resolve') ? { changed: 1 }
    : url.startsWith('/api/admin/learning/choices') ? CHOICES
    : url === '/api/admin/learning/draft-answer' ? { answer: 'Deposits are usually credited within 5 minutes.' }
    : url === '/api/admin/learning/import' ? ((importedMsgs = JSON.parse(String(init?.body)).messages), { chats: 2, pairs: 3, withReply: 2 })
    : url.startsWith('/api/admin/learning') ? LEARN()
    : /\/merchants\/[^/]+\/mode/.test(url) ? ((botMode = JSON.parse(String(init?.body)).mode), { ok: true })
    : url.startsWith('/api/admin/report') ? REPORT
    : url.startsWith('/api/admin/publish') ? { published: [{ scope: 'merchant', code: 'A', ver: 4 }] }
    : url.startsWith('/api/admin/translate') ? { answer: 'Translated answer', examples: ['translated question'] }
    : url.startsWith('/api/admin/ranking') ? RANKING
    : url.startsWith('/api/admin/keywords?') ? [{ w: 'dep', lg: 'en', n: 5, ignored: false, h: '' }, { w: 'deposit', lg: 'en', n: 9, ignored: false, h: '' }, { w: '充值', lg: 'zh', n: 2, ignored: false, h: '' }, { w: 'xyzzy', lg: 'en', n: 3, ignored: false, h: '' }]
    : url.startsWith('/api/admin/tests') ? (testsOverride ?? { results: [{ merchant: 'A', message: 'depo how', expected: 'ANSWER', got: 'HANDOFF', ok: false }, { merchant: 'A', message: 'wd', expected: 'CHOICE', got: 'CHOICE', ok: true }], pass: 1, total: 2 }) : []))));
  return render(<MemoryRouter initialEntries={[route]}><Routes><Route path="/admin/*" element={<Admin />} /></Routes></MemoryRouter>);
};

beforeEach(() => { defA = undefined; autoTr = false; botMode = 'answering'; localStorage.clear(); localStorage.setItem('topicsView', 'list'); localStorage.setItem('kbView', 'list'); withKb = false; setupDone = false; lcLines = []; lcRefuse = false; peopleBig = false; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Control panel', () => {
  it('lets an admin choose the merchant', async () => {
    open('admin');
    expect((await screen.findAllByText('LuckyPay')).length).toBeGreaterThan(0);
    expect(document.querySelector('select#merchant')).not.toBeNull();
    expect(screen.getByText('Merchants & logins')).toBeTruthy();
  });
  it('locks staff to their own merchant and hides the admin screen', async () => {
    open('staff');
    expect((await screen.findAllByText('SwiftWallet')).length).toBeGreaterThan(0);
    expect(document.querySelector('select#merchant')).toBeNull();
    expect(screen.queryByText('Merchants & logins')).toBeNull();
    expect(screen.getByText(/Staff · SwiftWallet/)).toBeTruthy();
  });
  it('turns a typed change into a draft that can be published, and keeps it after a refresh', async () => {
    const { unmount } = open('admin');
    const publish = (await screen.findByRole('button', { name: /^Publish/ })) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    await userEvent.click(screen.getByText('＋ Add a topic or keyword'));
    await userEvent.type(screen.getByPlaceholderText('e.g. depoo'), 'depoo');
    await userEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);
    expect((screen.getByRole('button', { name: /^Publish/ }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('Draft · 1 change')).toBeTruthy();
    unmount(); open('admin');
    expect(await screen.findByText('Draft · 1 change')).toBeTruthy();
  });
  it('does not add a word that already exists', async () => {
    open('admin');
    await userEvent.click(await screen.findByText('＋ Add a topic or keyword'));
    await userEvent.type(screen.getByPlaceholderText('e.g. depoo'), 'deposit');
    await userEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);
    expect(await screen.findByText(/already a short form of "deposit"/)).toBeTruthy();
    expect((screen.getByRole('button', { name: /^Publish/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('automatic translation: saving an entry fills the empty languages with the AI (marked AI draft), and there is no translate button', async () => {
    autoTr = true; open('admin', '/admin/kb');
    await userEvent.click(await screen.findByRole('button', { name: 'Add entry' }));
    expect(screen.queryByRole('button', { name: /Translate/ })).toBeNull();                                // nothing to click: it happens when you save
    await userEvent.type(screen.getByPlaceholderText('e.g. daily_withdraw_limit'), 'wallet_deposit');
    await userEvent.type(document.querySelector('.pane textarea') as HTMLTextAreaElement, 'Go to Wallet > Deposit.');
    await userEvent.selectOptions(screen.getByLabelText(/Topic \(required\)/), 'deposit');
    await userEvent.click(screen.getByRole('button', { name: 'Save and publish' }));
    expect(await screen.findByText(/Translated into MS, ZH \(AI draft\)/)).toBeTruthy();
  });
  it('automatic translation does nothing when the switch is off or the AI is off', async () => {
    open('admin', '/admin/kb');                                                                               // the switch is off in this test
    await userEvent.click(await screen.findByRole('button', { name: 'Add entry' }));
    await userEvent.type(screen.getByPlaceholderText('e.g. daily_withdraw_limit'), 'plain_one');
    await userEvent.type(document.querySelector('.pane textarea') as HTMLTextAreaElement, 'Go to Wallet > Deposit.');
    await userEvent.selectOptions(screen.getByLabelText(/Topic \(required\)/), 'deposit');
    await userEvent.click(screen.getByRole('button', { name: 'Save and publish' }));
    expect(await screen.findByText(/^Saved/)).toBeTruthy(); expect(screen.queryByText(/AI draft/)).toBeNull();
    cleanup(); autoTr = true; open('admin', '/admin/kb', false);                                              // the switch is on, the AI is off
    await userEvent.click(await screen.findByRole('button', { name: 'Add entry' }));
    await userEvent.type(screen.getByPlaceholderText('e.g. daily_withdraw_limit'), 'plain_two');
    await userEvent.type(document.querySelector('.pane textarea') as HTMLTextAreaElement, 'Go to Wallet > Deposit.');
    await userEvent.selectOptions(screen.getByLabelText(/Topic \(required\)/), 'deposit');
    await userEvent.click(screen.getByRole('button', { name: 'Save and publish' }));
    expect(await screen.findByText(/^Saved/)).toBeTruthy(); expect(screen.queryByText(/AI draft/)).toBeNull();
  });
  it('a merchant that switched a language off gets no translation into it', async () => {
    autoTr = true; langsA = 'en,ms,vi,th';
    try {
      open('admin', '/admin/kb');
      await userEvent.click(await screen.findByRole('button', { name: 'Add entry' }));
      await userEvent.type(screen.getByPlaceholderText('e.g. daily_withdraw_limit'), 'lang_check');
      await userEvent.type(document.querySelector('.pane textarea') as HTMLTextAreaElement, 'Go to Wallet > Deposit.');
      await userEvent.selectOptions(screen.getByLabelText(/Topic \(required\)/), 'deposit');
      await userEvent.click(screen.getByRole('button', { name: 'Save and publish' }));
      expect(await screen.findByText(/Translated into MS, VI, TH \(AI draft\)/)).toBeTruthy();             // not Chinese: this merchant switched it off
    } finally { langsA = null; }
  });
  it('Knowledge base → Languages tab: country, timezone and the switch (admin), and Translate all with a count first', async () => {
    autoTr = true; open('admin', '/admin/kb');
    await userEvent.click(await screen.findByRole('button', { name: 'Languages' }));
    expect(await screen.findByText('Languages for LuckyPay')).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('Country'), 'MY');
    expect((screen.getByLabelText('Timezone') as HTMLInputElement).value).toBe('Asia/Kuala_Lumpur · UTC+8');
    await userEvent.selectOptions(screen.getByLabelText('Country'), 'VN');                                  // Vietnam: the main language becomes Vietnamese, with English
    expect((screen.getByLabelText(/^Source language/) as HTMLSelectElement).value).toBe('vi');
    expect(screen.getByRole('button', { name: /Vietnamese/ }).getAttribute('aria-pressed')).toBe('true'); expect(screen.getByRole('button', { name: /Chinese/ }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('switch', { name: 'Translate automatically' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save languages' })).toBeTruthy();
    cleanup(); withKb = true; open('staff', '/admin/kb');                                                    // staff: read only, but Translate all works
    await userEvent.click(await screen.findByRole('button', { name: 'Languages' }));
    expect((await screen.findByLabelText('Country') as HTMLSelectElement).disabled).toBe(true); expect(screen.queryByRole('button', { name: 'Save languages' })).toBeNull();
    await userEvent.click(screen.getAllByRole('button', { name: /^Translate all/ })[0]);
    expect(await screen.findByText(/Translate 3 entries into/)).toBeTruthy();                               // it says how much first (the entry that still says TO WRITE is left out)
  });
  it('automatic translation in the table: leaving the source cell fills the empty languages, never a text a person wrote', async () => {
    autoTr = true; withKb = true; localStorage.setItem('kbView', 'table'); open('staff', '/admin/kb');
    const grid = await screen.findByLabelText('Table editor');
    await userEvent.type(within(grid).getByLabelText('Answer MS for dep_how'), 'Pergi ke Dompet.'); await userEvent.tab();     // a person writes the Malay answer of dep_how
    const en = within(grid).getByLabelText('Answer EN for dep_limit') as HTMLTextAreaElement;
    await userEvent.clear(en); await userEvent.type(en, 'RM50 to RM50,000.'); await userEvent.tab();
    expect(await screen.findByText(/Translated into MS, ZH \(AI draft\)/)).toBeTruthy();
    expect((within(grid).getByLabelText('Answer MS for dep_limit') as HTMLTextAreaElement).value).toBe('Pergi ke Wallet > Deposit.');
    expect(within(grid).getAllByText('AI draft · check').length).toBeGreaterThanOrEqual(2);                                        // Malay and Chinese of dep_limit
    expect((within(grid).getByLabelText('Answer MS for dep_how') as HTMLTextAreaElement).value).toBe('Pergi ke Dompet.');          // the person's text stays
    const dh = within(grid).getByLabelText('Answer EN for dep_how') as HTMLTextAreaElement;
    await userEvent.clear(dh); await userEvent.type(dh, 'Open the wallet.'); await userEvent.tab();
    await new Promise((r) => setTimeout(r, 300));
    expect((within(grid).getByLabelText('Answer MS for dep_how') as HTMLTextAreaElement).value).toBe('Pergi ke Dompet.');          // still never overwritten
  });
  it('changing the source text asks before the AI replaces a text a person wrote in another language', async () => {
    autoTr = true; withKb = true; localStorage.setItem('kbView', 'table'); open('staff', '/admin/kb');
    const grid = await screen.findByLabelText('Table editor');
    await userEvent.type(within(grid).getByLabelText('Answer MS for dep_how'), 'Pergi ke Dompet.'); await userEvent.tab();          // a person writes the Malay text
    const en = within(grid).getByLabelText('Answer EN for dep_how') as HTMLTextAreaElement;
    await userEvent.clear(en); await userEvent.type(en, 'Open the wallet now.'); await userEvent.tab();                              // then changes the source text
    const bar = await screen.findByRole('alert');
    expect(bar.textContent).toMatch(/Update MS from it with the AI/);
    expect((within(grid).getByLabelText('Answer MS for dep_how') as HTMLTextAreaElement).value).toBe('Pergi ke Dompet.');            // nothing replaced yet
    await userEvent.click(within(bar).getByRole('button', { name: 'Update' }));
    expect(await screen.findByText(/Updated MS from the new text/)).toBeTruthy();
    expect((within(grid).getByLabelText('Answer MS for dep_how') as HTMLTextAreaElement).value).toBe('Pergi ke Wallet > Deposit.');   // replaced, now an AI draft
    expect(within(grid).getAllByText('AI draft · check').length).toBeGreaterThanOrEqual(1);
  });
  it('Translate all fills every empty language of every entry, one after the other, and says it is done', async () => {
    autoTr = false; withKb = true; open('staff', '/admin/kb');
    await userEvent.click(await screen.findByRole('button', { name: /^Translate all \(3\)/ }));
    expect(await screen.findByText(/Translate 3 entries into Malay, Chinese\? About 6 translations/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Translate' }));
    expect(await screen.findByText('Done: 3 of 3 entries.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Translate all/ })).toBeNull();                                                  // nothing left to translate
  });
  it('Suggest with AI: the AI writes example questions, each needs approval, Approve all adds the rest; without the AI it adds simple variations', async () => {
    open('admin', '/admin/kb');
    await userEvent.click(await screen.findByRole('button', { name: 'Add entry' }));
    await userEvent.click(screen.getByRole('button', { name: 'Suggest with AI' }));
    expect(await screen.findByText('Write the answer first: the AI writes questions that this answer fits.')).toBeTruthy();      // it needs an answer to write questions for
    await userEvent.type(document.querySelector('.pane textarea') as HTMLTextAreaElement, 'Go to Wallet > Deposit.');
    await userEvent.click(screen.getByRole('button', { name: 'Suggest with AI' }));
    expect(await screen.findByText('how to top up')).toBeTruthy(); expect(screen.getByText('AI suggestions · need your approval')).toBeTruthy();
    expect(screen.queryByText(/Example questions \(1\)/)).toBeNull();                                      // nothing is added before approval
    await userEvent.click(within(screen.getByText('how to top up').closest('.it') as HTMLElement).getByRole('button', { name: 'Approve' }));
    expect(screen.getByText(/Example questions \(1\)/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Approve all' }));
    expect(screen.getByText(/Example questions \(3\)/)).toBeTruthy(); expect(screen.queryByText('AI suggestions · need your approval')).toBeNull();
    cleanup(); open('admin', '/admin/kb', false);
    await userEvent.click(await screen.findByRole('button', { name: 'Add entry' }));
    await userEvent.type(screen.getByPlaceholderText('e.g. daily_withdraw_limit'), 'daily_limit');
    await userEvent.click(screen.getByRole('button', { name: 'Suggest with AI' }));
    expect(await screen.findByText('AI suggestions · need your approval')).toBeTruthy();                    // the old simple variations
    expect(screen.getByText('daily limit pls')).toBeTruthy();
  });
  it('Entry editor: a new entry starts Live, and Save publishes at once (no Publish window), and does nothing when a field is missing', async () => {
    open('admin', '/admin/kb');
    await userEvent.click(await screen.findByRole('button', { name: 'Add entry' }));
    expect((screen.getByLabelText(/^Status/) as HTMLSelectElement).value).toBe('live');                            // live first
    expect(screen.queryByRole('button', { name: 'Save to draft' })).toBeNull();   // one button: Save and publish
    await userEvent.click(screen.getByRole('button', { name: 'Save and publish' }));
    expect(await screen.findByText('Give the entry a name first')).toBeTruthy();                                // not saved
    await userEvent.type(screen.getByPlaceholderText('e.g. daily_withdraw_limit'), 'daily_limit');
    await userEvent.type(document.querySelector('.pane textarea') as HTMLTextAreaElement, 'You can withdraw up to MYR 50,000 a day.');
    await userEvent.selectOptions(screen.getByLabelText(/Topic \(required\)/), 'deposit');
    await userEvent.click(screen.getByRole('button', { name: 'Save and publish' }));
    expect(await screen.findByText(/Saved, but the bot cannot use it yet|Saved and live/)).toBeTruthy();         // saved and published, the answer needs example questions to be found
    expect(screen.queryByRole('dialog', { name: 'Publish' })).toBeNull();                                       // no Publish window
  });
  it('Learning: the AI drafts an answer from the staff replies, a person edits it, and it is added as a draft entry', async () => {
    botMode = 'listening'; withKb = true;
    open('admin', '/admin/learn');
    await userEvent.click(await screen.findByRole('button', { name: 'Draft answer with AI' }));
    const box = await screen.findByLabelText('Draft answer') as HTMLTextAreaElement;
    expect(box.value).toBe('Deposits are usually credited within 5 minutes.');
    expect(screen.getByText('Please send your receipt, we check in 5 min. (given 9 times)')).toBeTruthy();       // the staff reply the draft comes from
    await userEvent.clear(box); await userEvent.type(box, 'Usually 5 minutes. Please wait.');
    await userEvent.click(within(screen.getByRole('dialog', { name: 'AI draft answer' })).getByRole('button', { name: 'Add to Knowledge base' }));
    expect(await screen.findByText(/Added “.*” to the Knowledge base as a draft/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /What changed/ }));
    expect([...document.querySelectorAll('.pubbar-list li')].map((x) => x.textContent).join(' ')).toMatch(/from what the bot learned/);
    cleanup(); open('admin', '/admin/learn', false);
    await screen.findByText('What customers asked');
    expect(screen.queryByRole('button', { name: 'Draft answer with AI' })).toBeNull();                    // no AI: no button
  });
  it('Learning: what customers chose is a suggestion; Approve adds it to the answer as an example question (a one-word message also as a keyword), Dismiss only hides it', async () => {
    withKb = true;
    open('staff', '/admin/learn');
    const card = (await screen.findByText('Learned from what customers chose')).closest('.card') as HTMLElement;
    expect(within(card).getByText('tng')).toBeTruthy(); expect(within(card).getByText('put money in')).toBeTruthy(); expect(within(card).getByText('3')).toBeTruthy();
    const row = (w: string) => within(card).getByText(w).closest('tr') as HTMLElement;
    await userEvent.click(within(row('tng')).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/Added “tng” to “dep_how” as an example question and as a keyword/)).toBeTruthy();
    expect(within(card).queryByText('tng')).toBeNull();
    await userEvent.click(within(row('put money in')).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText(/Added “put money in” to “dep_time” as an example question\. Press/)).toBeTruthy();      // not one word: no keyword
    await userEvent.click(screen.getByRole('button', { name: /What changed/ }));
    const lines = [...document.querySelectorAll('.pubbar-list li')].map((x) => x.textContent ?? '');
    expect(lines).toContain('Added example question "tng" to "dep_how" (SwiftWallet)'); expect(lines.some((x) => /Added keyword "tng" to topic/.test(x))).toBe(true);
    expect(lines.some((x) => /Added keyword "put money in"/.test(x))).toBe(false);
  });
  it('Merchant settings: the number of choices can be set from 1 to 5', async () => {
    open('admin', '/admin/set'); localStorage.setItem('settingsTab', 'replies');
    cleanup(); open('admin', '/admin/set');
    const sel = await screen.findByLabelText(/Most choices shown at once/) as HTMLSelectElement;
    expect([...sel.options].map((o) => o.value)).toEqual(['1', '2', '3', '4', '5']);
    await userEvent.selectOptions(sel, '5'); expect(sel.value).toBe('5');
    localStorage.removeItem('settingsTab');
  });
  it('Merchant settings: one button saves the basics and the settings, and Save and publish goes straight on to the Publish window', async () => {
    open('admin', '/admin/set');
    await userEvent.type(await screen.findByLabelText(/^Monthly AI token limit/), '0');
    await userEvent.click(within(screen.getByRole('region', { name: 'Unsaved changes' })).getByRole('button', { name: 'Save to draft' }));
    expect(await screen.findByText('Saved. Press Publish to make it live.')).toBeTruthy();                           // basics and settings in one click
    await userEvent.type(screen.getByLabelText(/^Monthly AI token limit/), '5');                                       // (the fake server keeps no change, so the page still shows one)
    await userEvent.click(screen.getAllByRole('button', { name: 'Save and publish' })[0]);
    expect(await screen.findByRole('dialog', { name: 'Publish' })).toBeTruthy();                                      // the Publish window opens after the save
  });
  it('Publish window: lists only what this change broke; messages that already fail on the live version are counted, not listed', async () => {
    testsOverride = { results: [
      { merchant: 'A', message: 'min dep berapa', expected: 'ANSWER', got: 'CHOICE', ok: false, wasOk: true },                      // broke now
      { merchant: 'A', message: 'hi moi', expected: 'SMALLTALK', got: 'CLARIFY', ok: false, wasOk: false },                       // already failing on the live version
      { merchant: 'A', message: 'saya nak beli kereta', expected: 'HANDOFF', got: 'CLARIFY', ok: false, wasOk: false },
      { merchant: 'A', message: 'wd', expected: 'CHOICE', got: 'CHOICE', ok: true, wasOk: true }], pass: 1, total: 4 };
    try {
      open('admin', '/admin/kw');
      await userEvent.click(await screen.findByText('＋ Add a topic or keyword'));
      await userEvent.type(screen.getByPlaceholderText('e.g. depoo'), 'depoo'); await userEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);
      await userEvent.click(screen.getByRole('button', { name: /^Publish/ }));
      expect(await screen.findByText('This change breaks 1 sample message:')).toBeTruthy();
      expect(screen.getByText(/min dep berapa/)).toBeTruthy();
      expect(screen.queryByText(/hi moi/)).toBeNull(); expect(screen.queryByText(/saya nak beli kereta/)).toBeNull();           // old failures are not listed
      expect(screen.getByText(/2 older sample messages already fail on the live version/)).toBeTruthy();
      testsOverride = { results: [{ merchant: 'A', message: 'hi moi', expected: 'SMALLTALK', got: 'CLARIFY', ok: false, wasOk: false }, { merchant: 'A', message: 'wd', expected: 'CHOICE', got: 'CHOICE', ok: true, wasOk: true }], pass: 1, total: 2 };
      cleanup(); open('admin', '/admin/kw');
      await userEvent.click(await screen.findByText('＋ Add a topic or keyword'));
      await userEvent.type(screen.getByPlaceholderText('e.g. depoo'), 'depoo'); await userEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);
      await userEvent.click(screen.getByRole('button', { name: /^Publish/ }));
      expect(await screen.findByText('✓ Nothing you changed broke a sample message.')).toBeTruthy();                             // green: nothing new
      expect(screen.getByText(/1 older sample message already fails on the live version/)).toBeTruthy();
    } finally { testsOverride = null; }
  });
  it('Topics list: a legend says what the outlined, grey and just-added words mean (not in the flowchart)', async () => {
    localStorage.setItem('topicsView', 'list');
    try {
      open('admin', '/admin/kw');
      const lg = await screen.findByRole('note', { name: 'What the words look like' });
      expect(within(lg).getByText('LuckyPay only')).toBeTruthy(); expect(within(lg).getByText('Shared by all merchants')).toBeTruthy(); expect(within(lg).getByText('Just added to the draft')).toBeTruthy();
      await userEvent.click(screen.getByRole('button', { name: 'Flowchart' }));
      expect(screen.queryByRole('note', { name: 'What the words look like' })).toBeNull();
      await userEvent.click(screen.getByRole('tab', { name: /Greetings/ }));
      expect(screen.queryByRole('note', { name: 'What the words look like' })).toBeNull();                       // only the Topics tab has these words
    } finally { localStorage.removeItem('topicsView'); }
  });
  it('shows the report with the share of messages answered, not understood and handed over', async () => {
    open('admin', '/admin/report');
    expect(await screen.findByText('70%')).toBeTruthy();                          // answered by the bot
    expect(screen.getByText('10%')).toBeTruthy(); expect(screen.getByText('15%')).toBeTruthy();
    expect(screen.getByText(/Include test chat \(3\)/)).toBeTruthy();
  });
  it('has no Not understood page any more: it is not in the menu and the old address goes to the Knowledge base', async () => {
    open('admin', '/admin/unm');
    expect(await screen.findByRole('heading', { name: /Knowledge base/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Not understood/ })).toBeNull();
  });
  it('has no Tests screen in the menu, but publishing still runs the tests and lists the ones that fail', async () => {
    open('admin', '/admin/kw');
    expect(await screen.findByText('Report')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Tests' })).toBeNull();
    await userEvent.click(screen.getByText('＋ Add a topic or keyword'));
    await userEvent.type(screen.getByPlaceholderText('e.g. depoo'), 'depoo');
    await userEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]);
    await userEvent.click(screen.getByRole('button', { name: /^Publish/ }));
    expect(await screen.findByText(/1 of 2 passed/)).toBeTruthy();
    expect(screen.getByText(/should be ANSWER, the bot gave HANDOFF/)).toBeTruthy();
    expect(screen.queryByText(/should be CHOICE/)).toBeNull();                       // only the failed ones are listed
  });
  it('shows the login actions as icon buttons with the words available on hover', async () => {
    open('admin', '/admin/users');
    expect((await screen.findAllByRole('button', { name: 'Open' })).every((b) => b.textContent === '' && b.getAttribute('data-tip') === 'Open')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /^Logins/ }));
    const reset = await screen.findAllByRole('button', { name: 'Change password' });
    expect(reset).toHaveLength(2);                                                       // one per login
    expect(reset[0].textContent).toBe('');                                               // an icon, no words on the button
    expect(reset[0].getAttribute('data-tip')).toBe('Change password');                   // the words show when the mouse is over it
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);           // you cannot delete yourself
  });

  it('opens a merchant page with the LiveChat address, makes a key that is shown once, and keeps AI keys masked', async () => {
    open('admin', '/admin/merchants/A');
    expect(await screen.findByText('LiveChat connection')).toBeTruthy();
    expect((screen.getByDisplayValue('http://localhost:3000') as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByText('Real chats, 7 days')).toBeTruthy();
    expect(screen.getByText('Real chats, 7 days').parentElement?.textContent).toContain('4');
    expect(screen.getByText('No key yet. LiveChat cannot use the bot until you make one.')).toBeTruthy();
    await userEvent.click(screen.getAllByRole('button', { name: 'Make key' })[0]);
    expect(await screen.findByText('Copy this key now. It is shown only once.')).toBeTruthy();
    expect((screen.getByDisplayValue('aib_FRESHKEY1234567890') as HTMLInputElement).readOnly).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'AI & usage' }));                  // the AI keys have their own tab
    expect(screen.getByText('Own key ····wxyz')).toBeTruthy();                                 // only the last 4 characters of a saved AI key
    const save = screen.getByRole('button', { name: 'Save key' }) as HTMLButtonElement;        // ChatGPT has no key yet
    expect(save.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('ChatGPT (OpenAI) key'), 'sk-proj-abcdefghijklmnop');
    expect((screen.getByRole('button', { name: 'Save key' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('keeps the merchant page for admins only', async () => {
    open('staff', '/admin/merchants/B');
    expect(await screen.findByText('Only an admin can use this screen.')).toBeTruthy();
    expect(screen.queryByText('LiveChat connection')).toBeNull();
  });

  it('shows usage and billing per merchant with totals, notes, a CSV link, the markup and the prices', async () => {
    open('admin', '/admin/billing');
    expect(await screen.findByText('Per merchant')).toBeTruthy();
    expect(screen.getAllByText('961,100')).toHaveLength(2);                                    // total tokens: in the tile and in the totals row
    expect(screen.getAllByText('$0.14').length).toBeGreaterThanOrEqual(2);                     // to charge: cost + the markup (tile, LuckyPay and total)
    expect(screen.getByText('Own key: 5 calls')).toBeTruthy();
    expect(screen.getByText('3 calls not priced')).toBeTruthy();
    expect(screen.getByText(/No price set for gpt-new/)).toBeTruthy();                         // tokens counted, price missing
    expect((screen.getByRole('link', { name: 'Download CSV' }) as HTMLAnchorElement).getAttribute('href')).toMatch(/^\/api\/admin\/billing\.csv\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}$/);
    expect((screen.getByLabelText('Markup percent') as HTMLInputElement).value).toBe('20');
    expect((screen.getByRole('button', { name: 'Save markup' }) as HTMLButtonElement).disabled).toBe(true);   // nothing changed yet
    await userEvent.clear(screen.getByLabelText('Markup percent')); await userEvent.type(screen.getByLabelText('Markup percent'), '35');
    expect((screen.getByRole('button', { name: 'Save markup' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('claude-haiku-5-5')).toBeTruthy();
  });
  it('usage and billing: coloured tiles, a badge per merchant with the biggest charge first, and one Pricing card', async () => {
    open('admin', '/admin/billing');
    expect(await screen.findByText('Per merchant')).toBeTruthy();
    expect(document.querySelectorAll('.btiles .rptile').length).toBe(4); expect(document.querySelector('.btiles .rptile.strong')?.textContent).toMatch(/To charge/);
    const names = [...document.querySelectorAll('tbody tr td:first-child b')].map((x) => x.textContent).filter((x) => x === 'LuckyPay' || x === 'SwiftWallet');
    expect(names).toEqual(['LuckyPay', 'SwiftWallet']);                                              // the one that costs most is first
    expect(document.querySelectorAll('.av').length).toBe(2);
    const card = screen.getByRole('heading', { name: 'Pricing' }).closest('.card') as HTMLElement;
    expect(within(card).getByRole('heading', { name: 'Markup' })).toBeTruthy(); expect(within(card).getByRole('heading', { name: 'Prices per model' })).toBeTruthy();
    expect(screen.getByText(/Showing/).textContent).toMatch(/2026-11-0?1.*to.*20/);
  });
  it('keeps usage and billing for admins only, also in the menu', async () => {
    open('staff', '/admin/billing');
    expect(await screen.findByText('Only an admin can use this screen.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Usage & billing' })).toBeNull();                 // not in the menu either
  });

  it('the language filter offers the languages of the merchant (main first), and any other language that has words', async () => {
    open('admin', '/admin/kw');
    const pick = ((await screen.findAllByLabelText('Language')) as HTMLSelectElement[]).find((x) => [...x.options].some((o) => o.textContent === 'All languages'))!;
    expect([...pick.options].map((o) => o.textContent)).toEqual(['All languages', 'English', 'Malay', 'Chinese']);       // a merchant that never chose: English, Malay, Chinese
    cleanup(); langsA = 'en,vi,th,tl'; defA = 'vi';
    try {
      open('admin', '/admin/kw');
      const p2 = ((await screen.findAllByLabelText('Language')) as HTMLSelectElement[]).find((x) => [...x.options].some((o) => o.textContent === 'All languages'))!;
      expect([...p2.options].map((o) => o.textContent).slice(0, 5)).toEqual(['All languages', 'Vietnamese', 'English', 'Thai', 'Filipino']);   // the main language first
    } finally { langsA = null; defA = undefined; }
  });
  it('lets a new merchant use Vietnamese, Thai or Filipino as its main language', async () => {
    open('admin', '/admin/users');
    await userEvent.click(await screen.findByRole('button', { name: /Add merchant/ }));
    const main = (await screen.findByLabelText('Main language')) as HTMLSelectElement;
    expect([...main.options].map((o) => o.value)).toEqual(['en', 'ms', 'zh', 'vi', 'th', 'tl']);
  });

  it('lets staff create a topic of their own merchant, and an admin choose all merchants', async () => {
    const { unmount } = open('staff', '/admin/kw');
    await userEvent.click(await screen.findByText('＋ Add a topic or keyword'));
    expect(await screen.findByText('Create topic')).toBeTruthy();                                  // staff can make a topic now
    expect(screen.getByText(/Each merchant owns its topics/)).toBeTruthy();
    expect(screen.queryByText('All merchants (template)')).toBeNull();                              // but only an admin may change the shared template
    unmount(); open('admin', '/admin/kw');
    await userEvent.click(await screen.findByText('＋ Add a topic or keyword'));
    expect(await screen.findByText('All merchants (template)')).toBeTruthy();
  });
  it('shows every shared keyword inside the card, finds one, and adds a keyword right on the card', async () => {
    open('staff', '/admin/kw');
    await userEvent.click(await screen.findByText('Flowchart'));
    expect(await screen.findByLabelText('Topic deposit')).toBeTruthy();
    expect(screen.getByText('dps')).toBeTruthy(); expect(screen.getByText('depo')).toBeTruthy();   // all of them are in the card (it scrolls)
    expect(screen.queryByLabelText('Remove shared dps')).toBeNull();                           // staff cannot remove shared words
    await userEvent.type(screen.getByLabelText('Add a keyword to deposit'), 'topupz{enter}');
    expect(await screen.findByLabelText('Remove topupz')).toBeTruthy();
  });
  it('the flowchart has a search: topics that do not match fade out, and it says how many match', async () => {
    open('staff', '/admin/kw');
    await userEvent.click(await screen.findByText('Flowchart'));
    expect(await screen.findByLabelText('Topic deposit')).toBeTruthy();
    const faded = () => [...document.querySelectorAll<HTMLElement>('.flow .fc[data-topic], .flow .lane')].filter((x) => x.style.opacity !== '' && Number(x.style.opacity) < 1).length;
    expect(faded()).toBe(0);
    await userEvent.type(screen.getByLabelText('Find in the flowchart'), 'dps');                    // a shared keyword of the deposit topic
    expect(screen.getByText(/^1 of \d+ topics?$/)).toBeTruthy();
    expect((screen.getByLabelText('Topic deposit') as HTMLElement).style.opacity).toBe('');         // the match stays clear
    await userEvent.clear(screen.getByLabelText('Find in the flowchart')); await userEvent.type(screen.getByLabelText('Find in the flowchart'), 'zzzz');
    expect(screen.getByText(/^0 of \d+ topics?$/)).toBeTruthy();
    expect(faded()).toBeGreaterThan(0);                                                              // nothing matches: the topic fades
    await userEvent.clear(screen.getByLabelText('Find in the flowchart'));
    expect(faded()).toBe(0);
  });
  it('opens the add form from the top button also in the flowchart view', async () => {
    open('staff', '/admin/kw');
    await userEvent.click(await screen.findByText('Flowchart'));
    await userEvent.click(screen.getByText('＋ Add a topic or keyword'));
    expect(document.querySelector('.addbox')).not.toBeNull();
  });
  it('adds an answer from the Answer block and shows the If not clear card for a topic', async () => {
    open('staff', '/admin/kw');
    await userEvent.click(await screen.findByText('Flowchart'));
    await userEvent.click(screen.getByRole('button', { name: /Answer/ }));                        // an Answer block (it no longer jumps to Knowledge base)
    await userEvent.type(screen.getByLabelText('New answer name'), 'daily limit');
    await userEvent.type(screen.getByLabelText('Questions customers ask'), 'what is the daily limit');
    await userEvent.type(screen.getByLabelText('New answer text'), 'The limit is 5000.');
    await userEvent.selectOptions(screen.getByLabelText('Topic for the answer'), 'deposit');
    await userEvent.click(screen.getByRole('button', { name: 'Add answer' }));
    expect(await screen.findByText('daily_limit')).toBeTruthy();
    expect(screen.queryByText('draft: bot ignores it')).toBeNull();                               // a canvas answer is live, so the bot uses it after Publish
    expect(document.querySelector('.fc.ho')).toBeNull();                                         // hidden at first
    await userEvent.click(screen.getByRole('button', { name: /If not clear/ }));
    expect(document.querySelector('.fc.ho')).not.toBeNull();
  });
  it('warns before publishing an answer the bot cannot use yet', async () => {
    open('staff', '/admin/kb');
    await userEvent.click(await screen.findByText('Add entry'));
    await userEvent.type(screen.getByPlaceholderText('e.g. daily_withdraw_limit'), 'promo_two');
    expect(screen.getByText(/Before the bot can use this answer/)).toBeTruthy();                // the checklist shows what is missing
    expect(screen.getByText(/no example questions/i)).toBeTruthy();
  });
  it('folds the blocks panel away by its title bar and brings it back', async () => {
    open('staff', '/admin/kw');
    await userEvent.click(await screen.findByText('Flowchart'));
    const bar = screen.getByRole('button', { name: /Add a block/ });
    expect(bar.getAttribute('aria-expanded')).toBe('true'); expect(screen.getByRole('button', { name: /Topic.*what the customer wants/ })).toBeTruthy();
    await userEvent.click(bar);
    expect(screen.getByRole('button', { name: /Add a block/ }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: /Topic.*what the customer wants/ })).toBeNull();
    const rail = screen.getByRole('group', { name: 'Blocks (folded)' });                              // folded: a thin rail with the four block icons
    expect(['Topic', 'Keyword', 'Answer', 'If not clear'].every((n) => within(rail).queryByRole('button', { name: n }))).toBe(true);
    await userEvent.click(within(rail).getByRole('button', { name: 'Keyword' }));                     // a block can be added from the rail
    expect(await screen.findByLabelText('New keyword')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Add a block/ }));
    expect(screen.getByRole('button', { name: /Topic.*what the customer wants/ })).toBeTruthy();
    for (const gone of [/Auto-arrange/, /Hide blocks/, /Show blocks/]) expect(screen.queryByRole('button', { name: gone })).toBeNull();      // the old buttons are gone
    expect(screen.queryByRole('switch', { name: /If not clear/ })).toBeNull();
  });
  it('the Flowchart tab comes first and is what opens, and a keyword that is only in the draft looks different from a live one', async () => {
    localStorage.removeItem('topicsView');
    open('staff', '/admin/kw');
    expect(await screen.findByLabelText('Topic deposit')).toBeTruthy();                                // the flowchart opens by itself
    const tabs = [...document.querySelectorAll('[aria-label="View"] button')].map((x) => x.textContent); expect(tabs).toEqual(['Flowchart', 'List']);
    expect(document.querySelector('.fc.tp .tag.lvt')?.textContent).toBe('LIVE');                       // the deposit topic is published
    expect(document.querySelector('.kc.nl')).toBeNull();
    await userEvent.type(screen.getByLabelText('Add a keyword to deposit'), 'topupz{enter}');
    const fresh = [...document.querySelectorAll('.kc.nl')].map((x) => x.textContent); expect(fresh.some((x) => x?.includes('topupz'))).toBe(true);   // new in the draft: amber
    expect(document.querySelector('.kc.sh:not(.nl)')).toBeTruthy();                                    // the published words stay as they were
  });
  it('deletes an answer from its card in the flowchart', async () => {
    open('staff', '/admin/kw');
    await userEvent.click(await screen.findByText('Flowchart'));
    await userEvent.click(screen.getByRole('button', { name: /Answer/ }));
    await userEvent.type(screen.getByLabelText('New answer name'), 'temp one');
    await userEvent.type(screen.getByLabelText('Questions customers ask'), 'temp question');
    await userEvent.type(screen.getByLabelText('New answer text'), 'temp text');
    await userEvent.selectOptions(screen.getByLabelText('Topic for the answer'), 'deposit');
    await userEvent.click(screen.getByRole('button', { name: 'Add answer' }));
    expect(await screen.findByText('temp_one')).toBeTruthy();
    const yes = vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(screen.getByLabelText('Delete answer temp_one'));
    expect(screen.queryByText('temp_one')).toBeNull();
    yes.mockRestore();
  });
  it('Topics: the tabs show counts and have no intro lines, and Greetings, Fillers and Block lists have a "How it works" picture', async () => {
    open('staff', '/admin/kw');
    const tabs = await screen.findByRole('tablist');
    expect(screen.queryByText(/A main keyword \(topic\) and the words that point to it/)).toBeNull();                 // the Topics tab has no intro line
    expect(within(tabs).getByRole('tab', { name: /Fillers/ }).textContent).toMatch(/Fillers\d/);                       // a count on every tab
    await userEvent.click(within(tabs).getByRole('tab', { name: /Block lists/ }));
    expect(screen.queryByText(/make the bot reply carefully, refuse, or hand the chat to a person/)).toBeNull();          // no intro line on any tab
    await userEvent.click(screen.getByRole('button', { name: 'How it works' }));
    const how = await screen.findByLabelText('How it works');
    expect(within(how).getByText('Hand to a person')).toBeTruthy(); expect(within(how).getByText('Refuse politely')).toBeTruthy();
    expect(screen.queryByLabelText('Filter words')).toBeNull();                                                      // the picture has nothing to filter
    await userEvent.click(within(tabs).getByRole('tab', { name: /Fillers/ }));
    expect(within(await screen.findByLabelText('How it works')).getByText('Dropped before matching')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(screen.getByLabelText('Filter words')).toBeTruthy();
  });
  it('LiveChat test: shows what an agent writes in LiveChat without a refresh, and can chat as a guest', async () => {
    open('admin', '/admin/lchat');
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    expect(screen.getByLabelText('The customer is')).toBeTruthy();                                  // the bot only notes: member (with the id) or visitor
    await userEvent.selectOptions(screen.getByLabelText('The customer is'), 'guest');
    expect(screen.queryByLabelText(/Member id/)).toBeNull();
    expect(screen.getByText(/Customer: not logged in/)).toBeTruthy();
    lcLines = [{ from: 'agent', sender: 'operator', text: 'Hello, this is an agent.' }];            // written in LiveChat, not in this page
    expect(await screen.findByText('Hello, this is an agent.', {}, { timeout: 5000 })).toBeTruthy();   // the page looks again by itself
  }, 10000);
  it('merchant page: has no Account data step, because the bot does not read customer information', async () => {
    open('admin', '/admin/merchants/A');
    expect(await screen.findByText('Human Handoff')).toBeTruthy();
    expect(screen.queryByText('Account data')).toBeNull(); expect(screen.queryByText('Sample customers only')).toBeNull();
    expect(screen.queryByText(/What the merchant's API must provide/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'AI & usage' })); expect(screen.getByText('AI keys')).toBeTruthy();
  });
  it('LiveChat test: shows a picture an agent sent, and a plain link when it is not a picture', async () => {
    open('admin', '/admin/lchat');
    lcLines = [{ from: 'agent', sender: 'operator', text: 'MMU.JPG', attachment: { kind: 'image', name: 'MMU.JPG', url: 'http://lc.test/uploads/a.jpg', mimeType: 'image/jpeg', size: 92571 } },
      { from: 'agent', sender: 'operator', text: 'terms.pdf', attachment: { kind: 'file', name: 'terms.pdf', url: 'http://lc.test/uploads/t.pdf', mimeType: 'application/pdf', size: 2048 } }] as never;
    const img = await screen.findByAltText('MMU.JPG'); expect((img as HTMLImageElement).src).toBe('http://lc.test/uploads/a.jpg');
    expect((screen.getByText(/terms\.pdf/).closest('a') as HTMLAnchorElement).href).toBe('http://lc.test/uploads/t.pdf');
  });
  it('LiveChat test: attaches a picture (shown before sending), refuses a wrong kind, and sends it with Send', async () => {
    open('admin', '/admin/lchat');
    const input = await screen.findByLabelText('Choose a picture or file');
    await userEvent.upload(input, new File(['x'.repeat(2048)], 'slip.png', { type: 'image/png' }));
    expect(screen.getByText(/slip\.png · 2 KB/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false);                 // a file alone is enough
    await userEvent.click(screen.getByRole('button', { name: 'Remove the file' }));
    expect(screen.queryByText(/slip\.png · 2 KB/)).toBeNull();
    fireEvent.change(input, { target: { files: [new File(['x'], 'run.exe', { type: 'application/x-msdownload' })] } });
    expect(await screen.findByText(/This kind of file is not allowed here/)).toBeTruthy();
  });
  it('LiveChat test: the file check lists which kinds LiveChat accepts', async () => {
    open('admin', '/admin/lchat');
    await userEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    await userEvent.click(screen.getByRole('button', { name: /Check which files LiveChat accepts/ }));
    expect(await screen.findByLabelText('Files LiveChat accepts')).toBeTruthy();
    expect(screen.getByText(/WebP picture/)).toBeTruthy(); expect(screen.getByText(/refused, “Unsupported attachment type\.”/)).toBeTruthy();
  });
  it('LiveChat test: when a file is refused, it asks LiveChat which kinds it takes and shows the list', async () => {
    lcRefuse = true; open('admin', '/admin/lchat');
    await userEvent.upload(await screen.findByLabelText('Choose a picture or file'), new File(['x'.repeat(100)], 'a.png', { type: 'image/png' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/LiveChat refused this file/)).toBeTruthy();
    const list = await screen.findByLabelText('Files LiveChat accepts, checked now');
    expect(within(list).getByText(/WebP picture/)).toBeTruthy(); expect(within(list).getByText(/Send one of the accepted kinds/)).toBeTruthy();
  });
  it('Keywords by main keyword: can also show the words of a topic that nobody has typed yet', async () => {
    open('staff', '/admin/store');
    expect(await screen.findByText('◆ deposit')).toBeTruthy();
    expect(screen.queryByText('dps')).toBeNull();                                               // nobody typed "dps"
    await userEvent.click(screen.getByRole('switch', { name: /nobody typed/ }));
    expect(await screen.findByText('dps')).toBeTruthy();
    expect(screen.getAllByTitle('nobody has typed this yet').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('switch', { name: /nobody typed/ }));
    expect(screen.queryByText('dps')).toBeNull();
  });
  it('Keyword ranking: top three, a compact week picker, filters in the heading card, a bar behind each count', async () => {
    open('staff', '/admin/rank');
    expect(await screen.findByRole('heading', { name: /^Keyword ranking/ })).toBeTruthy();
    const week = screen.getByRole('group', { name: 'Week' });
    expect(within(week).getByText('This week')).toBeTruthy(); expect(await within(week).findByText('Nov 10 – Nov 16')).toBeTruthy();
    expect((within(week).getByRole('button', { name: 'Next week' }) as HTMLButtonElement).disabled).toBe(true);      // nothing after this week
    expect((within(week).getByRole('button', { name: 'Previous week' }) as HTMLButtonElement).disabled).toBe(false);
    await screen.findByText('wd');
    const rows = document.querySelectorAll('.card.scroll tbody tr');
    expect(rows.length).toBe(2);                                                                                       // the top three are in the cards above, the table starts at rank 4
    expect(document.querySelectorAll('.card.scroll td.num .mbar').length).toBe(2);
    expect(screen.getByLabelText('Filter keywords').closest('.kwtop')).toBeTruthy();                                 // the filter sits in the heading card, as on Knowledge base and Keywords
    await userEvent.type(screen.getByLabelText('Filter keywords'), 'zzzz');
    expect(await screen.findByText('No keyword matches this filter.')).toBeTruthy();
  });
  it('Merchants and logins: avatars, counts in the titles, a clickable row, a merchant search and a role filter when the lists are long', async () => {
    peopleBig = true; open('admin', '/admin/users');
    expect(await screen.findByRole('heading', { name: /Merchants\s*6/ })).toBeTruthy();
    expect(document.querySelectorAll('.ptable .av').length).toBe(6);                                               // a round badge on every merchant
    const mf = screen.getByRole('group', { name: 'Show merchants' });                                              // filter: all / connected / needs a bot key
    await userEvent.click(within(mf).getByRole('button', { name: /Needs a bot key/ })); expect(document.querySelectorAll('.ptable tbody tr').length).toBe(Number(within(mf).getByRole('button', { name: /Needs a bot key/ }).textContent!.match(/\d+/)![0]));
    await userEvent.click(within(mf).getByRole('button', { name: /^All/ }));
    await userEvent.type(screen.getByLabelText('Find a merchant'), 'zzz');
    expect(await screen.findByText(/No merchant matches “zzz”/)).toBeTruthy();
    await userEvent.clear(screen.getByLabelText('Find a merchant')); await userEvent.type(screen.getByLabelText('Find a merchant'), 'brav');
    expect(screen.getAllByText('Bravo').length).toBeGreaterThan(0); expect(screen.queryByText('Echo')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^Logins/ }));
    expect(await screen.findByRole('heading', { name: /Logins\s*5/ })).toBeTruthy(); expect(document.querySelectorAll('.ptable .av').length).toBe(5);
    const roles = screen.getByRole('group', { name: 'Show logins' });
    await userEvent.click(within(roles).getByRole('button', { name: /Admins/ }));
    expect(screen.queryByText('alpha')).toBeNull(); expect(screen.getByText('boss')).toBeTruthy();
  });
  it('Import: loads the FAQ category starter, shows what it holds, and previews every entry of the pack', async () => {
    open('staff', '/admin/imp');
    await userEvent.click(await screen.findByRole('button', { name: 'Upload a file' }));
    await userEvent.click(await screen.findByRole('button', { name: /Starter packs/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /FAQ category starter/ }));
    expect((screen.getByLabelText('Paste CSV') as HTMLTextAreaElement).value).toMatch(/free_credit_info,free_credit,,en,answer/);
    expect(screen.getByText('What is in the FAQ category starter?')).toBeTruthy();
    expect(screen.getByText(/Not added, because the bot already covers them/)).toBeTruthy();
    expect(await screen.findByRole('button', { name: new RegExp('Import ' + STARTER_ENTRIES + ' entries') })).toBeTruthy();                              // the check step reads all of the pack
  });
  it('Merchant settings: there is no switch for account answers', async () => {
    open('admin', '/admin/set');
    expect(await screen.findByRole('tab', { name: 'General' })).toBeTruthy();
    expect(screen.queryByRole('switch', { name: 'Account answers in LiveChat' })).toBeNull();
  });
  it('Merchant page: the setup checklist shows what is done and what is to do, with a button for each', async () => {
    open('admin', '/admin/merchants/A');
    const card = await screen.findByLabelText('Setup checklist');
    expect(within(card).getByText('2 of 5 done')).toBeTruthy();
    expect(within(card).getByRole('progressbar', { name: 'Setup progress' }).getAttribute('aria-valuenow')).toBe('40');
    for (const t of ['Staff login', 'Bot key', 'LiveChat calls the bot', 'Answers', 'Tried it']) expect(within(card).getByText(t)).toBeTruthy();
    expect(within(card).getByText(/No answers yet, so the bot hands every question to a person/)).toBeTruthy();
    expect(within(card).queryByText(/Account data/)).toBeNull();                                           // no account step: the bot reads no customer data
    expect(within(card).queryByRole('button', { name: 'Open Account data' })).toBeNull();
    expect(within(card).getAllByRole('button').filter((b) => /Make key|Open Import|Show the address/.test(b.textContent ?? '')).length).toBe(3);   // a done step has no button
  });
  it('Merchant page: a button of the checklist opens the right screen for that merchant', async () => {
    open('admin', '/admin/merchants/A');
    await userEvent.click(within(await screen.findByLabelText('Setup checklist')).getByRole('button', { name: 'Open Import' }));
    expect(await screen.findByText(/Import · /)).toBeTruthy();
  });
  it('Merchant page: a finished checklist folds away and can be opened again', async () => {
    setupDone = true; open('admin', '/admin/merchants/A');
    const card = await screen.findByLabelText('Setup checklist');
    expect(within(card).getByText('complete')).toBeTruthy(); expect(within(card).queryByText('Staff login')).toBeNull();
    await userEvent.click(within(card).getByRole('button', { name: 'Show the checklist' }));
    expect(within(card).getByText('Staff login')).toBeTruthy();
    expect(within(card).queryByText(/built-in demo customers/)).toBeNull();
  });
  it('LiveChat test: shows which LiveChat merchant it chats in, and remembers the Tenant id for each merchant', async () => {
    localStorage.setItem('lcTenant:A', '7');                                                        // typed once for this merchant before
    open('admin', '/admin/lchat');
    expect(await screen.findByText(/LiveChat merchant #7/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    const t = screen.getByLabelText(/^Tenant id/) as HTMLInputElement; expect(t.value).toBe('7');
    expect(screen.getByText(/LiveChat picks the bot's merchant by this number, not by the merchant chosen in the sidebar/)).toBeTruthy();
    await userEvent.clear(t); await userEvent.type(t, '9');
    expect(screen.getByText(/LiveChat merchant #9/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Message'), 'hi'); await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Go to Wallet > Deposit.');
    expect(localStorage.getItem('lcTenant:A')).toBe('9');                                           // kept for this merchant
  });
  it('Merchant settings: the admin sets how many times the bot asks again, staff can see it but not change it', async () => {
    const { unmount } = open('admin', '/admin/set');
    await userEvent.click(await screen.findByRole('tab', { name: 'Replies' }));
    const sel = await screen.findByLabelText('Ask again this many times') as HTMLSelectElement;
    expect(sel.value).toBe('1'); expect([...sel.options].map((o) => o.value)).toEqual(['0', '1', '2', '3']); expect(sel.disabled).toBe(false);
    await userEvent.selectOptions(sel, '2');
    expect(within(await screen.findByRole('region', { name: 'Unsaved changes' })).getByText(/Ask again/)).toBeTruthy();                   // listed in the unsaved changes bar
    await userEvent.click(within(screen.getByRole('region', { name: 'Unsaved changes' })).getByRole('button', { name: 'Save to draft' }));
    expect(screen.getByRole('button', { name: /^Publish/ }).textContent).toMatch(/1/);
    unmount(); open('staff', '/admin/set');
    await userEvent.click(await screen.findByRole('tab', { name: 'Replies' }));
    expect((await screen.findByLabelText('Ask again this many times') as HTMLSelectElement).disabled).toBe(true);                         // admin only, like the rude-message limit
  });
  it('Keywords page only shows words: no Add keyword, no action buttons, no tick boxes, and a word still opens its chats', async () => {
    open('staff', '/admin/store');
    expect(await screen.findByRole('heading', { name: /Keywords · / })).toBeTruthy();
    expect(screen.getByText(/This page only shows them/)).toBeTruthy();
    for (const gone of [/Add keyword/, /Make a main keyword/, /Add under one/, /^Ignore$/, /Restore/, /Add to this topic/, /Mark as filler/, /Describe new words with AI/]) expect(screen.queryByRole('button', { name: gone })).toBeNull();
    expect(screen.queryAllByRole('checkbox', { name: /^Select / }).length).toBe(0);
    expect(screen.queryByRole('form', { name: 'Add a keyword' })).toBeNull();
    const word = document.querySelector('.kwlink') as HTMLElement; expect(word).toBeTruthy();
    await userEvent.click(word);
    expect(await screen.findByRole('dialog', { name: 'Keyword chats' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Set…' })).toBeNull();                                      // nothing to change from here
  });
  it('reminds the admin to publish after a draft change, on every screen', async () => {
    open('staff', '/admin/kw');
    await userEvent.click(await screen.findByText('＋ Add a topic or keyword'));
    expect(screen.queryByRole('status', { name: 'Not published yet' })).toBeNull();                                                         // nothing to publish yet
    await userEvent.type(await screen.findByPlaceholderText('e.g. depoo'), 'dpzz{enter}');
    const bar = await screen.findByRole('status', { name: 'Not published yet' });
    expect(bar.textContent).toMatch(/1 change is only in your draft/);
    expect(document.title).toMatch(/^\(1\) Not published/);
    await userEvent.click(within(bar).getByRole('button', { name: 'Review and publish' }));
    expect(await screen.findByText(/Tests on the draft:/)).toBeTruthy();
  });
  it('the left menu folds to icons with a button, keeps its items reachable, and remembers the choice', async () => {
    const { unmount } = open('staff', '/admin/kw');
    const shell = () => document.querySelector('.shell') as HTMLElement;
    await userEvent.click(await screen.findByRole('button', { name: 'Hide the menu' }));
    expect(shell().className).toContain('folded');
    expect(screen.getByRole('button', { name: 'Report' }).getAttribute('title')).toBe('Report');          // icons only, the name shows when the mouse is over one
    expect(screen.getByRole('button', { name: 'Show the menu' }).getAttribute('aria-expanded')).toBe('false');
    expect(localStorage.getItem('sideFolded')).toBe('1');
    unmount(); open('staff', '/admin/kw');
    expect((await screen.findByRole('button', { name: 'Show the menu' })).getAttribute('aria-expanded')).toBe('false');   // still folded after a reload
    await userEvent.click(screen.getByRole('button', { name: 'Show the menu' }));
    expect(shell().className).not.toContain('folded'); expect(screen.getByRole('button', { name: 'Hide the menu' })).toBeTruthy();
  });
  it('Learning: shows the listening state and what was collected, adds a group to the Knowledge base as a draft, and an admin switches to answering after a confirmation', async () => {
    botMode = 'listening'; withKb = true;
    open('admin', '/admin/learn');
    expect(await screen.findByText(/Listening: the bot is silent/)).toBeTruthy();
    expect(screen.getByRole('progressbar', { name: 'Days listening' }).getAttribute('aria-valuenow')).toBe('12');
    expect(screen.getByText('chats seen').previousSibling?.textContent).toBe('18'); expect(screen.getByText('questions saved').previousSibling?.textContent).toBe('40');
    expect(screen.getByText('deposit not in yet')).toBeTruthy(); expect(screen.getByText(/Please send your receipt/)).toBeTruthy();
    expect(screen.getByText(/Already answered: withdraw_time/)).toBeTruthy();                                   // the knowledge base covers this one: no button
    expect(document.querySelector('.vchip.warn')?.textContent).toMatch(/Listening/);                            // also in the top bar, on every page
    await userEvent.click(screen.getByRole('button', { name: 'Add to Knowledge base' }));
    expect(screen.getByText('Added as a draft')).toBeTruthy(); expect(screen.getByRole('button', { name: /^Publish/ }).textContent).toMatch(/1/);
    const list = screen.getByLabelText('Before the bot starts answering');                                  // the checklist: 11 live answers in the fixture, but a draft change waits to be published
    expect(within(list).getByText('Enough live answers')).toBeTruthy(); expect(within(list).getByText(/Everything is published/)).toBeTruthy();
    expect(within(list).getByText(/1 change is only in your draft/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Start answering' }) as HTMLButtonElement).disabled).toBe(true);   // one required step is not done
    await userEvent.click(screen.getByRole('button', { name: 'Start anyway' }));
    const dlg = await screen.findByRole('dialog', { name: 'Change what the bot does' });
    expect(dlg.textContent).toMatch(/replies to customers in LiveChat/); expect(dlg.textContent).toMatch(/Not ready yet/);
    await userEvent.click(within(dlg).getByRole('button', { name: 'Cancel' })); expect(botMode).toBe('listening');   // Cancel changes nothing
    await userEvent.click(screen.getByRole('button', { name: 'Start anyway' }));
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Change what the bot does' })).getByRole('button', { name: 'Start answering' }));
    expect(await screen.findByText(/Answering: the bot replies to customers/)).toBeTruthy(); expect(botMode).toBe('answering');
  });
  it('Learning: learns from a file of old chats: shows what is in it first, leaves out unknown senders, then sends it', async () => {
    open('staff', '/admin/learn');
    const csv = 'chat_id,sender,text,time\nc1,customer,deposit not in yet,2026-10-01 10:00\nc1,staff,Please send your receipt,2026-10-01 10:01\nc2,Visitor,how long withdraw,2026-10-01 11:00\nc2,Operator,30 minutes,2026-10-01 11:02\nc2,robot,ignored line,2026-10-01 11:03\nc2,staff,Anything else?,2026-10-01 11:03';
    await userEvent.upload(await screen.findByLabelText('Choose a file of old chats'), new File([csv], 'chats.csv', { type: 'text/csv' }));
    const note = await screen.findByText(/2 chats, 2 customer messages and 3 staff messages/);
    expect(note.textContent).toMatch(/1 row was left out/);
    await userEvent.click(screen.getByRole('button', { name: 'Learn from this file' }));
    expect(await screen.findByText(/Learned from 2 old chats: 3 questions, 2 with a staff reply/)).toBeTruthy();
    expect(importedMsgs.length).toBe(5); expect(importedMsgs[2]).toMatchObject({ chat: 'c2', from: 'customer', text: 'how long withdraw' });    // "Visitor" is a customer, "Operator" is staff
    expect(screen.queryByRole('button', { name: 'Learn from this file' })).toBeNull();                      // the file was learned: the card is clear again
  });
  it('Learning: a file without the needed columns says which are missing', async () => {
    open('staff', '/admin/learn');
    await userEvent.upload(await screen.findByLabelText('Choose a file of old chats'), new File(['id,msg\n1,hello'], 'bad.csv', { type: 'text/csv' }));
    expect(await screen.findByText(/Missing column: chat_id, sender, text/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Learn from this file' })).toBeNull();
  });
  it('Learning: the checklist shows what is ready, what still says TO WRITE, and marks the learned-questions step as only a hint', async () => {
    botMode = 'listening'; withKb = true;
    open('staff', '/admin/learn');                                                                         // the fixture entries belong to the staff merchant
    const list = await screen.findByLabelText('Before the bot starts answering');
    expect(within(list).getByText(/Enough live answers/)).toBeTruthy(); expect(within(list).getByText(/Learned questions checked/)).toBeTruthy();
    expect(within(list).getByText(/\(optional\)/)).toBeTruthy();
    expect(within(list).getByText(/of 10 ready/)).toBeTruthy();
    expect(within(list).getByText(/1 entry still says TO WRITE/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start answering' })).toBeNull();                          // staff cannot start it
  });
  it('Learning: staff can read it but cannot switch the mode', async () => {
    open('staff', '/admin/learn');
    expect(await screen.findByText(/Only an admin can change this/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start answering' })).toBeNull();
  });
  it('the menu groups the admin items apart, and staff do not see empty groups', async () => {
    const { unmount } = open('admin', '/admin/kw');
    const groups = async () => [...document.querySelectorAll('.nav .grp')].map((g) => [g.querySelector('.gl')?.textContent, [...g.querySelectorAll('button')].map((b) => b.textContent?.replace(/\d+$/, ''))]);
    await screen.findByRole('button', { name: 'Report' });
    const g = await groups();
    expect(g.slice(-3)).toEqual([['Setup', ['Merchant settings', 'History']], ['Connect', ['LiveChat test']], ['Admin', ['Merchants & logins', 'Usage & billing']]]);
    unmount(); open('staff', '/admin/kw'); await screen.findByRole('button', { name: 'Report' });
    const s = (await groups()).map((x) => x[0]); expect(s).toContain('Setup'); expect(s).not.toContain('Connect'); expect(s).not.toContain('Admin');
  });
  it('Chinese: a switch in the top bar changes the menu, the top bar and the pages, remembers the choice, and a text that is not translated stays English', async () => {
    botMode = 'listening';
    const { unmount } = open('admin', '/admin/learn');
    expect(await screen.findByText('Learning · LuckyPay')).toBeTruthy();                                   // English by default
    expect(document.documentElement.lang).toBe('en');
    await userEvent.click(within(screen.getByRole('group', { name: 'Panel language' })).getByRole('button', { name: '中文' }));
    expect(await screen.findByText('学习 · LuckyPay')).toBeTruthy();
    expect(screen.getByRole('button', { name: '知识库' })).toBeTruthy(); expect(screen.getByText('商户设置')).toBeTruthy();   // the menu
    expect(screen.getByText('已发布 v3')).toBeTruthy(); expect(screen.getByRole('button', { name: '发布' })).toBeTruthy();   // the top bar
    expect(screen.getByText('监听中：机器人不回复')).toBeTruthy(); expect(screen.getByText('客户问了什么')).toBeTruthy();   // the page
    expect(document.documentElement.lang).toBe('zh-CN'); expect(localStorage.getItem('panelLang')).toBe('zh');
    unmount(); open('admin', '/admin/learn');
    expect(await screen.findByText('学习 · LuckyPay')).toBeTruthy();                                       // still Chinese after a reload
    await userEvent.click(within(screen.getByRole('group', { name: 'Panel language' })).getByRole('button', { name: 'EN' }));
    expect(await screen.findByText('Learning · LuckyPay')).toBeTruthy();
  });
  it('Chinese: the Knowledge base list is translated', async () => {
    localStorage.setItem('panelLang', 'zh');
    open('admin', '/admin/kb');
    expect(await screen.findByText(/知识库 · LuckyPay/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '添加条目' })).toBeTruthy(); expect(screen.getByRole('button', { name: '表格' })).toBeTruthy();
    expect(screen.getByPlaceholderText('搜索条目或答案')).toBeTruthy(); expect(screen.getByText('答案（英文）')).toBeTruthy();
    localStorage.removeItem('panelLang');
  });
  it('Chinese: the Report page is translated', async () => {
    localStorage.setItem('panelLang', 'zh');
    open('admin', '/admin/report');
    expect(await screen.findByText(/报告 · LuckyPay/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '最近 7 天' })).toBeTruthy(); expect(screen.getByRole('button', { name: '下载 CSV' })).toBeTruthy();
    expect(await screen.findByText('每天的消息数')).toBeTruthy(); expect(screen.getByText('聊天转给真人的原因')).toBeTruthy();
    localStorage.removeItem('panelLang');
  });
  it('Chinese: the Knowledge base entry editor is translated', async () => {
    localStorage.setItem('panelLang', 'zh');
    open('admin', '/admin/kb');
    await userEvent.click(await screen.findByRole('button', { name: '添加条目' }));
    expect(await screen.findByRole('heading', { name: '新条目' })).toBeTruthy();
    expect(screen.getByText('条目名称')).toBeTruthy(); expect(screen.getByText('主题（必填）')).toBeTruthy(); expect(screen.getByText('机器人说什么')).toBeTruthy();
    expect(screen.getByRole('button', { name: '保存并发布' })).toBeTruthy(); expect(screen.getByText('还没有答案文字。')).toBeTruthy();
    localStorage.removeItem('panelLang');
  });
  it('Chinese: the Import page is translated, also the check messages', async () => {
    localStorage.setItem('panelLang', 'zh');
    open('admin', '/admin/imp');
    expect(await screen.findByText(/导入 · LuckyPay/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '上传文件' })).toBeTruthy(); expect(screen.getByText('添加你的条目')).toBeTruthy();
    expect(screen.getByRole('button', { name: '下载 Excel 示例' })).toBeTruthy(); expect(screen.getByRole('button', { name: '清空表格' })).toBeTruthy();
    await userEvent.type(screen.getByLabelText('条目名称，第 1 行'), 'abc');
    expect(await screen.findByText('必须有英文答案')).toBeTruthy();
    localStorage.removeItem('panelLang');
  });
  it('Chinese: the Topics, Keywords and Keyword ranking pages are translated', async () => {
    localStorage.setItem('panelLang', 'zh');
    const { unmount } = open('admin', '/admin/kw');
    expect(await screen.findByText(/主题 · LuckyPay/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /添加主题或关键词/ })).toBeTruthy(); expect(screen.getByRole('tab', { name: /疑问词|问候语/ })).toBeTruthy();
    unmount(); const k = open('admin', '/admin/store');
    expect(await screen.findByText(/关键词 · LuckyPay/)).toBeTruthy(); expect(screen.getByText('听到的词')).toBeTruthy(); expect(screen.getByPlaceholderText('搜索词')).toBeTruthy();
    k.unmount(); open('admin', '/admin/rank');
    expect(await screen.findByText(/关键词排行 · LuckyPay/)).toBeTruthy(); expect(screen.getByText('本周')).toBeTruthy();
    localStorage.removeItem('panelLang');
  });
  it('Chinese: Merchant settings and History are translated', async () => {
    localStorage.setItem('panelLang', 'zh');
    const { unmount } = open('admin', '/admin/set');
    expect(await screen.findByText(/商户设置 · LuckyPay/)).toBeTruthy();
    expect(screen.getByRole('tab', { name: '转人工' })).toBeTruthy(); expect(screen.getByRole('button', { name: '保存到草稿' })).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: '转人工' }));
    expect(await screen.findByText('客户要求真人')).toBeTruthy();
    unmount(); open('admin', '/admin/hist');
    expect(await screen.findByText(/历史版本 · LuckyPay/)).toBeTruthy();
    localStorage.removeItem('panelLang'); localStorage.removeItem('settingsTab');
  });
  it('Chinese: Merchants & logins and the Merchant page are translated', async () => {
    localStorage.setItem('panelLang', 'zh');
    const { unmount } = open('admin', '/admin/users');
    expect(await screen.findByText('每个商户都有自己的答案、词库和设置。打开商户可连接 LiveChat 并设置它的 AI 密钥。')).toBeTruthy();
    expect(screen.getByRole('button', { name: /添加商户/ })).toBeTruthy(); expect(screen.getByRole('columnheader', { name: '今天的聊天' })).toBeTruthy();
    unmount(); open('admin', '/admin/merchants/A');
    expect(await screen.findByLabelText('设置清单')).toBeTruthy(); expect(await screen.findByText('LiveChat 连接')).toBeTruthy();
    localStorage.removeItem('panelLang');
  });
  it('Chinese: Usage & billing and LiveChat test are translated', async () => {
    localStorage.setItem('panelLang', 'zh');
    const { unmount } = open('admin', '/admin/billing');
    expect(await screen.findByRole('button', { name: '本月' })).toBeTruthy();
    expect(await screen.findByText('定价')).toBeTruthy();
    unmount(); open('admin', '/admin/lchat');
    expect(await screen.findByText('通过 LiveChat 以客户身份聊天。你的消息发到 LiveChat，LiveChat 询问你的机器人，回复再按原路返回。这测试的是真实的连接。')).toBeTruthy();
    expect(screen.getByRole('button', { name: '新聊天' })).toBeTruthy();
    localStorage.removeItem('panelLang');
  });
  it('Chinese: the Table view and the change-log lines are translated', async () => {
    localStorage.setItem('panelLang', 'zh'); withKb = true;
    open('admin', '/admin/kb');
    await userEvent.click(await screen.findByRole('button', { name: '表格' }));
    expect(await screen.findByLabelText('表格编辑器')).toBeTruthy(); expect(screen.getByText('示例问题（英文）', { exact: false })).toBeTruthy();
    const { tChange } = await import('./changes');
    expect(tChange('zh', 'Set 3 entries live (LuckyPay)')).toBe('已把 3 个条目设为启用（LuckyPay）');
    expect(tChange('zh', 'Translated entry "dep_limit" into MS, ZH with AI (LuckyPay)')).toBe('已用 AI 把条目“dep_limit”翻译成 MS, ZH（LuckyPay）');
    expect(tChange('zh', 'Added keyword "dp" to topic "deposit" (LuckyPay)')).toBe('已把关键词“dp”添加到主题“deposit”（LuckyPay）');
    expect(tChange('en', 'Set 3 entries live (LuckyPay)')).toBe('Set 3 entries live (LuckyPay)');
    expect(tChange('zh', 'Something new')).toBe('Something new');
    localStorage.removeItem('panelLang'); localStorage.removeItem('kbView');
  });
  it('Import with AI translation keeps the imported entry and its new topic (the translation must not wipe them)', async () => {
    autoTr = true;                                                                                    // automatic translation is on for the merchant (the Import page follows it)
    withKb = true; localStorage.setItem('topicsView', 'list');
    open('admin', '/admin/imp');
    await userEvent.type(await screen.findByLabelText('Entry name, row 1'), 'opening_hours'); await userEvent.type(screen.getByLabelText('Topic, row 1'), 'support');
    await userEvent.type(screen.getByLabelText('Questions, row 1'), 'a | b | c'); await userEvent.type(screen.getByLabelText('Answer, row 1'), 'We are open.');
    await userEvent.click(await screen.findByRole('button', { name: /Import 1 entry to draft/ }));
    expect(await screen.findByText(/Knowledge base · /)).toBeTruthy(); await new Promise((r) => setTimeout(r, 500));
    expect(screen.getByText('opening_hours')).toBeTruthy();                                        // the entry is still there after the translation
    await userEvent.click(screen.getByRole('button', { name: /What changed/ }));
    const lines = [...document.querySelectorAll('.pubbar-list li')].map((x) => x.textContent ?? '');
    expect(lines.some((x) => /Added topic word "support"/.test(x))).toBe(true); expect(lines.some((x) => /AI translated/.test(x))).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Topics' }));
    await waitFor(() => expect(document.querySelector('#kwlists')?.textContent).toMatch(/support/));
    localStorage.removeItem('topicsView');
  });
  it('Import table: a pasted CSV fills the rows, a many-line answer stays one answer, and Clear table empties it', async () => {
    open('admin', '/admin/imp', false);
    const csv = 'intent_key,topic,question_type,language,question_examples,answer_text\nlive_bonus,promotion,,en,"a bonus | b bonus | c bonus","Terms\n👉Valid for new members only.\n🎯Minimum deposit: $30."\n';
    fireEvent.paste(await screen.findByLabelText('Entry name, row 1'), { clipboardData: { getData: () => csv } });
    expect((screen.getByLabelText('Entry name, row 1') as HTMLInputElement).value).toBe('live_bonus');
    expect((screen.getByLabelText('Answer, row 1') as HTMLTextAreaElement).value).toBe('Terms\n👉Valid for new members only.\n🎯Minimum deposit: $30.');
    expect((screen.getByLabelText('Questions, row 1') as HTMLTextAreaElement).value).toBe('a bonus | b bonus | c bonus');
    expect((screen.getByLabelText('Entry name, row 2') as HTMLInputElement).value).toBe('');           // not one row for each line
    fireEvent.paste(screen.getByLabelText('Answer, row 2'), { clipboardData: { getData: () => 'Line one\nLine two\nLine three' } });
    expect((screen.getByLabelText('Answer, row 2') as HTMLTextAreaElement).value).toBe('Line one\nLine two\nLine three');
    expect((screen.getByLabelText('Answer, row 3') as HTMLTextAreaElement).value).toBe('');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await userEvent.click(screen.getByRole('button', { name: 'Clear table' }));
    expect((screen.getByLabelText('Entry name, row 1') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Answer, row 2') as HTMLTextAreaElement).value).toBe('');
    vi.restoreAllMocks();
  });
  it('has a guide for the marketing team, open to staff', async () => {
    open('staff', '/admin/guide');
    expect(await screen.findByRole('heading', { name: /How to import/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download example file' })).toBeTruthy();
    expect(screen.getByText(/Import and publish makes the entries live at once/)).toBeTruthy(); expect(document.querySelectorAll('.gd-list > li').length).toBe(6);
    expect(screen.getByText(/Write in the main language only/)).toBeTruthy(); expect(screen.getByRole('button', { name: 'Open Languages' })).toBeTruthy();
  });
  it('Knowledge base: the Live switch applies at once: no question, no Publish button', async () => {
    withKb = true;
    open('staff', '/admin/kb');
    const sw = (await screen.findAllByRole('switch', { name: /^Live / }))[0] as HTMLInputElement;
    expect(sw.checked).toBe(true);
    await userEvent.click(sw);
    expect(await screen.findByText(/Switched off: “dep_how”/)).toBeTruthy();                           // it was published straight away
    expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.queryByText('Edit entry')).toBeNull();   // no question, and the switch does not open the entry
  });
  it('lets an admin remove a shared keyword from the card', async () => {
    open('admin', '/admin/kw');
    await userEvent.click(await screen.findByText('Flowchart'));
    await userEvent.click(await screen.findByLabelText('Remove shared dps'));
    expect(screen.queryByText('dps')).toBeNull();
  });
  it('shows a flowchart canvas with blocks, adds a topic and a keyword from the block palette, and moves the keyword with the menu; the list shows the same', async () => {
    open('staff', '/admin/kw');
    await userEvent.click(await screen.findByText('Flowchart'));
    expect(await screen.findByTestId('flow')).toBeTruthy();
    expect(screen.getByLabelText('Topic deposit')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /what the customer wants/ }));                                         // a Topic block from the palette
    await userEvent.type(screen.getByLabelText('New topic name'), 'refund{enter}');
    expect(await screen.findByLabelText('Topic refund')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /a word that means a topic/ }));                                      // a Keyword block, connected to a topic
    await userEvent.type(screen.getByLabelText('New keyword'), 'refundlah');
    await userEvent.selectOptions(screen.getByLabelText('Connect keyword to topic'), 'refund');
    expect(await screen.findByLabelText('Remove refundlah')).toBeTruthy();                       // now a real keyword block
    await userEvent.selectOptions(within(screen.getByLabelText('Remove refundlah').closest('.fc') as HTMLElement).getByLabelText('Move refundlah to topic'), 'deposit');           // move it to another topic
    await userEvent.click(screen.getByText('List'));                                          // the list shows the same
    expect((await screen.findAllByText('refundlah')).length).toBeGreaterThan(0);
    expect(screen.queryByTestId('flow')).toBeNull();
  });
  it('shows the handoff number copied from LiveChat on the merchant page, with a button to send a change to LiveChat', async () => {
    open('admin', '/admin/merchants/A');
    expect(await screen.findByText('Human Handoff')).toBeTruthy();
    const box = await screen.findByLabelText('Ask for a person after N replies') as HTMLInputElement;
    expect(box.value).toBe('4');
    expect((screen.getByText('Save to LiveChat') as HTMLButtonElement).disabled).toBe(true);       // nothing to send until the number differs
    await userEvent.clear(box); await userEvent.type(box, '6');
    expect((screen.getByText('Save to LiveChat') as HTMLButtonElement).disabled).toBe(false);
  });
  it('shows the arrows against the period before, the topics, the languages and why chats went to a person', async () => {
    open('staff', '/admin/report');
    expect(await screen.findByText('Top topics, and how well they are answered')).toBeTruthy();
    expect(screen.getByText('▲ 25%')).toBeTruthy();                                                 // 100 messages against 80 before
    expect(screen.getByText('▲ 7 pts')).toBeTruthy();                                              // 70% answered against 63% before
    expect(screen.getByText('80%')).toBeTruthy(); expect(screen.getByText('▲ 10')).toBeTruthy();    // deposit: 80% now, 70% before
    expect(screen.getByText('Chinese')).toBeTruthy(); expect(screen.getByText('Customer asked for a person')).toBeTruthy();
    expect(screen.getByText(/Not understood most in/).textContent).toMatch(/English/);               // 7 of 40 is higher than 3 of 60
    expect(screen.getByText('25%')).toBeTruthy();                                                   // 1 wrong of 4 checked
    expect(screen.getByText(/from logged-in members/).textContent).toMatch(/12 from logged-in members, 30 from visitors/);
    expect(screen.queryByText('Check recent answers')).toBeNull(); expect(screen.queryByText('Fix these first')).toBeNull();       // these two parts are not on the page
    expect(screen.queryByRole('button', { name: 'Wrong' })).toBeNull(); expect(screen.queryByRole('button', { name: 'Add answer' })).toBeNull();
  });
  it('Report: custom dates ask for the report between two days, and Download CSV saves the numbers', async () => {
    open('staff', '/admin/report');
    await userEvent.click(await screen.findByRole('button', { name: 'Custom dates' }));
    const from = screen.getByLabelText('From date') as HTMLInputElement; const to = screen.getByLabelText('To date') as HTMLInputElement;
    expect(from.value).toMatch(/^\d{4}-\d{2}-\d{2}$/); expect(to.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await userEvent.clear(from); await userEvent.type(from, '2026-10-01');
    await waitFor(() => expect((fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.some((c) => String(c[0]).includes('from=2026-10-01&to='))).toBe(true));
    let saved: Blob | null = null;
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b) => { saved = b; return 'blob:x'; }; (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    const text = await (saved as unknown as Blob).text();
    expect(text).toContain('Messages per day'); expect(text).toContain('Customer asked for a person'); expect(text).toContain('tarik duit lambat');
  });
  it('shows details when hovering a day on the chart', async () => {
    open('staff', '/admin/report');
    expect(await screen.findByText('Messages per day')).toBeTruthy();
    expect(screen.queryByRole('tooltip')).toBeNull();
    const days = document.querySelectorAll('.rpchart svg g[tabindex]');
    expect(days.length).toBe(7);
    await userEvent.hover(days[0]);
    expect(screen.getByRole('tooltip').textContent).toMatch(/14/);
  });
  it('Knowledge base: tick entries and set them live or draft in one go, and set every ready draft live with one button', async () => {
    withKb = true; open('staff', '/admin/kb');
    await screen.findAllByRole('checkbox', { name: /^Select (?!all)/ });                                  // wait until the entries are shown
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all shown' }));
    const bar = await screen.findByRole('region', { name: 'Selected entries' });
    const total = Number(/(\d+) selected/.exec(bar.textContent ?? '')?.[1]); expect(total).toBe(4);
    await userEvent.click(within(bar).getByRole('button', { name: 'Set draft' }));
    expect(await screen.findByText('Switched off: 2 entries')).toBeTruthy();                            // the two live ones were switched off and published at once
    expect(screen.queryByRole('region', { name: 'Selected entries' })).toBeNull();                       // the selection is cleared after the action
    const ready = await screen.findByRole('button', { name: /Set \d+ ready drafts? live/ });             // one button for the drafts the bot could use
    expect(ready.textContent).toMatch(/Set 1 ready draft live/);                                         // the one that still says TO WRITE is not offered
    await userEvent.click(ready);
    expect(await screen.findByText(/Live now: “dep_limit”/)).toBeTruthy();
    await userEvent.click(screen.getAllByRole('checkbox', { name: /^Select (?!all)/ })[0]);
    expect((await screen.findByRole('region', { name: 'Selected entries' })).textContent).toMatch(/1 selected/);
    await userEvent.click(screen.getByRole('button', { name: 'Clear' })); expect(screen.queryByRole('region', { name: 'Selected entries' })).toBeNull();
  });
  it('Knowledge base opens as a table by default, with Table first and List second', async () => {
    localStorage.removeItem('kbView'); withKb = true; open('staff', '/admin/kb');
    expect(await screen.findByLabelText('Table editor')).toBeTruthy();
    const view = screen.getByRole('group', { name: 'View' });
    expect(within(view).getAllByRole('button').map((b) => b.textContent)).toEqual(['Table', 'List']);
    expect(within(view).getByRole('button', { name: 'Table' }).getAttribute('aria-pressed')).toBe('true');
  });
  it('Knowledge base table edit: change answers and example questions in place, set live, and see it in the list and in the Publish count', async () => {
    withKb = true; open('staff', '/admin/kb');
    await screen.findAllByRole('checkbox', { name: /^Select (?!all)/ });
    await userEvent.click(screen.getByRole('button', { name: 'Table' }));
    const grid = await screen.findByLabelText('Table editor');
    expect(grid.querySelector('.note')!.textContent).toMatch(/1 entry still says TO WRITE/);                // dep_bonus still says TO WRITE
    expect(within(grid).getByLabelText('Answer EN for dep_bonus').getAttribute('aria-invalid')).toBe('true');
    expect(within(grid).queryByLabelText('Answer EN for dep_how')!.getAttribute('aria-invalid')).toBeNull();
    const en = within(grid).getByLabelText('Answer EN for dep_limit') as HTMLTextAreaElement;
    await userEvent.clear(en); await userEvent.type(en, 'RM50 to RM50,000.'); await userEvent.tab();     // leaving the cell saves it to the draft
    expect(await within(grid).findByText(/Saved to the draft: dep_limit/)).toBeTruthy();
    await userEvent.type(within(grid).getByLabelText('Answer MS for dep_limit'), 'RM50 hingga RM50,000.'); await userEvent.tab();
    const ex = within(grid).getByLabelText('Example questions for dep_limit') as HTMLTextAreaElement;
    await userEvent.clear(ex); await userEvent.type(ex, 'max deposit{enter}min deposit{enter}{enter}deposit limit{enter}max deposit'); await userEvent.tab();   // empty lines and a repeated one are dropped
    expect(screen.getByRole('button', { name: /^Publish/ }).textContent).toMatch(/1/);                    // one entry changed, however many cells
    await userEvent.click(screen.getByRole('button', { name: 'List' }));
    const row = (await screen.findByText('dep_limit')).closest('tr')!;
    expect(row.textContent).toContain('RM50 to RM50,000.');
    expect(row.querySelector('td.num')!.textContent).toBe('3');                                          // three different example questions
    await userEvent.click(within(row).getByRole('switch', { name: 'Live dep_limit' }));                  // the Live switch publishes at once, with no Publish button
    expect(await screen.findByText(/Live now|Switched off/)).toBeTruthy();
  });
  it('Knowledge base table edit: Esc puts the old text back, Ctrl+Enter saves and moves down, and the columns are the languages of the merchant', async () => {
    withKb = true; open('staff', '/admin/kb');
    await screen.findAllByRole('checkbox', { name: /^Select (?!all)/ });
    await userEvent.click(screen.getByRole('button', { name: 'Table' }));
    const grid = await screen.findByLabelText('Table editor');
    const how = within(grid).getByLabelText('Answer EN for dep_how') as HTMLTextAreaElement;
    await userEvent.type(how, ' extra'); await userEvent.keyboard('{Escape}');
    expect(how.value).toBe('Go to Wallet.'); expect(screen.getByRole('button', { name: /^Publish/ }).textContent).not.toMatch(/\d/);   // nothing was saved
    await userEvent.type(how, ' now'); await userEvent.keyboard('{Control>}{Enter}{/Control}');
    expect(document.activeElement).toBe(within(grid).getByLabelText('Answer EN for dep_time'));           // moved down one row, same column
    expect(screen.getByRole('button', { name: /^Publish/ }).textContent).toMatch(/1/);
    expect(within(grid).queryByLabelText('Answer VI for dep_how')).toBeNull();                              // Vietnamese is not one of this merchant's languages
    expect(within(grid).queryByRole('button', { name: 'VI' })).toBeNull();                                  // the columns follow Knowledge base → Languages
    expect(within(grid).getByLabelText('Answer MS for dep_how')).toBeTruthy();
  });
  it('Keyword ranking is view only: a note above, no tick boxes, no actions', async () => {
    open('staff', '/admin/rank');
    expect(await screen.findByText('View only.')).toBeTruthy();
    expect(screen.getByText(/Nothing can be changed here/)).toBeTruthy();
    await screen.findByText('wd');
    expect(screen.queryAllByRole('checkbox', { name: /^Select / })).toHaveLength(0);                       // no tick boxes
    expect(screen.queryByRole('button', { name: /Mark as filler|Exclude|Restore|Suggest topics/ })).toBeNull();
  });
  it('Suggest topics is on the Topics page, for the new words nobody has decided on', async () => {
    open('staff', '/admin/kw');
    expect(await screen.findByRole('button', { name: /^Suggest topics/ })).toBeTruthy();
  });
  it('the Knowledge base table and the list have an Edit button on every entry, so you need not click the name', async () => {
    withKb = true; localStorage.setItem('kbView', 'table'); open('staff', '/admin/kb');
    const grid = await screen.findByLabelText('Table editor');
    await userEvent.click(within(grid).getByRole('button', { name: 'Edit dep_time' }));
    expect(await screen.findByRole('heading', { name: 'Edit entry' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.click(screen.getByRole('button', { name: 'List' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Edit dep_limit' }));
    expect(await screen.findByRole('heading', { name: 'Edit entry' })).toBeTruthy();
  });
  it('the "missing a language" note sits at the right of the Entries / Languages tabs, on the same line', async () => {
    withKb = true; open('staff', '/admin/kb');
    const note = await screen.findByText(/missing a language or examples/);
    expect(note.closest('.kbtabs')).toBeTruthy(); expect(note.closest('.kbtabs')!.querySelector('.segs')).toBeTruthy();
  });
  it('the entry editor of an existing entry has no language tabs and no answer box: the text is edited in the table', async () => {
    withKb = true; open('staff', '/admin/kb');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit dep_time' }));
    expect(await screen.findByRole('heading', { name: 'Edit entry' })).toBeTruthy();
    expect(screen.getByText(/edited in the table/)).toBeTruthy();
    expect(screen.queryByRole('tab')).toBeNull(); expect(document.querySelector('.pane textarea')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add entry' }));                                  // a new entry still has the answer box (one language, no tabs)
    expect(document.querySelector('.pane textarea')).toBeTruthy(); expect(screen.queryByRole('tab')).toBeNull();
  });
  it('Import table: new rows start in the main language of the merchant, and the list offers only its languages', async () => {
    defA = 'vi'; langsA = 'vi,en'; open('admin', '/admin/imp');
    const sel = await screen.findByLabelText('Language, row 1') as HTMLSelectElement;
    expect(sel.value).toBe('vi');
    expect([...sel.options].map((o) => o.value).sort()).toEqual(['en', 'vi']);                              // not all six languages
    expect(screen.getByText(/Write in the main language \(Vietnamese\) first/)).toBeTruthy();
    langsA = null;
  });
  it('the Table / List switch shows only on the Entries tab', async () => {
    withKb = true; open('staff', '/admin/kb');
    expect(await screen.findByRole('group', { name: 'View' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Languages' }));
    expect(screen.queryByRole('group', { name: 'View' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Entries' }));
    expect(screen.getByRole('group', { name: 'View' })).toBeTruthy();
  });
  it('the list shows a dot only for the languages of the merchant, not all six', async () => {
    withKb = true; open('staff', '/admin/kb');
    await userEvent.click(await screen.findByRole('button', { name: 'List' }));
    const row = (await screen.findByText('dep_how')).closest('tr')!;
    expect([...row.querySelectorAll('.dots .dot')].map((d) => d.textContent)).toEqual(['EN', 'MS', 'ZH']);
  });
  it('the table columns are the merchant languages with the main language first', async () => {
    withKb = true; langsA = null; open('staff', '/admin/kb');
    await userEvent.click(await screen.findByRole('button', { name: 'Table' }));
    const grid = await screen.findByLabelText('Table editor');
    expect(within(grid).getAllByRole('columnheader').map((h) => h.textContent).slice(1, 4)).toEqual(['Answer EN', 'Answer MS', 'Answer ZH']);
  });
  it('Import: type entries in a table like Excel, see the check, and the AI translates the empty languages', async () => {
    autoTr = true;                                                                                    // automatic translation is on for the merchant (the Import page follows it)
    open('staff', '/admin/imp');
    await userEvent.type(await screen.findByLabelText('Entry name, row 1'), 'deposit_time');
    await userEvent.type(screen.getByLabelText('Topic, row 1'), 'deposit');
    await userEvent.type(screen.getByLabelText('Questions, row 1'), 'how long | depo late');
    await userEvent.type(screen.getByLabelText('Answer, row 1'), 'Within 5 minutes.');
    expect((await screen.findAllByText('deposit_time')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('new').length).toBeGreaterThan(0);
    expect(screen.getByText(/translations will be made/).textContent).toMatch(/2 translations/);       // Malay and Chinese are empty
    await userEvent.click(screen.getByRole('button', { name: /entry to draft/ }));
    expect(await screen.findByText(/The AI translated 2 answers/)).toBeTruthy();
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls.filter((c) => String(c[0]).startsWith('/api/admin/translate'));
    expect(calls.length).toBe(2); expect(calls.map((c) => JSON.parse(String(c[1].body)).to).sort()).toEqual(['ms', 'zh']);
  });
  it('Import: one sentence explains the AI translation, the Check shows which languages the AI will fill, and the languages come from the merchant settings', async () => {
    autoTr = true;                                                                                    // automatic translation is on for the merchant (the Import page follows it)
    open('staff', '/admin/imp');
    expect(await screen.findByText(/Write in one language only/)).toBeTruthy();
    expect(screen.getByText(/The AI translates the other languages for you/)).toBeTruthy();
    await userEvent.type(screen.getByLabelText('Entry name, row 1'), 'deposit_time');
    await userEvent.type(screen.getByLabelText('Topic, row 1'), 'deposit');
    await userEvent.type(screen.getByLabelText('Questions, row 1'), 'how long | depo late');
    await userEvent.type(screen.getByLabelText('Answer, row 1'), 'Within 5 minutes.');
    expect(await screen.findByText(/EN written/)).toBeTruthy(); expect(screen.getByText('MS by AI')).toBeTruthy(); expect(screen.getByText('ZH by AI')).toBeTruthy();
    expect(screen.getByText(/translations will be made/).textContent).toMatch(/^2 translations/);
    expect(screen.queryByRole('button', { name: 'Chinese' })).toBeNull();                              // no language choice here: the languages come from Knowledge base → Languages
    expect(screen.getByText(/set in Knowledge base → Languages/)).toBeTruthy();
    expect(screen.queryByText('MS is missing')).toBeNull();                                          // the AI will fill it, so it is not a problem
    await userEvent.click(screen.getByRole('switch', { name: /Translate the empty languages with AI/ }));
    expect(await screen.findByText('MS is missing')).toBeTruthy();                                   // with the switch off it is a warning again
    expect((screen.getByText('More options').closest('details') as HTMLDetailsElement).open).toBe(false);   // the two extra options are folded away
  });
  it('Import: the AI translation can be switched off, and then nothing is translated', async () => {
    autoTr = true;                                                                                    // automatic translation is on for the merchant (the Import page follows it)
    open('staff', '/admin/imp');
    await userEvent.type(await screen.findByLabelText('Entry name, row 1'), 'deposit_time');
    await userEvent.type(screen.getByLabelText('Topic, row 1'), 'deposit');
    await userEvent.type(screen.getByLabelText('Questions, row 1'), 'how long | depo late');
    await userEvent.type(screen.getByLabelText('Answer, row 1'), 'Within 5 minutes.');
    await userEvent.click(screen.getByRole('switch', { name: /Translate the empty languages with AI/ }));
    await userEvent.click(screen.getByRole('button', { name: /entry to draft/ }));
    expect(await screen.findByText(/Imported 1 entries to draft/)).toBeTruthy();
    expect((fetch as unknown as { mock: { calls: [string][] } }).mock.calls.some((c) => String(c[0]).startsWith('/api/admin/translate'))).toBe(false);
  });
  it('Import: cells copied from Excel can be pasted into the table', async () => {
    open('staff', '/admin/imp');
    const first = await screen.findByLabelText('Entry name, row 1');
    fireEvent.paste(first, { clipboardData: { getData: () => 'intent_key\ttopic\tlanguage\tquestions\tanswer\nwd_time\twithdraw\tEnglish\thow long wd | wd late\t30 minutes.\nwd_limit\twithdraw\ten\tmax wd\t"MYR 50,000\nper day"' } });
    expect((screen.getByLabelText('Entry name, row 1') as HTMLInputElement).value).toBe('wd_time');      // the header line of the paste is skipped
    expect((screen.getByLabelText('Language, row 1') as HTMLSelectElement).value).toBe('en');
    expect((screen.getByLabelText('Entry name, row 2') as HTMLInputElement).value).toBe('wd_limit');
    expect((screen.getByLabelText('Answer, row 2') as HTMLTextAreaElement).value).toBe('MYR 50,000\nper day');
    expect((await screen.findAllByText('wd_limit')).length).toBeGreaterThan(0);
  });
  it('Import: Excel example and blank file can be downloaded, and an .xlsx file can be uploaded', async () => {
    open('staff', '/admin/imp');
    let saved: Blob | null = null;
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b) => { saved = b; return 'blob:x'; }; (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
    await userEvent.click(await screen.findByRole('button', { name: 'Download Excel example' }));
    const bytes = await new Promise<Uint8Array>((res) => { const fr = new FileReader(); fr.onload = () => res(new Uint8Array(fr.result as ArrayBuffer)); fr.readAsArrayBuffer(saved as unknown as Blob); });
    const rows = readXlsx(bytes);
    expect(rows[0]).toEqual(['intent_key', 'topic', 'language', 'question_examples', 'answer_text']); expect(rows.length).toBe(6); expect(rows.every((r, i) => i === 0 || r[2] === 'en')).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: 'Upload a file' }));
    const file = new File([writeXlsx([rows[0], ['from_excel', 'deposit', 'en', 'how long | depo late', 'Within 5 minutes.']]) as BlobPart], 'my.xlsx');
    await userEvent.upload(screen.getByLabelText('Choose an Excel or CSV file'), file);
    expect(await screen.findByText('my.xlsx')).toBeTruthy(); expect((await screen.findAllByText('from_excel')).length).toBeGreaterThan(0);
  });
  it('Import and publish: imports the entries as live and opens the Publish window', async () => {
    open('staff', '/admin/imp');
    await userEvent.click(await screen.findByRole('button', { name: 'Upload a file' }));
    await userEvent.click(await screen.findByRole('button', { name: /Starter packs/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /FAQ category starter/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Import and publish' }));
    expect(await screen.findByText(/Tests on the draft:/)).toBeTruthy();                                // the Publish window, one click away from live
    expect(screen.getAllByRole('button', { name: /^Publish/ }).length).toBe(2);                         // the top button and the one in the window
  });
  it('lets staff set an entry Type and an end date', async () => {
    open('staff', '/admin/kb');
    await userEvent.click(await screen.findByText('Add entry'));
    expect(await screen.findByLabelText('Type')).toBeTruthy();
    expect(screen.getByLabelText('End date (optional)')).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('Type'), 'promotion');
    expect(screen.getByText(/only true for a while/)).toBeTruthy();
  });
  it('lets staff add up to 3 questions to ask after the answer (guided answer), and warns about an empty English question', async () => {
    open('staff', '/admin/kb');
    await userEvent.click(await screen.findByText('Add entry'));
    await userEvent.click(await screen.findByRole('button', { name: '+ Add a question' }));
    expect(screen.getByLabelText('Question 1 asks for')).toBeTruthy();
    expect(screen.getByText(/has no English text/)).toBeTruthy();                                 // an empty question blocks the green "Ready" note
    await userEvent.type(screen.getByLabelText('Question 1 in EN'), 'Please send the receipt.');
    expect(screen.queryByText(/has no English text/)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '+ Add a question' }));
    await userEvent.selectOptions(screen.getByLabelText('Question 2 asks for'), 'amount');
    await userEvent.click(screen.getByRole('button', { name: '+ Add a question' }));
    expect((screen.getByRole('button', { name: /\+ Add a question/ }) as HTMLButtonElement).disabled).toBe(true);     // the most is 3
    await userEvent.click(screen.getByRole('button', { name: 'Remove question 3' }));
    expect((screen.getByRole('button', { name: /\+ Add a question/ }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('shows the words under a main keyword in groups: short forms, slang, same meaning', async () => {
    open('staff', '/admin/kw');
    await userEvent.click(await screen.findByText('＋ Add a topic or keyword'));
    await userEvent.type(await screen.findByPlaceholderText('e.g. depoo'), 'dp{enter}');                         // a short form of deposit
    expect(await screen.findByText('Short forms')).toBeTruthy();                                            // under the main keyword "deposit", not under a topic called 0
    expect(screen.queryByText(/own topic/)).toBeNull();
    expect(screen.getAllByText(/main keyword/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog', { name: 'Add a topic or keyword' })).toBeNull();                       // the pop-up closed after the word was added
    await userEvent.click(screen.getByText('＋ Add a topic or keyword'));
    expect(screen.getByRole('dialog', { name: 'Add a topic or keyword' })).toBeTruthy();                       // it is a pop-up
    await userEvent.selectOptions(screen.getByLabelText('Kind'), 'slang');
    await userEvent.type(screen.getByPlaceholderText('e.g. depoo'), 'cashin{enter}');
    await screen.findByText('cashin');
    expect(screen.getAllByText('Slang').some((e) => e.className === 'klabel')).toBe(true);                     // a Slang group appeared
  });
  it('shows the words customers typed under their main keyword on the Keywords page, and keeps the plain list too', async () => {
    open('staff', '/admin/store');
    expect(screen.queryByText('By main keyword')).toBeNull();                                    // there is only one view now: no switch
    expect(screen.queryByRole('button', { name: 'List' })).toBeNull();
    expect(await screen.findByText('◆ deposit')).toBeTruthy();                                   // the main keywords show at once
    expect(screen.getAllByText(/^short forms$/i).length).toBeGreaterThan(1);                        // the legend and the column: dep is a short form of deposit
    expect(screen.getAllByText(/^other languages$/i).length).toBeGreaterThan(1);                    // 充值 is Chinese
    expect(screen.getByText(/Not under a topic yet/)).toBeTruthy();                                // xyzzy has no topic yet
    expect(screen.getByText('xyzzy')).toBeTruthy();
  });
  it('shows the stat tiles, the basics and the bot instructions with presets on Merchant settings, and locks the basics for staff', async () => {
    const { unmount } = open('admin', '/admin/set');
    expect(await screen.findByText('Questions today')).toBeTruthy();
    expect(screen.getByText('81%')).toBeTruthy();                                                   // average confidence
    expect((await screen.findByLabelText(/^Monthly AI token limit/) as HTMLInputElement).value).toBe('500000');
    expect(screen.getByText(/Used this month: 12,400/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save basics' })).toBeNull();                                          // one Save for the whole page
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull();                                      // nothing changed yet
    await userEvent.type(screen.getByLabelText(/^Monthly AI token limit/), '0');
    expect(within(screen.getByRole('region', { name: 'Unsaved changes' })).getByText('1 unsaved change')).toBeTruthy();   // a change to the basics counts too
    expect(screen.getByRole('button', { name: 'Open Languages' })).toBeTruthy();                           // the languages moved to Knowledge base → Languages
    expect(((await screen.findByLabelText('Keep conversations for (days)')) as HTMLInputElement).value).toBe('90');   // on the General tab
    await userEvent.click(screen.getByRole('tab', { name: 'AI help' }));
    const box = screen.getByLabelText('Bot instructions') as HTMLTextAreaElement;
    await userEvent.click(screen.getByRole('button', { name: /Formal tone/ }));
    await userEvent.click(screen.getByRole('button', { name: /Max 2 sentences/ }));
    await userEvent.click(screen.getByRole('button', { name: /Formal tone/ }));                       // the same preset is not added twice
    expect(box.value).toBe('- Always use formal, professional language.\n- Keep every translation or reworded reply to 2 sentences at most.');
    expect(screen.getByText('110 / 5000')).toBeTruthy();
    unmount();
    open('staff', '/admin/set');
    await userEvent.click(await screen.findByRole('tab', { name: 'General' }));
    expect(await screen.findByText('Only an admin can change these')).toBeTruthy();
    expect((await screen.findByLabelText(/^Monthly AI token limit/) as HTMLInputElement).disabled).toBe(true);
    await userEvent.click(screen.getByRole('tab', { name: 'AI help' }));
    expect((screen.getByLabelText('Bot instructions') as HTMLTextAreaElement).disabled).toBe(false);   // staff may write the style rules
  });
  it('shows the handoff rules as switches (four locked on), trigger phrases and the retention days', async () => {
    const { unmount } = open('admin', '/admin/set');
    await userEvent.click(await screen.findByRole('tab', { name: 'Handoff' }));
    const complaint = await screen.findByRole('switch', { name: 'Complaint or dispute' }) as HTMLInputElement;
    expect(complaint.checked).toBe(true); expect(complaint.disabled).toBe(false);
    await userEvent.click(complaint); expect(complaint.checked).toBe(false);                      // an admin may switch the rule off
    expect((screen.getByRole('switch', { name: 'Customer asks for a person' }) as HTMLInputElement).disabled).toBe(true);        // always on
    expect((screen.getByRole('switch', { name: 'Same question again, or the bot cannot answer' }) as HTMLInputElement).checked).toBe(true);
    const file = screen.getByRole('switch', { name: 'Picture or file sent' }) as HTMLInputElement; expect(file.checked).toBe(true); expect(file.disabled).toBe(true);        // always on now: a picture goes to a person
    await userEvent.type(screen.getByLabelText('Custom trigger phrases'), 'vip, urgent');
    expect((screen.getByLabelText('Custom trigger phrases') as HTMLInputElement).value).toBe('vip, urgent');
    expect(screen.queryByLabelText('Human group for handoff')).toBeNull();                           // the box is gone: the bot never used the number
    unmount();
    open('staff', '/admin/set');
    await userEvent.click(await screen.findByRole('tab', { name: 'Handoff' }));
    expect(((await screen.findByRole('switch', { name: 'Complaint or dispute' })) as HTMLInputElement).disabled).toBe(true);       // staff cannot switch the rules
    expect((screen.getByLabelText('Custom trigger phrases') as HTMLInputElement).disabled).toBe(false);                            // but may add phrases
    await userEvent.click(screen.getByRole('tab', { name: 'General' }));
    expect(((await screen.findByLabelText('Keep conversations for (days)')) as HTMLInputElement).disabled).toBe(true);
  });
  it('groups the settings in tabs, and shows the unsaved changes in a bar with Discard and Save to draft', async () => {
    open('admin', '/admin/set');
    expect(await screen.findByRole('tab', { name: 'General' })).toBeTruthy();
    for (const t of ['Replies', 'Handoff', 'AI help', 'Messages']) expect(screen.getByRole('tab', { name: t })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Account tools' })).toBeNull();                                                      // the bot reads no customer data
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull();                                                 // nothing changed: no bar
    await userEvent.click(screen.getByRole('tab', { name: 'Handoff' }));
    const complaint = await screen.findByRole('switch', { name: 'Complaint or dispute' }) as HTMLInputElement;
    await userEvent.click(complaint);
    const bar = await screen.findByRole('region', { name: 'Unsaved changes' }); expect(bar.textContent).toContain('1 unsaved change'); expect(bar.textContent).toContain('Complaint or dispute');
    await userEvent.type(screen.getByLabelText('Custom trigger phrases'), 'vip');
    expect(screen.getByRole('region', { name: 'Unsaved changes' }).textContent).toContain('2 unsaved changes');
    await userEvent.click(within(screen.getByRole('region', { name: 'Unsaved changes' })).getByRole('button', { name: 'Discard' }));
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull(); expect((screen.getByRole('switch', { name: 'Complaint or dispute' }) as HTMLInputElement).checked).toBe(true);   // back as it was
    await userEvent.click(screen.getByRole('switch', { name: 'Complaint or dispute' }));
    await userEvent.click(within(screen.getByRole('region', { name: 'Unsaved changes' })).getByRole('button', { name: 'Save to draft' }));
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull();                                                 // saved to the draft: the bar goes away
    expect(await screen.findByText(/Draft/)).toBeTruthy();
  });
  it('has a LiveChat test chat for admins: send a message, see it and the bot reply as bubbles, and start a new chat; staff do not see it', async () => {
    const { unmount } = open('admin', '/admin/lchat');
    expect(await screen.findByRole('heading', { name: 'LiveChat test' })).toBeTruthy();
    expect(await screen.findByText(/No messages yet/)).toBeTruthy();
    const box = screen.getByLabelText('Message') as HTMLInputElement;
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);   // nothing typed
    await userEvent.type(box, 'how to deposit'); await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText('Go to Wallet > Deposit.')).toBeTruthy();                           // the bot's reply, through LiveChat
    expect(screen.getByText('how to deposit')).toBeTruthy(); expect(screen.getByText(/Chat status: open/)).toBeTruthy();
    expect(box.value).toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect((screen.getByLabelText('LiveChat address') as HTMLInputElement).value).toBe('http://localhost:8080');
    expect((screen.getByLabelText(/^Tenant id/) as HTMLInputElement).value).toBe('1');
    lcLines = []; await userEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(await screen.findByText(/No messages yet/)).toBeTruthy();
    unmount();
    open('staff', '/admin/lchat');
    expect(await screen.findByText('Only an admin can use this screen.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'LiveChat test' })).toBeNull();                        // not in the staff menu
  });
});
