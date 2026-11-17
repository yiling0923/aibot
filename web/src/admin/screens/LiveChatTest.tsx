import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { usePanel } from '../store';
import { IconBtn } from '../ui';

interface Attachment { kind: string; name: string; url: string; mimeType: string; size: number | null }
interface Line { from: 'customer' | 'bot' | 'agent' | 'system'; sender: string; text: string; attachment?: Attachment }
/** A small paperclip drawn like the panel's other icons (the 📎 emoji looks different on every computer). */
const Clip = () => <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ verticalAlign: '-2px' }}><path d="m21 11-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.8-8.8a3.7 3.7 0 0 1 5.2 5.2l-8.8 8.8a1.8 1.8 0 0 1-2.6-2.6l8-8" /></svg>;
const kb = (n: number | null) => (n === null ? '' : n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
/** A file in a message: a picture is shown (click to open it big), anything else is a link with its name. */
function Attached({ a }: { a: Attachment }) {
  const [bad, setBad] = useState(false);
  const isImg = (a.kind === 'image' || a.mimeType.startsWith('image/')) && !bad;
  return isImg
    ? <a className="lcpic" href={a.url} target="_blank" rel="noreferrer" title={'Open ' + a.name}><img src={a.url} alt={a.name} loading="lazy" onError={() => setBad(true)} /><span className="sub">{a.name}{a.size !== null ? ' · ' + kb(a.size) : ''}</span></a>
    : !a.url ? <span className="lcfile"><Clip /> {a.name}{a.size !== null ? ' · ' + kb(a.size) : ''}</span>
    : <a className="lcfile" href={a.url} target="_blank" rel="noreferrer"><Clip /> {a.name}{a.size !== null ? ' · ' + kb(a.size) : ''}{bad ? ' (the picture could not be loaded here)' : ''}</a>;
}
interface Result { conversationId: string | null; status: string | null; handoff: string | null; messages: Line[]; replied: boolean }
/** The LiveChat merchant number the demo merchants have in the local LiveChat (add-merchants.ps1): MERCH_A is 1, MERCH_B is 2 ... MERCH_F is 6. Others are typed once and remembered. */
const demoTenant = (code: string) => { const m = /^MERCH_([A-F])$/.exec(code); return m ? String(m[1].charCodeAt(0) - 64) : null; };
const store = (k: string, dflt: string) => { try { return localStorage.getItem(k) || dflt; } catch { return dflt; } };
const keep = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };
const POLL_MS = 3000;
const newVisitor = () => 'vis-panel-' + Math.random().toString(36).slice(2, 10);

/**
 * A chat window whose messages go through a LiveChat (your local one, or another), the same way its website widget sends them.
 * The bot server makes the calls (the browser cannot reach LiveChat from another address). Admin only.
 */
export default function LiveChatTest() {
  const p = usePanel();
  const [base, setBase] = useState(() => store('lcBase', 'http://localhost:8080')); const [tenant, setTenant] = useState(() => store('lcTenant:' + p.merchant, demoTenant(p.merchant) ?? store('lcTenant', '1')));   // LiveChat picks the bot's merchant by this number, so it is remembered for each merchant
  const [visitor, setVisitor] = useState(() => store('lcVisitor', newVisitor()));
  const [who, setWho] = useState(() => store('lcWho', 'member')); const [mid, setMid] = useState(() => { const v = store('lcMid', '8841'); return v === 'tom8841' ? '8841' : v; });
  const [mname, setMname] = useState(() => store('lcMname', 'Tom')); const [mrank, setMrank] = useState(() => store('lcMrank', 'GOLD'));
  const [lines, setLines] = useState<Line[]>([]); const [info, setInfo] = useState<{ status: string | null; handoff: string | null }>({ status: null, handoff: null });
  const [probe, setProbe] = useState<{ label: string; ok: boolean; answer: string }[] | null>(null); const [probing, setProbing] = useState(false);
  const [pick, setPick] = useState<File | null>(null); const fileIn = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [note, setNote] = useState(''); const [showSet, setShowSet] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'end' }); }, [lines, busy]);

  const call = async (t: string, v = visitor) => {
    setBusy(true); setErr('');
    try {
      const r = await api<Result>('/api/admin/livechat-chat', { baseUrl: base, tenant, visitor: v, text: t, member: who === 'guest' ? null : { id: mid.trim() || 'm-100', name: mname.trim(), rank: mrank.trim() } });
      setLines(r.messages); setInfo({ status: r.status, handoff: r.handoff });
      if (t && !r.replied) setErr('LiveChat has not answered yet. The bot may be slow, or the bot link is off. Press Send with an empty box to look again.');
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  useEffect(() => { void call(''); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);     // show the chat that is already open for this visitor
  // Look at the chat again every few seconds, so what an agent writes in LiveChat shows here without pressing anything.
  const live = useRef({ busy: false, visitor, base, tenant }); live.current = { busy, visitor, base, tenant };
  useEffect(() => {
    const t = setInterval(async () => {
      const c = live.current; if (c.busy || (typeof document !== 'undefined' && document.hidden)) return;
      try {
        const r = await api<Result>('/api/admin/livechat-chat', { baseUrl: c.base, tenant: c.tenant, visitor: c.visitor, text: '' });
        setLines((old) => (old.length === r.messages.length && old.every((m, i) => m.text === r.messages[i].text && m.attachment?.url === r.messages[i].attachment?.url) ? old : r.messages)); setInfo({ status: r.status, handoff: r.handoff });
      } catch { /* the next look tries again */ }
    }, POLL_MS);
    return () => clearInterval(t);
  }, []);

  const MAX_FILE = 10 * 1024 * 1024; const OK_TYPE = /^(image\/(jpeg|png)|video\/(mp4|quicktime)|application\/pdf)$/;
  const choose = (f: File | null | undefined) => {
    if (!f) return;
    if (f.size > MAX_FILE) { setErr('That file is too big (the most is 10 MB).'); return; }
    if (!OK_TYPE.test(f.type)) { setErr('This kind of file is not allowed here. LiveChat takes JPEG or PNG pictures, MP4 or MOV videos and PDF files from a customer.'); return; }
    setErr(''); setPick(f);
  };
  const toBase64 = (f: File) => new Promise<string>((ok, no) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] ?? ''); r.onerror = () => no(new Error('Could not read the file.')); r.readAsDataURL(f); });
  const sendFile = async () => {
    const f = pick; if (busy || !f) return; const caption = text.trim();
    keep('lcBase', base); keep('lcTenant', tenant); keep('lcTenant:' + p.merchant, tenant); keep('lcVisitor', visitor);
    setLines((l) => [...l, { from: 'customer', sender: 'visitor', text: caption || f.name, attachment: f.type.startsWith('image/') ? { kind: 'image', name: f.name, url: URL.createObjectURL(f), mimeType: f.type, size: f.size } : { kind: 'file', name: f.name, url: '', mimeType: f.type, size: f.size } }]);
    setPick(null); setText(''); setBusy(true); setErr(''); setNote('');
    try {
      const r = await api<Result>('/api/admin/livechat-chat', { baseUrl: base, tenant, visitor, text: caption, file: { name: f.name, type: f.type, data: await toBase64(f) }, member: who === 'guest' ? null : { id: mid.trim() || 'm-100', name: mname.trim(), rank: mrank.trim() } });
      setLines(r.messages); setInfo({ status: r.status, handoff: r.handoff });
      if (!r.replied) setNote('The picture or file went to LiveChat. If the picture patch is in LiveChat (deploy/local-livechat/patches/002-picture-to-bot.patch) the bot answers in a moment and this page refreshes by itself. Without it LiveChat does not ask the bot about a picture, so your team takes it.');
    } catch (e) { const m = (e as Error).message; setErr(m); if (/refused this file/.test(m)) void checkFiles(true); } finally { setBusy(false); }      // refused: ask LiveChat at once which kinds it takes
  };
  const send = () => {
    if (pick) { void sendFile(); return; }
    const t = text.trim(); if (busy || !t) return;
    keep('lcBase', base); keep('lcTenant', tenant); keep('lcTenant:' + p.merchant, tenant); keep('lcVisitor', visitor);
    setLines((l) => [...l, { from: 'customer', sender: 'visitor', text: t }]); setText(''); void call(t);
  };
  const checkFiles = async (keepErr = false) => {
    setProbing(true); setProbe(null); if (!keepErr) setErr('');
    try { setProbe((await api<{ rows: { label: string; ok: boolean; answer: string }[] }>('/api/admin/livechat-chat/probe', { baseUrl: base, tenant })).rows); } catch (e) { setErr((e as Error).message); } finally { setProbing(false); }
  };
  const firstMerchant = useRef(true);
  useEffect(() => {                                                   // another merchant chosen in the sidebar: its own LiveChat merchant number, and a new chat (a chat belongs to one LiveChat merchant)
    if (firstMerchant.current) { firstMerchant.current = false; return; }
    setTenant(store('lcTenant:' + p.merchant, demoTenant(p.merchant) ?? store('lcTenant', '1')));
    const v = newVisitor(); setVisitor(v); keep('lcVisitor', v); setLines([]); setInfo({ status: null, handoff: null }); setErr(''); setNote('');
  }, [p.merchant]);
  const fresh = () => { const v = newVisitor(); setVisitor(v); keep('lcVisitor', v); setLines([]); setInfo({ status: null, handoff: null }); setErr(''); setNote(''); p.toast('New chat started'); };

  return (
    <div className="card lcpage"><div className="head"><div><h2>LiveChat test</h2><div className="sub">Chat as a customer through a LiveChat. Your message goes to LiveChat, LiveChat asks your bot, and the reply comes back the same way. It tests the real link.</div></div>
      <span className="lcbtns"><button className="btn sm" type="button" onClick={() => setShowSet((s) => !s)}>{showSet ? 'Hide settings' : 'Settings'}</button><button className="btn sm" type="button" onClick={fresh}>New chat</button></span></div>
      {showSet && <div className="form lcset"><label className="fld"><span>LiveChat address</span><input value={base} onChange={(e) => setBase(e.target.value)} placeholder="http://localhost:8080" /></label>
        <label className="fld"><span>Tenant id (the LiveChat merchant number)</span><input value={tenant} onChange={(e) => setTenant(e.target.value)} style={{ width: 110 }} /><span className="lock">LiveChat picks the bot's merchant by this number, not by the merchant chosen in the sidebar. For {p.M.name} use the number of {p.M.name} in LiveChat: pick it there and read tenant_id= in the address bar.</span></label>
        <label className="fld"><span>The customer is</span><select aria-label="The customer is" value={who} onChange={(e) => { setWho(e.target.value); keep('lcWho', e.target.value); fresh(); }}><option value="member">Logged in (a member)</option><option value="guest">Not logged in (a guest)</option></select></label>
        {who === 'member' && <><label className="fld"><span>Member id</span><input value={mid} onChange={(e) => { setMid(e.target.value); keep('lcMid', e.target.value); }} style={{ width: 150 }} /><span className="lock">Sample members: 8841 (Tom), 9120 (Mary)</span></label>
          <label className="fld"><span>Name</span><input value={mname} onChange={(e) => { setMname(e.target.value); keep('lcMname', e.target.value); }} style={{ width: 150 }} /></label>
          <label className="fld"><span>Rank</span><input value={mrank} onChange={(e) => { setMrank(e.target.value); keep('lcMrank', e.target.value); }} style={{ width: 110 }} /></label></>}
        <div className="full"><button className="btn sm" type="button" disabled={probing} onClick={() => void checkFiles()}>{probing ? 'Asking LiveChat…' : 'Check which files LiveChat accepts'}</button>
          <span className="sub"> Sends one tiny sample of each kind into a new test chat in LiveChat.</span>
          {probe && <ul className="plain" aria-label="Files LiveChat accepts" style={{ marginTop: 6 }}>{probe.map((r) => <li key={r.label}><b>{r.label}</b>: {r.ok ? <span style={{ color: 'var(--ok)' }}>accepted</span> : <span style={{ color: 'var(--bad)' }}>refused, “{r.answer}”</span>}</li>)}</ul>}</div>
        <div className="sub full">Changing who the customer is starts a new chat, because LiveChat fixes the customer when a chat starts. A logged-in member only gets their own account answer when the merchant switched on "Account answers in LiveChat" (Merchant settings) and LiveChat sends the member to the bot (patch: deploy/local-livechat/patches/001-member-to-bot.patch). Otherwise "check my balance" goes to a person for both.</div>
        <div className="sub full">The local setup uses <span className="mono">http://localhost:8080</span> and tenant <span className="mono">1</span>. This is the address the bot server uses, so it must be reachable from the computer that runs the bot.</div></div>}
      <div className="lcbox" aria-live="polite">
        {!lines.length && !busy && <div className="sub lcempty">No messages yet. Write something a customer would ask, for example “how to deposit”.</div>}
        {lines.map((m, i) => <div key={i} className={'lcmsg ' + m.from}>{m.from !== 'customer' && <small>{m.from === 'bot' ? 'Bot' : m.from === 'agent' ? 'Agent' : 'System'}</small>}<div className="lcbub">{m.attachment ? <Attached a={m.attachment} /> : m.text}</div></div>)}
        {busy && <div className="lcmsg bot"><small>Bot</small><div className="lcbub lcwait">…</div></div>}
        <div ref={end} />
      </div>
      {err && <div className="note" style={{ background: 'var(--badbg)', marginTop: 8 }}>{err}</div>}
      {note && !err && <div className="note" style={{ marginTop: 8 }} aria-label="About the file">{note}</div>}
      {(probing || probe) && !showSet && <div className="note" style={{ marginTop: 8 }} aria-label="Files LiveChat accepts, checked now">{probing ? 'Asking LiveChat which kinds of file it takes…' : <><b>What LiveChat takes from a customer:</b>
        <ul className="plain">{probe!.map((r) => <li key={r.label}><b>{r.label}</b>: {r.ok ? <span style={{ color: 'var(--ok)' }}>accepted</span> : <span style={{ color: 'var(--bad)' }}>refused</span>}</li>)}</ul>
        <div className="sub">Send one of the accepted kinds. A test chat was made in LiveChat for this check.</div></>}</div>}
      <div className="lcstat sub">{'LiveChat merchant #' + tenant + ' · '}{who === 'guest' ? 'Customer: not logged in · ' : 'Customer: ' + (mname || mid) + ' (' + mid + ') · '}{info.status ? 'Chat status: ' + info.status : 'No chat yet'}{info.handoff ? ' · handoff: ' + info.handoff : ''} · visitor <span className="mono">{visitor}</span></div>
      <form className="lcin" onSubmit={(e) => { e.preventDefault(); send(); }}>
        <input ref={fileIn} type="file" hidden aria-label="Choose a picture or file" accept="image/jpeg,image/png,video/mp4,video/quicktime,application/pdf,.mov" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />
        <IconBtn tip="Attach a picture or file" onClick={() => { if (!busy) fileIn.current?.click(); }}><path d="m21 11-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.8-8.8a3.7 3.7 0 0 1 5.2 5.2l-8.8 8.8a1.8 1.8 0 0 1-2.6-2.6l8-8" /></IconBtn>
        <input aria-label="Message" value={text} placeholder={pick ? 'Add a line to go with it (optional)' : 'Type a customer message'} onChange={(e) => setText(e.target.value)} disabled={busy} />
        <button className="btn pri" type="submit" disabled={busy || (!text.trim() && !pick)}>{busy ? 'Waiting…' : 'Send'}</button></form>
      {pick && <div className="lcpick"><span><Clip /> {pick.name} · {kb(pick.size)}</span><button type="button" className="x" aria-label="Remove the file" onClick={() => setPick(null)}>×</button></div>}
    </div>
  );
}
