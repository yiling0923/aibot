import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { usePanel } from '../store';

interface Line { from: 'customer' | 'bot' | 'agent' | 'system'; sender: string; text: string }
interface Result { conversationId: string | null; status: string | null; handoff: string | null; messages: Line[]; replied: boolean }
const store = (k: string, dflt: string) => { try { return localStorage.getItem(k) || dflt; } catch { return dflt; } };
const keep = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const newVisitor = () => 'vis-panel-' + Math.random().toString(36).slice(2, 10);

/**
 * A chat window whose messages go through a LiveChat (your local one, or another), the same way its website widget sends them.
 * The bot server makes the calls (the browser cannot reach LiveChat from another address). Admin only.
 */
export default function LiveChatTest() {
  const p = usePanel();
  const [base, setBase] = useState(() => store('lcBase', 'http://localhost:8080')); const [tenant, setTenant] = useState(() => store('lcTenant', '1'));
  const [visitor, setVisitor] = useState(() => store('lcVisitor', newVisitor()));
  const [lines, setLines] = useState<Line[]>([]); const [info, setInfo] = useState<{ status: string | null; handoff: string | null }>({ status: null, handoff: null });
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [showSet, setShowSet] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }); }, [lines, busy]);

  const call = async (t: string, v = visitor) => {
    setBusy(true); setErr('');
    try {
      const r = await api<Result>('/api/admin/livechat-chat', { baseUrl: base, tenant, visitor: v, text: t });
      setLines(r.messages); setInfo({ status: r.status, handoff: r.handoff });
      if (t && !r.replied) setErr('LiveChat has not answered yet. The bot may be slow, or the bot link is off. Press Send with an empty box to look again.');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => { void call(''); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);     // show the chat that is already open for this visitor

  const send = () => {
    const t = text.trim(); if (busy || !t) return;
    keep('lcBase', base); keep('lcTenant', tenant); keep('lcVisitor', visitor);
    setLines((l) => [...l, { from: 'customer', sender: 'visitor', text: t }]); setText(''); void call(t);
  };
  const fresh = () => { const v = newVisitor(); setVisitor(v); keep('lcVisitor', v); setLines([]); setInfo({ status: null, handoff: null }); setErr(''); p.toast('New chat started'); };

  return (
    <div className="card lcpage"><div className="head"><div><h2>LiveChat test</h2><div className="sub">Chat as a customer through a LiveChat. Your message goes to LiveChat, LiveChat asks your bot, and the reply comes back the same way. It tests the real link.</div></div>
      <span className="lcbtns"><button className="btn sm" type="button" onClick={() => setShowSet((s) => !s)}>{showSet ? 'Hide settings' : 'Settings'}</button><button className="btn sm" type="button" onClick={fresh}>New chat</button></span></div>
      {showSet && <div className="form lcset"><label className="fld"><span>LiveChat address</span><input value={base} onChange={(e) => setBase(e.target.value)} placeholder="http://localhost:8080" /></label>
        <label className="fld"><span>Tenant id</span><input value={tenant} onChange={(e) => setTenant(e.target.value)} style={{ width: 110 }} /></label>
        <div className="sub full">The local setup uses <span className="mono">http://localhost:8080</span> and tenant <span className="mono">1</span>. This is the address the bot server uses, so it must be reachable from the computer that runs the bot.</div></div>}
      <div className="lcbox" aria-live="polite">
        {!lines.length && !busy && <div className="sub lcempty">No messages yet. Write something a customer would ask, for example “how to deposit”.</div>}
        {lines.map((m, i) => <div key={i} className={'lcmsg ' + m.from}>{m.from !== 'customer' && <small>{m.from === 'bot' ? 'Bot' : m.from === 'agent' ? 'Agent' : 'System'}</small>}<div className="lcbub">{m.text}</div></div>)}
        {busy && <div className="lcmsg bot"><small>Bot</small><div className="lcbub lcwait">…</div></div>}
        <div ref={end} />
      </div>
      {err && <div className="note" style={{ background: 'var(--badbg)', marginTop: 8 }}>{err}</div>}
      <div className="lcstat sub">{info.status ? 'Chat status: ' + info.status : 'No chat yet'}{info.handoff ? ' · handoff: ' + info.handoff : ''} · visitor <span className="mono">{visitor}</span></div>
      <form className="lcin" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input aria-label="Message" value={text} placeholder="Type a customer message" onChange={(e) => setText(e.target.value)} disabled={busy} />
        <button className="btn pri" type="submit" disabled={busy || !text.trim()}>{busy ? 'Waiting…' : 'Send'}</button></form>
    </div>
  );
}
