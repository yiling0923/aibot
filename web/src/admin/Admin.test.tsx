// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Admin from './Admin';

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
const REPORT = { topTopics: [{ topic: 'deposit', n: 9 }], handedByTopic: [{ topic: 'withdraw', handed: 3, total: 6 }], topKeywords: [{ word: 'depo', n: 5 }], accuracy: { right: 3, wrong: 1, checked: 4, wrongRate: 0.25 }, recent: [{ id: 7, question: 'how to deposit', answer: 'Go to Wallet.', topic: 'deposit', at: '2026-11-12 10:00', verdict: null }], days: 7, total: 100, helped: 70, notUnderstood: 10, handedOver: 15, rude: 5, byDecision: {}, tests: 3, daily: Array.from({ length: 7 }, (_, i) => ({ day: '2026-11-0' + (i + 1), total: 14, helped: 10, notUnderstood: 1, handedOver: 2 })), topAnswers: [{ intent: 'deposit_how', n: 30 }, { intent: 'withdraw_time', n: 12 }], topMissing: [{ text: 'tarik duit lambat', hits: 5 }] };
const CONN = () => ({ merchant: { code: 'A', name: 'LuckyPay', language: 'en', tone: 'friendly', entries: 11, logins: ['luckypay'] }, livechat: { baseUrl: 'http://localhost:3000', askUrl: 'http://localhost:3000/api/v1/ai/ask', keys: [], stoppedKeys: 0, liveChats7d: 4, lastLiveChat: null },
  ai: { anthropic: { provider: 'anthropic', configured: true, last4: 'wxyz', updatedAt: '2026-11-12T08:00:00Z', updatedBy: 'admin', using: 'merchant' }, openai: { provider: 'openai', configured: false, last4: null, updatedAt: null, updatedBy: null, using: 'none' } } });
const BILL = () => ({ from: '2026-11-01', to: '2026-11-12', markupPct: 20,
  merchants: [{ code: 'A', name: 'LuckyPay', chats: 40, calls: 120, inputTokens: 900000, outputTokens: 60000, totalTokens: 960000, cost: 0.12, charge: 0.144, ownKeyCalls: 5, ownKeyTokens: 3000, unpricedCalls: 0 },
    { code: 'B', name: 'SwiftWallet', chats: 12, calls: 3, inputTokens: 1000, outputTokens: 100, totalTokens: 1100, cost: 0, charge: 0, ownKeyCalls: 0, ownKeyTokens: 0, unpricedCalls: 3 }],
  totals: { chats: 52, calls: 123, inputTokens: 901000, outputTokens: 60100, totalTokens: 961100, cost: 0.12, charge: 0.144, ownKeyCalls: 5, ownKeyTokens: 3000, unpricedCalls: 3 },
  byKind: [{ kind: 'pick', calls: 120, totalTokens: 960000, cost: 0.12 }], unpricedModels: [{ provider: 'openai', model: 'gpt-new', calls: 3, tokens: 1100 }],
  prices: [{ provider: 'anthropic', model: 'claude-haiku-5-5', inputPerMTok: 0.1, outputPerMTok: 0.5, updatedBy: 'system', updatedAt: '2026-11-01T00:00:00Z' }] });
let lcLines: { from: string; sender: string; text: string }[] = [];
const lcReply = (init?: RequestInit) => {                                                          // a stand-in for the LiveChat test route
  const text = String(JSON.parse(String(init?.body ?? '{}')).text ?? '');
  if (text) lcLines = [...lcLines, { from: 'customer', sender: 'visitor', text }, { from: 'bot', sender: 'ai', text: 'Go to Wallet > Deposit.' }];
  return { conversationId: lcLines.length ? 'c1' : null, status: lcLines.length ? 'open' : null, handoff: lcLines.length ? 'none' : null, messages: lcLines, replied: !!text };
};
const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
const open = (role: 'admin' | 'staff', route = '/admin/kw', translate = true) => {
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => json(url.startsWith('/api/admin/livechat-chat') ? lcReply(init) : url.startsWith('/api/admin/billing') ? (url.includes('/price') || url.includes('/markup') ? { saved: true } : BILL()) : url.includes('/connection') ? CONN() : url.includes('/bot-key') ? { key: 'aib_FRESHKEY1234567890' } : url.startsWith('/api/admin/state') ? { ...state(role), ai: { ...state(role).ai, translate } } : url.startsWith('/api/admin/translate') ? { answer: 'Pergi ke Wallet > Deposit.', examples: ['depo macam mana'] }
    : /\/merchants\/[^/]+\/basics/.test(url) ? BASICS
    : /\/merchants\/[^/]+\/livechat/.test(url) ? { configured: true, baseUrl: 'http://lc.test', email: 'a@b.test', handoffAfterReplies: 4, syncedAt: '2026-11-12T08:00:00Z', error: null }
    : url.startsWith('/api/admin/unmatched/resolve') ? { ok: true, changed: 1 }
    : url.startsWith('/api/admin/unmatched') ? UNMATCHED
    : url.startsWith('/api/admin/people') ? { merchants: [{ code: 'A', name: 'LuckyPay', tone: 'friendly', entries: 11, logins: ['luckypay'], link: { hasKey: false, lastUsedAt: null } }], users: [{ username: 'u', role: 'admin', merchant: null }, { username: 'amy', role: 'staff', merchant: 'B' }] }
    : url.startsWith('/api/admin/report') ? REPORT
    : url.startsWith('/api/admin/flows/try') ? { messages: ['Hello from the flow'], buttons: null, state: null, handed: false, done: true }
    : url.startsWith('/api/admin/keywords?') ? [{ w: 'dep', lg: 'en', n: 5, ignored: false, h: '' }, { w: 'deposit', lg: 'en', n: 9, ignored: false, h: '' }, { w: '充值', lg: 'zh', n: 2, ignored: false, h: '' }, { w: 'xyzzy', lg: 'en', n: 3, ignored: false, h: '' }]
    : url.startsWith('/api/admin/tests') ? { results: [{ merchant: 'A', message: 'depo how', expected: 'ANSWER', got: 'HANDOFF', ok: false }, { merchant: 'A', message: 'wd', expected: 'CHOICE', got: 'CHOICE', ok: true }], pass: 1, total: 2 } : [])));
  return render(<MemoryRouter initialEntries={[route]}><Routes><Route path="/admin/*" element={<Admin />} /></Routes></MemoryRouter>);
};

beforeEach(() => { localStorage.clear(); lcLines = []; });
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
    await userEvent.click(screen.getByRole('button', { name: 'Make key' }));
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
  it('draws a flow: steps, choices, readiness check, and it goes into the draft', async () => {
    open('staff', '/admin/flows');
    await userEvent.click(await screen.findByRole('button', { name: /New flow/ }));
    expect(await screen.findByLabelText('Flow editor')).toBeTruthy();
    expect(screen.getByText(/The flow has no steps yet/)).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('Topic it is for'), 'deposit');
    await userEvent.click(screen.getByRole('button', { name: /＋ Question/ }));
    await userEvent.type(screen.getByLabelText('Text of step 1'), 'What do you need?');
    await userEvent.type(screen.getByLabelText('Choice 1 of step 1'), 'Limits');
    await userEvent.type(screen.getByLabelText('Choice 2 of step 1'), 'Late deposit');
    await userEvent.click(screen.getByRole('button', { name: /＋ Hand to a person/ }));
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'live');
    expect(screen.getByText(/✓ Ready/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Publish/ })).toBeTruthy();
    await userEvent.click(screen.getByLabelText('Delete step 2'));
    expect(screen.queryByLabelText('Text of step 2')).toBeNull();
  });
  it('tries a flow in the box beside the editor', async () => {
    open('staff', '/admin/flows');
    await userEvent.click(await screen.findByRole('button', { name: /New flow/ }));
    await userEvent.selectOptions(screen.getByLabelText('Topic it is for'), 'deposit');
    await userEvent.click(screen.getByRole('button', { name: /＋ Message/ }));
    await userEvent.type(screen.getByLabelText('Text of step 1'), 'Hello from the flow');
    await userEvent.click(within(screen.getByLabelText('Try the flow')).getByRole('button', { name: /Start/ }));
    expect(await within(screen.getByLabelText('Flow chat')).findByText('Hello from the flow')).toBeTruthy();
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
    await userEvent.click(await screen.findByText('By main keyword'));
    expect(await screen.findByText('◆ deposit')).toBeTruthy();
    expect(screen.getAllByText('Short forms').length).toBeGreaterThan(1);                        // the legend and the column: dep is a short form of deposit
    expect(screen.getAllByText('Other languages').length).toBeGreaterThan(1);                    // 充值 is Chinese
    expect(screen.getByText(/Not under a main keyword yet/)).toBeTruthy();                       // xyzzy has no topic yet
    expect(screen.getByText('xyzzy')).toBeTruthy();
    await userEvent.click(screen.getByText('List'));
    expect(screen.queryByText('◆ deposit')).toBeNull();                                          // the plain table is back
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
    expect((screen.getByLabelText('Tenant id') as HTMLInputElement).value).toBe('1');
    lcLines = []; await userEvent.click(screen.getByRole('button', { name: 'New chat' }));
    expect(await screen.findByText(/No messages yet/)).toBeTruthy();
    unmount();
    open('staff', '/admin/lchat');
    expect(await screen.findByText('Only an admin can use this screen.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'LiveChat test' })).toBeNull();                        // not in the staff menu
  });
});
