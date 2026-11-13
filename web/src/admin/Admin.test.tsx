// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import Admin from './Admin';

const state = (role: 'admin' | 'staff') => ({
  versions: { A: 3, B: 2 }, sharedVer: 1, stamp: 9, merchants: role === 'admin' ? [{ code: 'A', name: 'LuckyPay' }, { code: 'B', name: 'SwiftWallet' }] : [{ code: 'B', name: 'SwiftWallet' }],
  history: [{ kind: 'merchant', merchant: role === 'admin' ? 'A' : 'B', version: 3, actor: 'admin', summary: 'Edited', ago: 'today' }], user: { username: 'u', role, merchant: role === 'admin' ? null : 'B' }, ai: { pick: false, write: false, describe: false, translate: true },
  snapshot: {
    kb: [], aliases: { deposit: { en: ['deposit', 'dep'], ms: [], zh: ['充值'] } }, mAliases: { A: [], B: [] }, aspects: {}, smalltalk: {}, guard: { abuse: {}, abuse_soft: {} }, fillers: { en: ['lah'], ms: [], zh: [] },
    settings: {},
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
const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
const open = (role: 'admin' | 'staff', route = '/admin/kw', translate = true) => {
  vi.stubGlobal('fetch', vi.fn((url: string) => json(url.startsWith('/api/admin/billing') ? (url.includes('/price') || url.includes('/markup') ? { saved: true } : BILL()) : url.includes('/connection') ? CONN() : url.includes('/bot-key') ? { key: 'aib_FRESHKEY1234567890' } : url.startsWith('/api/admin/state') ? { ...state(role), ai: { ...state(role).ai, translate } } : url.startsWith('/api/admin/translate') ? { answer: 'Pergi ke Wallet > Deposit.', examples: ['depo macam mana'] }
    : /\/merchants\/[^/]+\/livechat/.test(url) ? { configured: true, baseUrl: 'http://lc.test', email: 'a@b.test', handoffAfterReplies: 4, syncedAt: '2026-11-12T08:00:00Z', error: null }
    : url.startsWith('/api/admin/unmatched/resolve') ? { ok: true, changed: 1 }
    : url.startsWith('/api/admin/unmatched') ? UNMATCHED
    : url.startsWith('/api/admin/people') ? { merchants: [], users: [{ username: 'u', role: 'admin', merchant: null }, { username: 'amy', role: 'staff', merchant: 'B' }] }
    : url.startsWith('/api/admin/report') ? REPORT
    : url.startsWith('/api/admin/keywords?') ? [{ w: 'dep', lg: 'en', n: 5, ignored: false, h: '' }, { w: 'deposit', lg: 'en', n: 9, ignored: false, h: '' }, { w: '充值', lg: 'zh', n: 2, ignored: false, h: '' }, { w: 'xyzzy', lg: 'en', n: 3, ignored: false, h: '' }]
    : url.startsWith('/api/admin/tests') ? { results: [{ merchant: 'A', message: 'depo how', expected: 'ANSWER', got: 'HANDOFF', ok: false }, { merchant: 'A', message: 'wd', expected: 'CHOICE', got: 'CHOICE', ok: true }], pass: 1, total: 2 } : [])));
  return render(<MemoryRouter initialEntries={[route]}><Routes><Route path="/admin/*" element={<Admin />} /></Routes></MemoryRouter>);
};

beforeEach(() => localStorage.clear());
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
  it('lists the messages the bot did not understand and lets staff add one to an answer or ignore it', async () => {
    const calls: string[] = [];
    open('admin', '/admin/unm');
    const orig = globalThis.fetch as unknown as (u: string, i?: RequestInit) => Promise<Response>;
    vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => { if (i?.method === 'POST') calls.push(u + ' ' + i.body); return orig(u, i); }));
    expect(await screen.findByText('tarik duit lambat')).toBeTruthy();
    expect(screen.queryByText('abc xyz')).toBeNull();                              // dealt-with ones are on the other tab
    expect(screen.getByRole('button', { name: 'Add to an answer' })).toBeTruthy(); expect(screen.getByRole('button', { name: 'New answer' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Ignore' }));
    await vi.waitFor(() => expect(calls.some((c) => c.includes('/api/admin/unmatched/resolve') && c.includes('ignored') && c.includes('tarik duit lambat'))).toBe(true));
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
    const reset = await screen.findAllByRole('button', { name: 'Reset password' });
    expect(reset).toHaveLength(2);                                                       // one per login
    expect(reset[0].textContent).toBe('');                                               // an icon, no words on the button
    expect(reset[0].getAttribute('data-tip')).toBe('Reset password');                    // the words shown on hover
    expect(screen.getAllByRole('button', { name: 'Remove login' })).toHaveLength(1);     // you cannot remove yourself
  });

  it('opens a merchant page with the LiveChat address, makes a key that is shown once, and keeps AI keys masked', async () => {
    open('admin', '/admin/merchants/A');
    expect(await screen.findByText('LiveChat connection')).toBeTruthy();
    expect((screen.getByDisplayValue('http://localhost:3000') as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByText('4 real chats in the last 7 days')).toBeTruthy();
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
    await userEvent.click(await screen.findByRole('button', { name: 'Add merchant' }));
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
    expect(await screen.findByText('Handoff number (synced with LiveChat)')).toBeTruthy();
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
    expect(screen.getByText(/withdraw \(50% of 6\)/)).toBeTruthy();
    expect(screen.getByText('Check recent answers')).toBeTruthy();
    await userEvent.click(screen.getAllByText('Wrong')[0]);                                         // sends the mark, then reloads the report
    expect(screen.getByText('Check recent answers')).toBeTruthy();
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
    expect(await screen.findByText('Main keyword')).toBeTruthy();
    expect(screen.getByText('Short forms')).toBeTruthy();                                        // dep is a short form of deposit
    expect(screen.getByText('Other languages')).toBeTruthy();                                    // 充值 is Chinese
    expect(screen.getByText('Not assigned to a main keyword')).toBeTruthy();                     // xyzzy has no topic yet
    expect(screen.getByText('xyzzy')).toBeTruthy();
    await userEvent.click(screen.getByText('List'));
    expect(screen.queryByText('Main keyword')).toBeNull();                                       // the plain table is back
    expect(screen.getByText('xyzzy')).toBeTruthy();
  });
});
