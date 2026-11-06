import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '../styles/chat.css';
import { api } from '../lib/api';
import Brain from './Brain';
import type { Button, Customer, MerchantRow, StartResponse, Trace, TurnResponse } from './chatTypes';

const ACC: Record<string, string> = { MERCH_A: '#0E7C86', MERCH_B: '#3A4FA3', MERCH_C: '#B4541A', MERCH_D: '#7A3E9D', MERCH_E: '#2E7D32', MERCH_F: '#C2185B' };

type Item =
  | { t: 'msg'; kind: string; text: string }
  | { t: 'typing' }
  | { t: 'opts'; buttons: Button[]; lang: string; disabled?: boolean; picked?: string };

const disableAll = (items: Item[], picked?: string): Item[] => items.map((i) => (i.t === 'opts' ? { ...i, disabled: true, picked: picked ?? i.picked } : i));
const shortToken = (tok: string) => (tok.length > 46 ? tok.slice(0, 30) + '…' + tok.slice(-12) : tok);

/** The test chat. The bot's decisions and replies come from the server; this page only draws them. */
export default function Chat() {
  const qs = useMemo(() => new URLSearchParams(window.location.search), []);
  const draft = qs.get('draft');
  const embedded = window.parent !== window;

  const [merchants, setMerchants] = useState<MerchantRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [cur, setCur] = useState<MerchantRow | null>(null);
  const [identKey, setIdentKey] = useState('tom');
  const [identity, setIdentity] = useState<StartResponse['identity']>({ state: 'none' });
  const [items, setItems] = useState<Item[]>([]);
  const [trace, setTrace] = useState<Trace | null>(null);
  const [status, setStatus] = useState('Online');
  const [locked, setLocked] = useState(false);
  const [input, setInput] = useState('');
  const [saved, setSaved] = useState('Nothing saved yet.');
  const [failed, setFailed] = useState<string | null>(null);

  const session = useRef<string | null>(null);
  const closed = useRef(false), handed = useRef(false), busy = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const msgsEnd = useRef<HTMLDivElement>(null);

  useEffect(() => { if (embedded) document.body.classList.add('embedded'); return () => document.body.classList.remove('embedded'); }, [embedded]);
  useEffect(() => { msgsEnd.current?.scrollIntoView({ block: 'end' }); }, [items]);
  useEffect(() => {
    const c = (cur && ACC[cur.code]) || '#0E7C86';
    document.documentElement.style.setProperty('--accent', c); document.documentElement.style.setProperty('--cust', c);
  }, [cur]);

  const refreshSaved = useCallback(async (m: MerchantRow, fresh?: string[]) => {
    try {
      const s = await api<{ words: number; unmatched: number }>('/api/keywords/summary?merchant=' + encodeURIComponent(m.code));
      setSaved(`Saved to Keywords for ${m.name}: ${s.words} word${s.words === 1 ? '' : 's'} · ${s.unmatched} message${s.unmatched === 1 ? '' : 's'} not understood.` + (fresh && fresh.length ? ` New: ${fresh.slice(0, 5).join(', ')}${fresh.length > 5 ? '…' : ''}` : ''));
    } catch { /* the page still works without it */ }
  }, []);

  const newChat = useCallback(async (m: MerchantRow, ident: string, custs: Customer[]) => {
    clearTimeout(timer.current); closed.current = false; handed.current = false; setLocked(false);
    const cust = custs.find((c) => c.key === ident);
    const r = await api<StartResponse>('/api/chat/start', { merchant: m.code, token: cust ? cust.token : null, draft });
    session.current = r.sessionId; setIdentity(r.identity); setStatus('Online');
    setItems([{ t: 'msg', kind: r.greeting.kind, text: r.greeting.text }]); setTrace(null);
    void refreshSaved(m);
  }, [draft, refreshSaved]);

  /** Shows a server turn: its messages, then its buttons. */
  const showTurn = useCallback((data: TurnResponse, lang: string, instant?: boolean) => {
    const t = data.turn; if (!t) return;
    const add = () => {
      setItems((it) => [
        ...it.filter((i) => i.t !== 'typing'),
        ...t.messages.map((m): Item => ({ t: 'msg', kind: m.kind, text: m.text })),
        ...(t.buttons ? [{ t: 'opts', buttons: t.buttons, lang } as Item] : []),
      ]);
      if (t.status) setStatus(t.status);
      if (t.locked) setLocked(true);
    };
    closed.current = data.closed; handed.current = data.handed;
    if (instant) add();
    else { setItems((it) => [...it, { t: 'typing' }]); timer.current = setTimeout(add, 650); }
  }, []);

  const handle = useCallback(async (raw: string, instant?: boolean) => {
    const text = raw.trim();
    if (!text || closed.current || busy.current || !cur) return;
    busy.current = true;
    setItems((it) => [...disableAll(it), { t: 'msg', kind: 'cust', text }]);
    try {
      const data = await api<TurnResponse>('/api/chat/message', { sessionId: session.current, text, silent: !!instant });
      if (!data.turn) return;
      setTrace(data.turn.trace);
      showTurn(data, 'lang' in data.turn.trace ? data.turn.trace.lang : 'en', instant);
      if (!instant) {
        void refreshSaved(cur, data.saved?.fresh);
        try { if (window.parent !== window) window.parent.postMessage({ kind: 'botlog', fresh: data.saved?.fresh ?? [] }, '*'); } catch { /* not embedded */ }
      }
    } catch (e) { setItems((it) => [...it, { t: 'msg', kind: 'sys bad', text: 'Error: ' + (e as Error).message }]); }
    finally { busy.current = false; }
  }, [cur, refreshSaved, showTurn]);

  const pick = useCallback(async (b: Button, lang: string) => {
    if (closed.current || handed.current || busy.current) return;
    busy.current = true;
    setItems((it) => [...disableAll(it, b.kind + ':' + b.key), { t: 'msg', kind: 'cust', text: b.label }]);
    try {
      const data = await api<TurnResponse>('/api/chat/pick', { sessionId: session.current, kind: b.kind, key: b.key, amt: b.amt, label: b.label, lang });
      if (!data.turn) return;
      setTrace(data.turn.trace); showTurn(data, lang);
    } catch (e) { setItems((it) => [...it, { t: 'msg', kind: 'sys bad', text: 'Error: ' + (e as Error).message }]); }
    finally { busy.current = false; }
  }, [showTurn]);

  // first load: merchants, fake customers, then a silent demo message (not saved as keywords)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let ms = await api<MerchantRow[]>('/api/merchants' + (draft ? '?draft=' + encodeURIComponent(draft) : ''));
        if (qs.get('only')) ms = ms.filter((m) => m.code === qs.get('only'));
        let custs: Customer[], ident = 'tom';
        try { custs = await api<Customer[]>('/api/dev/customers'); } catch { custs = [{ key: 'guest', label: 'Not logged in', token: null }]; ident = 'guest'; }
        const m = ms.find((x) => x.code === qs.get('merchant')) || ms[0];
        if (!alive || !m) return;
        setMerchants(ms); setCustomers(custs); setIdentKey(ident); setCur(m);
        await newChat(m, ident, custs);
        if (alive) { busy.current = false; closed.current = false; void handleSilent(m); }
      } catch (e) { if (alive) setFailed((e as Error).message); }
    })();
    return () => { alive = false; clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the silent demo message needs `cur`, which only exists after the state above has been set
  const handleSilent = async (m: MerchantRow) => {
    busy.current = true;
    setItems((it) => [...it, { t: 'msg', kind: 'cust', text: 'dep belum masuk lah' }]);
    try {
      const data = await api<TurnResponse>('/api/chat/message', { sessionId: session.current, text: 'dep belum masuk lah', silent: true });
      if (data.turn) { setTrace(data.turn.trace); showTurn(data, 'lang' in data.turn.trace ? data.turn.trace.lang : 'en', true); }
    } catch { /* the demo message is optional */ }
    finally { busy.current = false; void m; }
  };

  const switchMerchant = (m: MerchantRow) => { setCur(m); void newChat(m, identKey, customers); };
  const switchWho = (key: string) => { setIdentKey(key); if (cur) void newChat(cur, key, customers); };
  const restart = () => { if (cur) void newChat(cur, identKey, customers); };

  const tok = customers.find((c) => c.key === identKey)?.token;
  const identText = identity.state === 'valid'
    ? <><span className="okc">✔ signature valid</span> → customer_id {identity.id} ({identity.name})</>
    : identity.state === 'invalid' ? <><span className="badc">✖ signature does not match</span> → token ignored, nobody is identified</>
    : <span className="mutec">no token → nobody is identified</span>;

  if (failed) return <div className="wrap"><div className="m sys bad">Cannot reach the bot server: {failed}</div></div>;
  return (
    <div className="wrap">
      <div className="top">
        <div>
          <h1>LiveChat AI bot, test chat</h1>
          <p>Pick a merchant and type like a customer. The panel on the right shows each step the bot takes. When the message is too short to tell, the bot shows buttons and the customer taps one. Choose who is chatting (as the merchant website would send it) to see account lookups. This runs on your own computer with the data in your database. Every word you type is saved to Keywords automatically.</p>
        </div>
        <label className="mpick"><span>Merchant</span>
          <select value={cur?.code ?? ''} onChange={(e) => { const m = merchants.find((x) => x.code === e.target.value); if (m) switchMerchant(m); }}>
            {merchants.map((m) => <option key={m.code} value={m.code}>{m.name} · {m.tone} tone · {m.defaultLanguage.toUpperCase()}</option>)}
          </select>
        </label>
      </div>

      <div className="grid">
        <div className="col">
          <section className="who" aria-label="Data the merchant website sends with the chat">
            <div className="who-h"><b>Website sends with the chat</b><span className="note">fake customers, signed with your secret</span></div>
            <div className="seg small" role="group" aria-label="Who is chatting">
              {customers.map((c) => <button key={c.key} type="button" aria-pressed={c.key === identKey} onClick={() => switchWho(c.key)}>{c.label}</button>)}
            </div>
            <div className="whoinfo">customer_token: {tok ? shortToken(tok) : <span className="mutec">(none sent)</span>}<br />bot check: {identText}</div>
          </section>

          <section className="chat" aria-label="Customer chat window">
            <div className="chat-h">
              <div className="av">{(cur?.name ?? '').slice(0, 2).toUpperCase()}</div>
              <div><div className="nm">{cur?.name}</div><div className="st"><span className="dot" /><span>{status}</span></div></div>
              <span className="badge">AI assistant</span>
            </div>
            <div className="msgs" aria-live="polite">
              {items.map((i, k) => {
                if (i.t === 'msg') return <div key={k} className={'m ' + i.kind}>{i.text}</div>;
                if (i.t === 'typing') return <div key={k} className="m bot typing"><i /><i /><i /></div>;
                return (
                  <div key={k} className="opts">
                    {i.buttons.map((b) => (
                      <button key={b.kind + b.key} type="button" disabled={i.disabled}
                        className={'opt' + (b.kind === 'agent' ? ' agent' : '') + (i.picked === b.kind + ':' + b.key ? ' picked' : '')}
                        onClick={() => void pick(b, i.lang)}>{b.label}</button>
                    ))}
                  </div>
                );
              })}
              <div ref={msgsEnd} />
            </div>
            <form className="in" onSubmit={(e) => { e.preventDefault(); const v = input; setInput(''); void handle(v); }}>
              <input autoComplete="off" placeholder="Type a message…" aria-label="Message" value={input} disabled={locked} onChange={(e) => setInput(e.target.value)} />
              <button type="submit" disabled={locked}>Send</button>
            </form>
          </section>

          <section className="try">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button className="btn ghost" type="button" onClick={restart}>New chat</button><span className="note">{saved}</span>
            </div>
          </section>
        </div>

        <section className="brain" aria-label="Bot reasoning">
          <div className="brain-h"><h2>What the bot did with the last message</h2><span className="tag">live</span></div>
          <div><Brain trace={trace} /></div>
        </section>
      </div>
    </div>
  );
}
