import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { usePanel } from '../store';
import { Pill } from '../ui';

interface KeyRow { id: number; prefix: string; createdBy: string | null; createdAt: string; lastUsedAt: string | null }
interface AiRow { provider: 'anthropic' | 'openai'; configured: boolean; last4: string | null; updatedAt: string | null; updatedBy: string | null; using: 'merchant' | 'shared' | 'none' }
interface Conn {
  merchant: { code: string; name: string; language: string; tone: string; entries: number; logins: string[] };
  livechat: { baseUrl: string; askUrl: string; keys: KeyRow[]; stoppedKeys: number; liveChats7d: number; lastLiveChat: string | null };
  ai: Record<'anthropic' | 'openai', AiRow>;
}
interface LcLink { configured: boolean; baseUrl: string | null; email: string | null; handoffAfterReplies: number | null; syncedAt: string | null; error: string | null }
interface LinkTest { ok: boolean; ms: number; hasKey: boolean; answer: string; decision: string; choices: { label: string }[] }

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : 'never');
const LANG: Record<string, string> = { en: 'English', ms: 'Malay', zh: 'Chinese', vi: 'Vietnamese', th: 'Thai', tl: 'Filipino' };

/** One merchant: what LiveChat needs to reach its bot, its bot key, its own AI keys, and a button that tests the link. Admin only. */
export default function MerchantPage() {
  const p = usePanel(); const nav = useNavigate(); const { code = '' } = useParams();
  const [c, setC] = useState<Conn | null>(null); const [err, setErr] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);        // a key just made: shown once
  const [test, setTest] = useState<LinkTest | null>(null); const [busy, setBusy] = useState('');
  const load = useCallback(async () => {
    try { setC(await api<Conn>(`/api/admin/merchants/${encodeURIComponent(code)}/connection`)); setErr(''); } catch (e) { setErr((e as Error).message); }
  }, [code]);
  useEffect(() => { setC(null); setFresh(null); setTest(null); void load(); }, [load]);
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); p.toast('Copied'); } catch { p.toast('Could not copy. Select the text and copy it.'); } };
  const run = async (label: string, fn: () => Promise<void>) => { setBusy(label); try { await fn(); } catch (e) { p.toast((e as Error).message); } finally { setBusy(''); } };

  if (err) return <div className="card"><h2>Merchant</h2><div className="sub">{err}</div><button className="btn" type="button" onClick={() => nav('/admin/users')}>Back to merchants</button></div>;
  if (!c) return <div className="card"><div className="sub">Loading…</div></div>;
  const { merchant: m, livechat: lc } = c; const key = lc.keys[0];

  const makeKey = () => run('key', async () => {
    if (key && !confirm('Replace the key? The current key stops working at once, and LiveChat will be cut off until you paste the new key into it.')) return;
    const r = await api<{ key: string }>(`/api/admin/merchants/${m.code}/bot-key`, { replace: true });
    setFresh(r.key); await load();
  });
  const stopKey = () => run('stop', async () => {
    if (!confirm('Stop the key? LiveChat will get no answers from the bot until you make a new key.')) return;
    await api(`/api/admin/merchants/${m.code}/bot-key/revoke`, {}); setFresh(null); await load(); p.toast('Key stopped');
  });
  const runTest = () => run('test', async () => setTest(await api<LinkTest>(`/api/admin/merchants/${m.code}/test-link`, { question: 'Can you help?' })));

  const aiOwn = Object.values(c.ai).some((r) => r.using === 'merchant'), aiShared = Object.values(c.ai).some((r) => r.using === 'shared');
  return (
    <>
      <div className="card"><div className="head"><div><h2>{m.name} <span className="mcodepill">{m.code}</span></h2>
        <div className="sub">Everything LiveChat needs to reach this merchant's bot.</div></div>
        <button className="btn" type="button" onClick={() => nav('/admin/users')}>← All merchants</button></div>
        <div className="mstats">
          <div className="mst"><small>Answers</small><b>{m.entries}</b></div><div className="mst"><small>Main language</small><b>{LANG[m.language] ?? m.language}</b></div>
          <div className="mst"><small>Tone</small><b>{m.tone[0].toUpperCase() + m.tone.slice(1)}</b></div><div className="mst"><small>Real chats, 7 days</small><b>{lc.liveChats7d}</b></div></div>
        <div className="mlinks">
          <button className="btn sm" type="button" onClick={() => { p.setMerchant(m.code); nav('/admin/set'); }}>Merchant settings</button>
          <button className="btn sm" type="button" onClick={() => { p.setMerchant(m.code); nav('/admin/kb'); }}>Knowledge base</button>
          <button className="btn sm" type="button" onClick={() => nav('/admin/lchat')}>LiveChat test</button>
          <span className="sub">{m.logins.length ? 'Staff login: ' + m.logins.join(', ') : 'No staff login yet'}</span>
        </div></div>

      <Step n={1} done={!!key} title="LiveChat connection" badge={key ? 'Bot key active' : 'No bot key yet'} tone={key ? 'ok' : 'warn'}
        sub={<>In LiveChat, open this merchant's <b>Chat → AI Bot</b> page, switch the bot on, and paste the two values below.</>}>
        <div className="mlbl">1 · Bot address (LiveChat → "API URL")</div>
        <div className="mrow"><input readOnly value={lc.baseUrl} onFocus={(e) => e.target.select()} style={{ flexGrow: 1 }} aria-label="Bot address" /><button className="btn" type="button" onClick={() => void copy(lc.baseUrl)}>Copy</button></div>
        <div className="sub" style={{ margin: '6px 0 14px' }}>LiveChat adds <span className="mono">/api/v1/ai/ask</span> itself. If LiveChat runs on another computer or in Docker, <span className="mono">localhost</span> will not work from there: use the address that computer uses to reach this bot, or set <span className="mono">PUBLIC_URL</span> in .env.</div>
        <div className="mlbl">2 · Bot key (LiveChat → "API Key")</div>
        {fresh ? (
          <div className="note" style={{ background: 'var(--okbg)' }}>
            <b>Copy this key now. It is shown only once.</b>
            <div className="mrow" style={{ marginTop: 8 }}><input readOnly className="mono" value={fresh} onFocus={(e) => e.target.select()} style={{ flexGrow: 1 }} /><button className="btn pri" type="button" onClick={() => void copy(fresh)}>Copy key</button></div>
            <div className="sub" style={{ marginTop: 6 }}>Paste it into LiveChat's API Key box and save. The bot cannot show it again, only make a new one.</div>
          </div>
        ) : key ? (
          <div className="keyline"><span className="mono">{key.prefix}…</span><Pill c="ok">Active</Pill>
            <span className="sub">Made {when(key.createdAt)}{key.createdBy ? ' by ' + key.createdBy : ''} · last used by LiveChat: {when(key.lastUsedAt)}{lc.stoppedKeys ? ` · ${lc.stoppedKeys} older key${lc.stoppedKeys > 1 ? 's' : ''} stopped` : ''}</span></div>
        ) : <div className="sub">No key yet. LiveChat cannot use the bot until you make one.</div>}
        <div className="mrow" style={{ marginTop: 10 }}>
          <button className={'btn' + (key ? '' : ' pri')} type="button" disabled={busy === 'key'} onClick={makeKey}>{key ? 'Replace key' : 'Make key'}</button>
          {key && <button className="btn danger" type="button" disabled={busy === 'stop'} onClick={stopKey}>Stop key</button>}
        </div>
      </Step>

      <Step n={2} done={!!test?.ok} title="Test the link" badge={test ? (test.ok ? `Last test: OK · ${test.ms} ms` : 'Last test failed') : 'Not tested yet'} tone={test ? (test.ok ? 'ok' : 'bad') : ''}
        sub="Sends “Can you help?” to the bot the way LiveChat does, using this merchant's answers. It shows the bot's side only; it cannot see whether LiveChat can reach this address. Saved as a test chat.">
        <div className="mrow"><button className="btn pri" type="button" disabled={busy === 'test'} onClick={runTest}>{busy === 'test' ? 'Testing…' : 'Test the link'}</button></div>
        {test && (
          <div className="note" style={{ marginTop: 10, background: test.hasKey ? 'var(--okbg)' : 'var(--warnbg)' }}>
            <b>The bot answered in {test.ms} ms</b> ({test.decision}).{!test.hasKey && ' Warning: there is no active key yet, so LiveChat cannot get this answer.'}
            <div style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{test.answer}</div>
          </div>
        )}
      </Step>

      <HandoffSync code={m.code} />

      <AccountApi code={m.code} />

      <Step n={5} done={aiOwn || aiShared} title="AI keys" badge={aiOwn ? 'Own key' : aiShared ? 'Using shared key' : 'AI off'} tone={aiOwn ? 'ok' : aiShared ? 'info' : ''}
        sub={<>Optional. With its own key, this merchant's AI use is billed to its own account. Without one, the bot uses the shared key from <span className="mono">.env</span>, or runs without AI. Keys are saved encrypted and only the last 4 characters are ever shown.</>}>
        <AiKeyRow code={m.code} provider="anthropic" title="Claude (Anthropic)" help="Picks the right answer when no keyword matches, describes new keywords, and translates answers." row={c.ai.anthropic} onChange={load} />
        <AiKeyRow code={m.code} provider="openai" title="ChatGPT (OpenAI)" help="Only used to reword replies, and only if OPENAI_MODEL is set in .env." row={c.ai.openai} onChange={load} />
      </Step>
    </>
  );
}

/** One numbered step of the merchant setup: a dot (a tick when done), a title with a short note, a status tag on the right, and the content. */
function Step({ n, done, title, badge, tone, sub, children }: { n: number; done: boolean; title: string; badge: string; tone: string; sub: ReactNode; children: ReactNode }) {
  return (
    <div className="card mstep"><div className={'mdot' + (done ? '' : ' todo')} aria-hidden="true">{done ? '✓' : n}</div>
      <div className="mbody"><h3 style={{ margin: 0 }}>{title}</h3><div className="sub" style={{ marginTop: 2 }}>{sub}</div><div style={{ marginTop: 14 }}>{children}</div></div>
      <Pill c={tone}>{badge}</Pill></div>
  );
}

function AiKeyRow({ code, provider, title, help, row, onChange }: { code: string; provider: 'anthropic' | 'openai'; title: string; help: string; row: AiRow; onChange: () => Promise<void> }) {
  const p = usePanel(); const [val, setVal] = useState(''); const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await api(`/api/admin/merchants/${code}/ai-key`, { provider, key: val }); setVal(''); await onChange(); p.toast(title + ' key saved'); }
    catch (e) { p.toast((e as Error).message); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!confirm('Remove this merchant\'s ' + title + ' key? It will use the shared key (if any) from then on.')) return;
    try { await api(`/api/admin/merchants/${code}/ai-key/remove`, { provider }); await onChange(); p.toast('Key removed'); } catch (e) { p.toast((e as Error).message); }
  };
  return (
    <div style={{ borderTop: '1px solid var(--line)', marginTop: 12, paddingTop: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><b>{title}</b>
        {row.using === 'merchant' ? <Pill c="ok">Own key ····{row.last4}</Pill> : row.using === 'shared' ? <Pill c="info">Using the shared key</Pill> : <Pill>Off</Pill>}</div>
      <div className="sub">{help}{row.configured ? ` Saved ${when(row.updatedAt)}${row.updatedBy ? ' by ' + row.updatedBy : ''}.` : ''}</div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        <input type="password" autoComplete="off" placeholder={row.configured ? 'Paste a new key to replace it' : 'Paste the key'} value={val} onChange={(e) => setVal(e.target.value)} style={{ flexGrow: 1, minWidth: 220 }} aria-label={title + ' key'} />
        <button className="btn pri" type="button" disabled={busy || val.trim().length < 12} onClick={save}>{row.configured ? 'Replace key' : 'Save key'}</button>
        {row.configured && <button className="btn" type="button" onClick={remove}>Remove</button>}
      </div>
    </div>
  );
}

/** "Ask for a person after N bot replies": the same number in LiveChat and in the bot. LiveChat wins; a change made here goes to LiveChat first. */
function HandoffSync({ code }: { code: string }) {
  const p = usePanel(); const base = `/api/admin/merchants/${encodeURIComponent(code)}/livechat`;
  const [l, setL] = useState<LcLink | null>(null); const [f, setF] = useState({ baseUrl: '', email: '', password: '' }); const [n, setN] = useState(''); const [busy, setBusy] = useState(''); const [msg, setMsg] = useState('');
  const apply = (x: LcLink) => { setL(x); setN(x.handoffAfterReplies === null ? '' : String(x.handoffAfterReplies)); };
  const run = async (what: string, fn: () => Promise<LcLink>, ok: string) => { setBusy(what); setMsg(''); try { apply(await fn()); p.toast(ok); } catch (e) { setMsg((e as Error).message); } finally { setBusy(''); } };
  useEffect(() => { api<LcLink>(base).then(apply).catch((e) => setMsg((e as Error).message)); }, [base]);
  const sub = <>After this many bot replies, LiveChat asks the customer if they want a person (0 = never). It is one number: change it in LiveChat or here and the other follows. LiveChat is the source of truth: the bot copies it every minute and whenever this page opens. A change made here is sent to LiveChat first and saved only if LiveChat accepts it.</>;
  if (!l) return <Step n={3} done={false} title="Handoff number" badge="Loading…" tone="" sub={sub}><div className="sub">{msg || 'Loading…'}</div></Step>;
  const badge = !l.configured ? 'Not connected' : l.error ? 'Last sync failed' : 'In sync · ' + (l.handoffAfterReplies ?? '?') + ' replies';
  return (
    <Step n={3} done={l.configured && !l.error} title="Handoff number" badge={badge} tone={!l.configured ? '' : l.error ? 'bad' : 'ok'} sub={sub}>
      {l.configured ? <>
        <div className="mrow" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <label className="fld"><span>Ask for a person after N replies</span><input type="number" min={0} max={100} value={n} onChange={(e) => setN(e.target.value)} style={{ width: 120 }} /></label>
          <button className="btn pri" type="button" disabled={!!busy || n === '' || Number(n) === l.handoffAfterReplies} onClick={() => run('push', () => api<LcLink>(base + '/handoff', { value: Number(n) }), 'Saved in LiveChat and here')}>Save to LiveChat</button>
          <button className="btn" type="button" disabled={!!busy} onClick={() => run('sync', () => api<LcLink>(base + '/sync', {}), 'Copied from LiveChat')}>Sync now</button>
          <button className="btn ghost" type="button" disabled={!!busy} onClick={() => run('rm', async () => { await api(base + '/remove', {}); return { configured: false, baseUrl: null, email: null, handoffAfterReplies: null, syncedAt: null, error: null }; }, 'Disconnected')}>Disconnect</button></div>
        <div className="sub" style={{ marginTop: 8 }}>Connected to <span className="mono">{l.baseUrl}</span> as {l.email}.{l.syncedAt ? ' Last copied ' + when(l.syncedAt) + '.' : ''}{l.error ? <> <Pill c="bad">{l.error}</Pill></> : null}</div>
      </> : <>
        <div className="form">
          <label className="fld"><span>LiveChat address</span><input value={l.baseUrl ?? f.baseUrl} placeholder="http://localhost:8080" onChange={(e) => setF({ ...f, baseUrl: e.target.value })} /></label>
          <label className="fld"><span>This merchant's LiveChat email</span><input value={f.email} autoComplete="off" onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
          <label className="fld"><span>Password (saved encrypted)</span><input type="password" value={f.password} autoComplete="off" onChange={(e) => setF({ ...f, password: e.target.value })} /></label></div>
        <div className="mrow" style={{ marginTop: 10 }}><button className="btn pri" type="button" disabled={!!busy} onClick={() => run('connect', () => api<LcLink>(base, f), 'Connected to LiveChat')}>{busy === 'connect' ? 'Checking…' : 'Connect and copy the number'}</button></div></>}
      {msg && <div className="note" style={{ marginTop: 8, background: 'var(--badbg)' }}>{msg}</div>}
    </Step>
  );
}

interface ApiState { configured: boolean; baseUrl: string | null; keyLast4: string | null; checkedAt: string | null; error: string | null }
interface ApiTest { status: 'ok' | 'missing' | 'error'; error: string | null; account: { name: string; balance: string | null; points: number | null; level: string | null; deposits: number; withdrawals: number; transactions: number } | null }

/** The merchant's own API: where the bot reads a logged-in customer's balance, points, deposits and withdrawals. */
function AccountApi({ code }: { code: string }) {
  const p = usePanel(); const base = `/api/admin/merchants/${encodeURIComponent(code)}/api`;
  const [s, setS] = useState<ApiState | null>(null); const [f, setF] = useState({ baseUrl: '', apiKey: '', customer: '' }); const [busy, setBusy] = useState(''); const [msg, setMsg] = useState(''); const [t, setT] = useState<ApiTest | null>(null);
  const load = () => api<ApiState>(base).then((x) => { setS(x); setF((o) => ({ ...o, baseUrl: x.baseUrl ?? o.baseUrl })); }).catch((e) => setMsg((e as Error).message));
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [base]);
  const run = async (what: string, fn: () => Promise<void>) => { setBusy(what); setMsg(''); try { await fn(); } catch (e) { setMsg((e as Error).message); } finally { setBusy(''); } };
  const test = () => run('test', async () => setT(await api<ApiTest>(base + '/test', { baseUrl: f.baseUrl, apiKey: f.apiKey, customerId: f.customer })));
  const save = () => run('save', async () => { await api(base, { baseUrl: f.baseUrl, apiKey: f.apiKey, testCustomerId: f.customer }); setF((o) => ({ ...o, apiKey: '' })); await load(); p.toast('Account data connected'); });
  const off = () => run('off', async () => { if (!confirm('Disconnect the account data of this merchant? The bot then uses the built-in sample customers.')) return; await api(base + '/remove', {}); setT(null); setF({ baseUrl: '', apiKey: '', customer: '' }); await load(); p.toast('Disconnected'); });
  const on = !!s?.configured;
  return (
    <Step n={4} done={on} title="Account data" badge={on ? 'Connected' : 'Sample customers only'} tone={on ? 'ok' : ''}
      sub={<>Where the bot reads a <b>logged-in</b> customer's balance, points, deposits and withdrawals, from the merchant's own system. Read only: the bot never changes anything. Not used in LiveChat replies. Without it the bot uses built-in sample customers (a demo only).</>}>
      {on && <div className="keyline"><span className="mono">{s?.baseUrl}</span><Pill c="ok">Key …{s?.keyLast4}</Pill>{s?.checkedAt ? <span className="sub">Checked {when(s.checkedAt)}</span> : <span className="sub">Saved without a test</span>}</div>}
      <div className="form" style={{ marginTop: 8 }}>
        <label className="fld"><span>API address</span><input value={f.baseUrl} placeholder="https://api.merchant.com/bot" autoComplete="off" onChange={(e) => setF({ ...f, baseUrl: e.target.value })} /></label>
        <label className="fld"><span>API key {on ? '(leave empty to keep the saved one)' : ''}</span><input type="password" value={f.apiKey} placeholder={on ? '••••' + (s?.keyLast4 ?? '') : ''} autoComplete="new-password" onChange={(e) => setF({ ...f, apiKey: e.target.value })} /></label>
        <label className="fld"><span>A customer id to try</span><input value={f.customer} placeholder="e.g. 8841" autoComplete="off" onChange={(e) => setF({ ...f, customer: e.target.value })} /></label></div>
      <div className="mrow" style={{ marginTop: 10 }}>
        <button className="btn" type="button" disabled={!!busy || !f.baseUrl || !f.customer || (!f.apiKey && !on)} onClick={test}>{busy === 'test' ? 'Trying…' : 'Try it'}</button>
        <button className="btn pri" type="button" disabled={!!busy || !f.baseUrl || !f.apiKey} onClick={save}>{busy === 'save' ? 'Saving…' : on ? 'Save changes' : 'Connect'}</button>
        {on && <button className="btn danger" type="button" disabled={!!busy} onClick={off}>Disconnect</button>}</div>
      {t && (t.status === 'ok' && t.account
        ? <div className="note" style={{ marginTop: 10, background: 'var(--okbg)' }}><b>It works.</b> {t.account.name || 'The customer'}: balance {t.account.balance ?? 'not sent'}{t.account.points !== null ? ` · ${t.account.points} points` : ''}{t.account.level ? ` (${t.account.level})` : ''} · {t.account.deposits} deposits, {t.account.withdrawals} withdrawals, {t.account.transactions} transactions found.</div>
        : t.status === 'missing' ? <div className="note" style={{ marginTop: 10, background: 'var(--warnbg)' }}>The address and key work, but the API has no customer with that id.</div>
        : <div className="note" style={{ marginTop: 10, background: 'var(--badbg)' }}>{t.error}</div>)}
      {msg && <div className="note" style={{ marginTop: 8, background: 'var(--badbg)' }}>{msg}</div>}
      <details className="fold" style={{ marginTop: 10 }}><summary>What the merchant's API must provide</summary>
        <div className="sub" style={{ marginTop: 6 }}>The bot calls <span className="mono">GET {'{address}'}/customers/{'{customer id}'}/account</span> with the header <span className="mono">Authorization: Bearer {'{key}'}</span>. Answer <b>200</b> with JSON, <b>404</b> when there is no such customer. The customer id is the one the website signs into the chat token. See the README ("Merchant API") for the fields.</div></details>
    </Step>
  );
}
