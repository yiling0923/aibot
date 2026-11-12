import { useCallback, useEffect, useState } from 'react';
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

  return (
    <>
      <div className="card"><div className="head"><div><h2>{m.name} <span className="mono sub">{m.code}</span></h2>
        <div className="sub">The details LiveChat needs to reach this merchant's bot, and this merchant's own AI keys.</div></div>
        <button className="btn" type="button" onClick={() => nav('/admin/users')}>← All merchants</button></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
          <Pill>{m.entries} knowledge base entries</Pill><Pill>Tone: {m.tone}</Pill><Pill>Default language: {LANG[m.language] ?? m.language}</Pill>
          <Pill c={m.logins.length ? '' : 'warn'}>{m.logins.length ? 'Staff: ' + m.logins.join(', ') : 'No staff login yet'}</Pill>
          <Pill c={lc.liveChats7d ? 'ok' : ''}>{lc.liveChats7d} real chats in the last 7 days</Pill>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn sm" type="button" onClick={() => { p.setMerchant(m.code); nav('/admin/set'); }}>Merchant settings</button>
          <button className="btn sm" type="button" onClick={() => { p.setMerchant(m.code); nav('/admin/kb'); }}>Knowledge base</button>
          <button className="btn sm" type="button" onClick={() => { p.setMerchant(m.code); nav('/admin/chat'); }}>Test chat</button>
        </div></div>

      <div className="card"><h3>LiveChat connection</h3>
        <div className="sub">In LiveChat, open this merchant's <b>Chat → AI Bot</b> page, switch the bot on, and paste the two values below.</div>
        <div className="form" style={{ marginTop: 10 }}>
          <label className="fld full"><span>1. Bot address (LiveChat → "API URL")</span>
            <div style={{ display: 'flex', gap: 8 }}><input readOnly value={lc.baseUrl} onFocus={(e) => e.target.select()} style={{ flexGrow: 1 }} /><button className="btn" type="button" onClick={() => void copy(lc.baseUrl)}>Copy</button></div>
            <span className="sub" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>LiveChat adds <span className="mono">/api/v1/ai/ask</span> itself. If LiveChat runs on another computer or in Docker, <span className="mono">localhost</span> will not work from there: use the address that computer uses to reach this bot, or set <span className="mono">PUBLIC_URL</span> in .env.</span></label>
          <div className="full"><div className="fld"><span>2. Bot key (LiveChat → "API Key")</span></div>
            {fresh ? (
              <div className="note" style={{ background: 'var(--okbg)', marginTop: 4 }}>
                <b>Copy this key now. It is shown only once.</b>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}><input readOnly className="mono" value={fresh} onFocus={(e) => e.target.select()} style={{ flexGrow: 1 }} /><button className="btn pri" type="button" onClick={() => void copy(fresh)}>Copy key</button></div>
                <div className="sub" style={{ marginTop: 6 }}>Paste it into LiveChat's API Key box and save. The bot cannot show it again, only make a new one.</div>
              </div>
            ) : key ? (
              <div style={{ marginTop: 4 }}><span className="mono">{key.prefix}…</span> <Pill c="ok">Active</Pill>
                <div className="sub">Made {when(key.createdAt)}{key.createdBy ? ' by ' + key.createdBy : ''} · last used by LiveChat: {when(key.lastUsedAt)}{lc.stoppedKeys ? ` · ${lc.stoppedKeys} older key${lc.stoppedKeys > 1 ? 's' : ''} stopped` : ''}</div></div>
            ) : <div className="sub" style={{ marginTop: 4 }}>No key yet. LiveChat cannot use the bot until you make one.</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className={'btn' + (key ? '' : ' pri')} type="button" disabled={busy === 'key'} onClick={makeKey}>{key ? 'Replace key' : 'Make key'}</button>
              {key && <button className="btn" type="button" disabled={busy === 'stop'} onClick={stopKey}>Stop key</button>}
            </div></div>
        </div></div>

      <div className="card"><h3>Test the link</h3>
        <div className="sub">Sends "Can you help?" to the bot the way LiveChat does, using this merchant's knowledge base. It shows the bot's side only; it cannot see whether LiveChat can reach this address. Saved as a test chat.</div>
        <div style={{ marginTop: 8 }}><button className="btn pri" type="button" disabled={busy === 'test'} onClick={runTest}>{busy === 'test' ? 'Testing…' : 'Test the link'}</button></div>
        {test && (
          <div className="note" style={{ marginTop: 10, background: test.hasKey ? 'var(--okbg)' : 'var(--warnbg)' }}>
            <b>The bot answered in {test.ms} ms</b> ({test.decision}).{!test.hasKey && ' Warning: there is no active key yet, so LiveChat cannot get this answer.'}
            <div style={{ whiteSpace: 'pre-wrap', marginTop: 6 }}>{test.answer}</div>
          </div>
        )}</div>

      <div className="card"><h3>AI keys for this merchant</h3>
        <div className="sub">Optional. With its own key, this merchant's AI use is billed to its own account. Without one, the bot uses the shared key from <span className="mono">.env</span>, or runs without AI. Keys are saved encrypted and only the last 4 characters are ever shown.</div>
        <AiKeyRow code={m.code} provider="anthropic" title="Claude (Anthropic)" help="Picks the right answer when no keyword matches, describes new keywords, and translates answers." row={c.ai.anthropic} onChange={load} />
        <AiKeyRow code={m.code} provider="openai" title="ChatGPT (OpenAI)" help="Only used to reword replies, and only if OPENAI_MODEL is set in .env." row={c.ai.openai} onChange={load} />
      </div>
    </>
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
