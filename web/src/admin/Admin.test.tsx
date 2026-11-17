// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Admin from './Admin';
import { LUCKYPAY_ENTRIES, luckypayCsv, STARTER_ENTRIES } from './starterPack';

const SET = () => ({ tone: 'friendly', handoff_group: 1, answer: 0.72, clarify: 0.45, abuse_close_after: 3, kind: {}, closing: {}, handoff: {}, tools: { deposit_status: true }, max_choices: 3, more_help_on: true, more_help: {}, ai_instructions: '', handoff_complaint: true, handoff_account: true, trigger_phrases: '' });
const BASICS = { retentionDays: 90, name: 'LuckyPay', domain: '', defaultLanguage: 'en', languages: ['en', 'ms', 'zh', 'vi', 'th', 'tl'], monthlyTokenLimit: 500000, tokensMonth: 12400, tokensToday: 300, entries: 11, questionsToday: 7, avgConfidence: 0.81 };
const state = (role: 'admin' | 'staff') => ({
  versions: { A: 3, B: 2 }, sharedVer: 1, stamp: 9, merchants: role === 'admin' ? [{ code: 'A', name: 'LuckyPay' }, { code: 'B', name: 'SwiftWallet' }] : [{ code: 'B', name: 'SwiftWallet' }],
  history: [{ kind: 'merchant', merchant: role === 'admin' ? 'A' : 'B', version: 3, actor: 'admin', summary: 'Edited', ago: 'today' }], user: { username: 'u', role, merchant: role === 'admin' ? null : 'B' }, ai: { pick: false, write: false, describe: false, translate: true },
  snapshot: {
    kb: [], aliases: { deposit: { en: ['deposit', 'dep', 'depo', 'dps'], ms: [], zh: ['充值'] } }, mAliases: { A: [], B: [] }, aspects: {}, smalltalk: {}, guard: { abuse: {}, abuse_soft: {} }, fillers: { en: ['lah'], ms: [], zh: [] },
    settings: { A: SET(), B: SET() },
  },
});
const UNMATCHED = [{ text: 'tarik duit lambat', language: 'ms', hits: 5, resolved: false, resolution: null, first: '2 days ago', last: 'today' }, { text: 'abc xyz', language: 'en', hits: 1, resolved: true, resolution: 'ignored', first: 'x', last: 'y' }];
const RANKING = { rows: ['dep', 'wd', 'lh', 'tolonglh', 'deposit'].map((w, i) => ({ w, n: 50 - i * 9, c: i % 2 ? -12 : 20, lg: 'en', h: '', series: [1, 3, 2, 5, 4] })), total: 200, from: 'Nov 10', to: 'Nov 16' };
const REPORT = { topTopics: [{ topic: 'deposit', n: 9 }], handedByTopic: [{ topic: 'withdraw', handed: 3, total: 6 }], topKeywords: [{ word: 'depo', n: 5 }], accuracy: { right: 3, wrong: 1, checked: 4, wrongRate: 0.25 }, recent: [{ id: 7, question: 'how to deposit', answer: 'Go to Wallet.', topic: 'deposit', at: '2026-11-12 10:00', verdict: null }], days: 7, total: 100, helped: 70, notUnderstood: 10, handedOver: 15, rude: 5, byDecision: {}, tests: 3, daily: Array.from({ length: 7 }, (_, i) => ({ day: '2026-11-0' + (i + 1), total: 14, helped: 10, notUnderstood: 1, handedOver: 2 })), topAnswers: [{ intent: 'deposit_how', n: 30 }, { intent: 'withdraw_time', n: 12 }], topMissing: [{ text: 'tarik duit lambat', hits: 5 }] };
let setupDone = false;
const SETUP = () => (setupDone
  ? { done: 6, total: 6, items: [{ key: 'login', title: 'Staff login', state: 'done', detail: '1 staff login can sign in to the panel.' }, { key: 'account', title: 'Account data (optional)', state: 'optional', detail: 'Not connected. Without it the bot uses 2 built-in demo customers.', action: { to: 'api', label: 'Open Account data' } }] }
  : { done: 2, total: 5, items: [
    { key: 'login', title: 'Staff login', state: 'done', detail: '1 staff login can sign in to the panel.' },
    { key: 'key', title: 'Bot key', state: 'todo', detail: 'No bot key yet. LiveChat cannot use the bot.', action: { to: 'key', label: 'Make key' } },
    { key: 'livechat', title: 'LiveChat calls the bot', state: 'todo', detail: 'Make the bot key first, then put it into LiveChat.', action: { to: 'livechat', label: 'Show the address and key' } },
    { key: 'answers', title: 'Answers', state: 'todo', detail: 'No answers yet, so the bot hands every question to a person. Load the starter pack in Import (Starter packs).', action: { to: 'imp', label: 'Open Import' } },
    { key: 'tried', title: 'Tried it', state: 'done', detail: '3 chats so far (tests and real customers).' },
    { key: 'account', title: 'Account data (optional)', state: 'warn', detail: 'Account answers in LiveChat is ON but no real API is connected: members would get demo balances.', action: { to: 'api', label: 'Open Account data' } }] });
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
    ? Promise.resolve(new Response(JSON.stringify({ error: 'LiveChat refused this file: "Unsupported attachment type." It received a.png.' }), { status: 502, headers: { 'content-type': 'application/json' } })) : json(url.startsWith('/api/admin/livechat-chat/probe') ? { rows: [{ label: 'JPG picture', ok: true, answer: 'accepted' }, { label: 'WebP picture', ok: false, answer: 'Unsupported attachment type.' }] } : url.startsWith('/api/admin/livechat-chat') ? lcReply(init) : url.startsWith('/api/admin/billing') ? (url.includes('/price') || url.includes('/markup') ? { saved: true } : BILL()) : url.includes('/connection') ? CONN() : url.includes('/bot-key') ? { key: 'aib_FRESHKEY1234567890' } : url.startsWith('/api/admin/state') ? { ...state(role), ai: { ...state(role).ai, translate } } : url.startsWith('/api/admin/translate') ? { answer: 'Pergi ke Wallet > Deposit.', examples: ['depo macam mana'] }
    : /\/merchants\/[^/]+\/basics/.test(url) ? BASICS
    : /\/merchants\/[^/]+\/livechat/.test(url) ? { configured: true, baseUrl: 'http://lc.test', email: 'a@b.test', handoffAfterReplies: 4, syncedAt: '2026-11-12T08:00:00Z', error: null }
    : url.startsWith('/api/admin/unmatched/resolve') ? { ok: true, changed: 1 }
    : url.startsWith('/api/admin/unmatched') ? UNMATCHED
    : url.startsWith('/api/admin/people') ? (peopleBig ? BIG_PEOPLE : { merchants: [{ code: 'A', name: 'LuckyPay', tone: 'friendly', entries: 11, logins: ['luckypay'], link: { hasKey: false, lastUsedAt: null } }], users: [{ username: 'u', role: 'admin', merchant: null }, { username: 'amy', role: 'staff', merchant: 'B' }] })
    : url.startsWith('/api/admin/report') ? REPORT
    : url.startsWith('/api/admin/ranking') ? RANKING
    : url.startsWith('/api/admin/keywords?') ? [{ w: 'dep', lg: 'en', n: 5, ignored: false, h: '' }, { w: 'deposit', lg: 'en', n: 9, ignored: false, h: '' }, { w: '充值', lg: 'zh', n: 2, ignored: false, h: '' }, { w: 'xyzzy', lg: 'en', n: 3, ignored: false, h: '' }]
    : url.startsWith('/api/admin/tests') ? { results: [{ merchant: 'A', message: 'depo how', expected: 'ANSWER', got: 'HANDOFF', ok: false }, { merchant: 'A', message: 'wd', expected: 'CHOICE', got: 'CHOICE', ok: true }], pass: 1, total: 2 } : []))));
  return render(<MemoryRouter initialEntries={[route]}><Routes><Route path="/admin/*" element={<Admin />} /></Routes></MemoryRouter>);
};

beforeEach(() => { localStorage.clear(); setupDone = false; lcLines = []; lcRefuse = false; peopleBig = false; });
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
  it('translates the English answer into Malay and Chinese as a draft in the editor, and is switched off without AI', async () => {
    open('admin', '/admin/kb');
    await userEvent.click(await screen.findByRole('button', { name: 'Add entry' }));
    const answer = document.querySelector('.pane textarea') as HTMLTextAreaElement;
    await userEvent.type(answer, 'Go to Wallet > Deposit.');
    await userEvent.click(screen.getByRole('button', { name: 'Translate to Malay and Chinese' }));
    expect(await screen.findByText(/Translated to MS and ZH/)).toBeTruthy();
    await userEvent.click(screen.getByRole('tab', { name: /^MS/ }));
    expect((document.querySelector('.pane textarea') as HTMLTextAreaElement).value).toBe('Pergi ke Wallet > Deposit.');
    expect(screen.getByText('depo macam mana')).toBeTruthy();
    cleanup(); open('admin', '/admin/kb', false);
    await userEvent.click(await screen.findByRole('button', { name: 'Add entry' }));
    expect((screen.getByRole('button', { name: 'Translate to Malay and Chinese' }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('shows the report with the share of messages answered, not understood and handed over', async () => {
    open('admin', '/admin/report');
    expect(await screen.findByText('70%')).toBeTruthy();                          // answered by the bot
    expect(screen.getByText('10%')).toBeTruthy(); expect(screen.getByText('15%')).toBeTruthy();
    expect(screen.getByText('deposit_how')).toBeTruthy();
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
    const reset = await screen.findAllByRole('button', { name: 'Change password' });
    expect(reset).toHaveLength(2);                                                       // one per login
    expect(reset[0].textContent).toBe('');                                               // an icon, no words on the button
    expect(reset[0].getAttribute('data-tip')).toBe('Change password');                   // the words show when the mouse is over it
    expect(screen.getAllByRole('button', { name: 'Delete' })).toHaveLength(1);           // you cannot delete yourself
    expect(screen.getAllByRole('button', { name: 'Open' }).every((b) => b.textContent === '' && b.getAttribute('data-tip') === 'Open')).toBe(true);
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

  it('offers Vietnamese, Thai and Filipino next to English, Malay and Chinese', async () => {
    open('admin', '/admin/kw');
    const pick = ((await screen.findAllByLabelText('Language')) as HTMLSelectElement[]).find((x) => [...x.options].some((o) => o.textContent === 'All languages'))!;
    expect([...pick.options].map((o) => o.textContent)).toEqual(['All languages', 'English', 'Malay', 'Chinese', 'Vietnamese', 'Thai', 'Filipino']);
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
  it('folds the blocks panel away and brings it back', async () => {
    open('staff', '/admin/kw');
    await userEvent.click(await screen.findByText('Flowchart'));
    expect(screen.getByLabelText('Blocks')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Hide blocks/ }));
    expect(screen.queryByLabelText('Blocks')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /Show blocks/ }));
    expect(screen.getByLabelText('Blocks')).toBeTruthy();
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
  it('Topics: the tabs show counts, each tab says what it is for, and Greetings, Fillers and Block lists have a "How it works" picture', async () => {
    open('staff', '/admin/kw');
    expect(await screen.findByText(/A main keyword \(topic\) and the words that point to it/)).toBeTruthy();
    const tabs = screen.getByRole('tablist');
    expect(within(tabs).getByRole('tab', { name: /Fillers/ }).textContent).toMatch(/Fillers\d/);                       // a count on every tab
    await userEvent.click(within(tabs).getByRole('tab', { name: /Block lists/ }));
    expect(screen.getByText(/make the bot reply carefully, refuse, or hand the chat to a person/)).toBeTruthy();
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
    expect(screen.getByLabelText('The customer is')).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('The customer is'), 'guest');
    expect(screen.queryByLabelText(/Member id/)).toBeNull();
    expect(screen.getByText(/Customer: not logged in/)).toBeTruthy();
    lcLines = [{ from: 'agent', sender: 'operator', text: 'Hello, this is an agent.' }];            // written in LiveChat, not in this page
    expect(await screen.findByText('Hello, this is an agent.', {}, { timeout: 5000 })).toBeTruthy();   // the page looks again by itself
  }, 10000);
  it('merchant page: connects the merchant API with a try-first button', async () => {
    open('admin', '/admin/merchants/A');
    expect(await screen.findByText('Account data')).toBeTruthy();
    expect(screen.getByText('Sample customers only')).toBeTruthy();
    expect(screen.getByText(/What the merchant's API must provide/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(true);        // address and key are needed
    await userEvent.type(screen.getByLabelText(/^API address/), 'https://api.merchant.test/bot');
    await userEvent.type(screen.getByLabelText(/^API key/), 'secret-key-123');
    expect((screen.getByRole('button', { name: 'Connect' }) as HTMLButtonElement).disabled).toBe(false);
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
    await userEvent.click(screen.getByRole('switch', { name: /nobody has typed yet/ }));
    expect(await screen.findByText('dps')).toBeTruthy();
    expect(screen.getAllByTitle('nobody has typed this yet').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('switch', { name: /nobody has typed yet/ }));
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
    expect(await screen.findByRole('heading', { name: /Merchants\s*6/ })).toBeTruthy(); expect(screen.getByRole('heading', { name: /Logins\s*5/ })).toBeTruthy();
    expect(document.querySelectorAll('.ptable .av').length).toBe(11);                                              // a round badge on every merchant and every login
    await userEvent.type(screen.getByLabelText('Find a merchant'), 'zzz');
    expect(await screen.findByText(/No merchant matches “zzz”/)).toBeTruthy();
    await userEvent.clear(screen.getByLabelText('Find a merchant')); await userEvent.type(screen.getByLabelText('Find a merchant'), 'brav');
    expect(screen.getAllByText('Bravo').length).toBeGreaterThan(0); expect(screen.queryByText('Echo')).toBeNull();
    const roles = screen.getByRole('group', { name: 'Show logins' });
    await userEvent.click(within(roles).getByRole('button', { name: /Admins/ }));
    expect(screen.queryByText('alpha')).toBeNull(); expect(screen.getByText('boss')).toBeTruthy();
  });
  it('Import: loads the FAQ category starter, shows what it holds, and previews every entry of the pack', async () => {
    open('staff', '/admin/imp');
    await userEvent.click(await screen.findByRole('button', { name: /Starter packs/ }));
    await userEvent.click(screen.getByRole('menuitem', { name: /FAQ category starter/ }));
    expect((screen.getByLabelText('Paste CSV') as HTMLTextAreaElement).value).toMatch(/free_credit_info,free_credit,,en,answer/);
    expect(screen.getByText('What is in the FAQ category starter?')).toBeTruthy();
    expect(screen.getByText(/Not added, because the bot already covers them/)).toBeTruthy();
    expect(await screen.findByRole('button', { name: new RegExp('Import ' + STARTER_ENTRIES + ' entries') })).toBeTruthy();                              // the check step reads all of the pack
  });
  it('Merchant settings: the LiveChat account-answers switch starts off, turns on, and enables Save', async () => {
    open('admin', '/admin/set');
    const sw = await screen.findByRole('switch', { name: 'Account answers in LiveChat' }) as HTMLInputElement;
    expect(sw.checked).toBe(false);
    await userEvent.click(sw);
    expect(sw.checked).toBe(true);
    expect((screen.getByRole('button', { name: 'Save basics' }) as HTMLButtonElement).disabled).toBe(false);
  });
  it('Merchant page: the setup checklist shows what is done and what is to do, with a button for each', async () => {
    open('admin', '/admin/merchants/A');
    const card = await screen.findByLabelText('Setup checklist');
    expect(within(card).getByText('2 of 5 done')).toBeTruthy();
    expect(within(card).getByRole('progressbar', { name: 'Setup progress' }).getAttribute('aria-valuenow')).toBe('40');
    for (const t of ['Staff login', 'Bot key', 'LiveChat calls the bot', 'Answers', 'Tried it']) expect(within(card).getByText(t)).toBeTruthy();
    expect(within(card).getByText(/No answers yet, so the bot hands every question to a person/)).toBeTruthy();
    expect(within(card).getByText(/members would get demo balances/)).toBeTruthy();                       // the warning about the account switch
    expect(within(card).queryByRole('button', { name: 'Open Account data' })).toBeTruthy();
    expect(within(card).getAllByRole('button').filter((b) => /Make key|Open Import|Show the address/.test(b.textContent ?? '')).length).toBe(3);   // a done step has no button
  });
  it('Merchant page: a button of the checklist opens the right screen for that merchant', async () => {
    open('admin', '/admin/merchants/A');
    await userEvent.click(within(await screen.findByLabelText('Setup checklist')).getByRole('button', { name: 'Open Import' }));
    expect(await screen.findByText(/Import knowledge base/)).toBeTruthy();
  });
  it('Merchant page: a finished checklist folds away and can be opened again', async () => {
    setupDone = true; open('admin', '/admin/merchants/A');
    const card = await screen.findByLabelText('Setup checklist');
    expect(within(card).getByText('complete')).toBeTruthy(); expect(within(card).queryByText('Staff login')).toBeNull();
    await userEvent.click(within(card).getByRole('button', { name: 'Show the checklist' }));
    expect(within(card).getByText('Staff login')).toBeTruthy();
    expect(within(card).getByText(/Not connected\. Without it the bot uses 2 built-in demo customers/)).toBeTruthy();   // optional: no tick needed
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
    expect(await screen.findByText('Handoff number')).toBeTruthy();
    const box = await screen.findByLabelText('Ask for a person after N replies') as HTMLInputElement;
    expect(box.value).toBe('4');
    expect((screen.getByText('Save to LiveChat') as HTMLButtonElement).disabled).toBe(true);       // nothing to send until the number differs
    await userEvent.clear(box); await userEvent.type(box, '6');
    expect((screen.getByText('Save to LiveChat') as HTMLButtonElement).disabled).toBe(false);
  });
  it('shows top topics, top keywords, topics handed over, the wrong-answer rate, and lets staff mark an answer', async () => {
    open('staff', '/admin/report');
    expect(await screen.findByText('Top topics')).toBeTruthy();
    expect(screen.getByText('Top keywords')).toBeTruthy(); expect(screen.getByText('Topics handed to a person most')).toBeTruthy();
    expect(screen.getByText('25%')).toBeTruthy();                                                   // 1 wrong of 4 checked
    expect(screen.getByText('withdraw')).toBeTruthy();
    expect(screen.getByText('Check recent answers')).toBeTruthy();
    await userEvent.click(screen.getAllByRole('button', { name: 'Wrong' })[0]);                                         // sends the mark, then reloads the report
    expect(screen.getByText('Check recent answers')).toBeTruthy();
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
    expect(screen.getAllByText('Short forms').length).toBeGreaterThan(1);                        // the legend and the column: dep is a short form of deposit
    expect(screen.getAllByText('Other languages').length).toBeGreaterThan(1);                    // 充值 is Chinese
    expect(screen.getByText(/Not under a main keyword yet/)).toBeTruthy();                       // xyzzy has no topic yet
    expect(screen.getByText('xyzzy')).toBeTruthy();
  });
  it('shows the stat tiles, the basics and the bot instructions with presets on Merchant settings, and locks the basics for staff', async () => {
    const { unmount } = open('admin', '/admin/set');
    expect(await screen.findByText('Questions today')).toBeTruthy();
    expect(screen.getByText('81%')).toBeTruthy();                                                   // average confidence
    expect((await screen.findByLabelText(/^Monthly AI token limit/) as HTMLInputElement).value).toBe('500000');
    expect(screen.getByText(/Used this month: 12,400/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Save basics' }) as HTMLButtonElement).disabled).toBe(true);          // nothing changed yet
    await userEvent.type(screen.getByLabelText(/^Monthly AI token limit/), '0');
    expect((screen.getByRole('button', { name: 'Save basics' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'English' }) as HTMLButtonElement).disabled).toBe(true);   // the main language stays on
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
  it('shows the handoff rules as switches (two locked on, one not available), trigger phrases and the retention days', async () => {
    const { unmount } = open('admin', '/admin/set');
    await userEvent.click(await screen.findByRole('tab', { name: 'Handoff' }));
    const complaint = await screen.findByRole('switch', { name: 'Complaint or dispute' }) as HTMLInputElement;
    expect(complaint.checked).toBe(true); expect(complaint.disabled).toBe(false);
    await userEvent.click(complaint); expect(complaint.checked).toBe(false);                      // an admin may switch the rule off
    expect((screen.getByRole('switch', { name: 'Customer asks for a person' }) as HTMLInputElement).disabled).toBe(true);        // always on
    expect((screen.getByRole('switch', { name: 'Same question again, or the bot cannot answer' }) as HTMLInputElement).checked).toBe(true);
    const file = screen.getByRole('switch', { name: 'Picture or file sent' }) as HTMLInputElement; expect(file.checked).toBe(false); expect(file.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText('Custom trigger phrases'), 'vip, urgent');
    expect((screen.getByLabelText('Custom trigger phrases') as HTMLInputElement).value).toBe('vip, urgent');
    expect(screen.getByLabelText('Human group for handoff')).toBeTruthy();                           // moved here from Replies
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
    for (const t of ['Replies', 'Handoff', 'AI help', 'Messages', 'Account tools']) expect(screen.getByRole('tab', { name: t })).toBeTruthy();
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
