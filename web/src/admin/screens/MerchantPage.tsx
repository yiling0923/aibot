import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { usePanel } from '../store';
import { Pill } from '../ui';

interface KeyRow { id: number; prefix: string; createdBy: string | null; createdAt: string; lastUsedAt: string | null }
interface AiRow { provider: 'anthropic' | 'openai'; configured: boolean; last4: string | null; updatedAt: string | null; updatedBy: string | null; using: 'merchant' | 'shared' | 'none' }
interface CheckItem { key: string; title: string; state: 'done' | 'todo' | 'optional' | 'warn'; detail: string; action?: { to: 'users' | 'key' | 'livechat' | 'imp' | 'kb' | 'lchat' | 'learn'; label: string } }
interface Setup { items: CheckItem[]; done: number; total: number }
interface Conn {
  setup: Setup;
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
      <SetupChecklist s={c.setup} code={m.code} onMakeKey={makeKey} />
      <div className="card"><div className="head"><div><h2>{m.name} <span className="mcodepill">{m.code}</span></h2>
        <div className="sub">Everything LiveChat needs to reach this merchant's bot.</div></div>
        <button className="btn" type="button" onClick={() => nav('/admin/users')}>← All merchants</button></div>
        <div className="btiles" style={{ margin: '14px 0 4px' }}>
          <div className="rptile"><i style={{ background: '#7fa8e8' }} /><small>Answers</small><b>{m.entries}</b></div><div className="rptile"><i style={{ background: '#9b8bd8' }} /><small>Main language</small><b>{LANG[m.language] ?? m.language}</b></div>
          <div className="rptile"><i style={{ background: '#f0c27b' }} /><small>Tone</small><b>{m.tone[0].toUpperCase() + m.tone.slice(1)}</b></div><div className="rptile"><i style={{ background: '#7fc4a8' }} /><small>Real chats, 7 days</small><b>{lc.liveChats7d}</b></div></div>
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

      <Step n={4} done={aiOwn || aiShared} title="AI keys" badge={aiOwn ? 'Own key' : aiShared ? 'Using shared key' : 'AI off'} tone={aiOwn ? 'ok' : aiShared ? 'info' : ''}
        sub={<>Optional. With its own key, this merchant's AI use is billed to its own account. Without one, the bot uses the shared key from <span className="mono">.env</span>, or runs without AI. Keys are saved encrypted and only the last 4 characters are ever shown.</>}>
        <AiKeyRow code={m.code} provider="anthropic" title="Claude (Anthropic)" help="Picks the right answer when no keyword matches, describes new keywords, and translates answers." row={c.ai.anthropic} onChange={load} />
        <AiKeyRow code={m.code} provider="openai" title="ChatGPT (OpenAI)" help="Only used to reword replies, and only if OPENAI_MODEL is set in .env." row={c.ai.openai} onChange={load} />
      </Step>
    </>
  );
}

/** The setup checklist: what is done for this merchant, what is still to do, and a button for each. It folds away when everything is done. */
function SetupChecklist({ s, code, onMakeKey }: { s: Setup; code: string; onMakeKey: () => void }) {
  const p = usePanel(); const nav = useNavigate();
  const complete = s.done === s.total && !s.items.some((x) => x.state === 'warn');
  const [open, setOpen] = useState(!complete);
  useEffect(() => { setOpen(!complete); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [code]);
  const scroll = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const go = (to: NonNullable<CheckItem['action']>['to']) => {
    if (to === 'users') nav('/admin/users');
    else if (to === 'key') onMakeKey();
    else if (to === 'livechat') scroll('mstep-1');
    else { p.setMerchant(code); nav(to === 'imp' ? '/admin/imp' : to === 'kb' ? '/admin/kb' : to === 'learn' ? '/admin/learn' : '/admin/lchat'); }
  };
  const icon = (st: CheckItem['state']) => (st === 'done' ? '✓' : st === 'warn' ? '!' : st === 'optional' ? '–' : '');
  const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
  return (
    <div className="card" aria-label="Setup checklist">
      <div className="head"><div><h2>Setup checklist <span className={'pill ' + (complete ? 'ok' : 'warn')}>{complete ? 'complete' : `${s.done} of ${s.total} done`}</span></h2>
        <div className="sub">{complete ? 'Everything the bot needs is in place for this merchant.' : 'What this merchant still needs before its bot can answer real customers.'}</div></div>
        <button className="btn sm" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Show the checklist'}</button></div>
      <div className="cbar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Setup progress"><i style={{ width: pct + '%' }} /></div>
      {open && <ul className="checklist">{s.items.map((x) => (
        <li key={x.key} className={'chk ' + x.state}>
          <span className={'cdot ' + x.state} aria-hidden="true">{icon(x.state)}</span>
          <div className="cbody"><b>{x.title}</b><span className="sr-only"> ({x.state === 'done' ? 'done' : x.state === 'todo' ? 'to do' : x.state === 'warn' ? 'needs attention' : 'optional'})</span><div className="sub">{x.detail}</div></div>
          {x.action && x.state !== 'done' && <button className={'btn sm' + (x.state === 'todo' ? ' pri' : '')} type="button" onClick={() => go(x.action!.to)}>{x.action.label}</button>}
        </li>))}</ul>}
    </div>
  );
}

/** One numbered step of the merchant setup: a dot (a tick when done), a title with a short note, a status tag on the right, and the content. */
function Step({ n, done, title, badge, tone, sub, children }: { n: number; done: boolean; title: string; badge: string; tone: string; sub: ReactNode; children: ReactNode }) {
  return (
    <div className="card mstep" id={'mstep-' + n}><div className={'mdot' + (done ? '' : ' todo')} aria-hidden="true">{done ? '✓' : n}</div>
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
  if (!l) return <Step n={3} done={false} title="Human Handoff" badge="Loading…" tone="" sub={sub}><div className="sub">{msg || 'Loading…'}</div></Step>;
  const badge = !l.configured ? 'Not connected' : l.error ? 'Last sync failed' : 'In sync · ' + (l.handoffAfterReplies ?? '?') + ' replies';
  return (
    <Step n={3} done={l.configured && !l.error} title="Human Handoff" badge={badge} tone={!l.configured ? '' : l.error ? 'bad' : 'ok'} sub={sub}>
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
