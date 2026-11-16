import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { usePanel } from '../store';
import type { Flow } from '../model';

interface Out { messages: string[]; buttons: { key: string; label: string }[] | null; state: unknown; handed: boolean; done: boolean }
type Line = { who: 'bot' | 'you' | 'sys'; text: string };

/** The "try it" box: chat with the flow as drawn (also while it is only a draft), step by step. */
export function FlowTry({ flow, lang }: { flow: Flow; lang: string }) {
  const p = usePanel();
  const [lines, setLines] = useState<Line[]>([]); const [state, setState] = useState<unknown>(null); const [buttons, setButtons] = useState<Out['buttons']>(null);
  const [over, setOver] = useState(false); const [text, setText] = useState(''); const [busy, setBusy] = useState(false); const end = useRef<HTMLDivElement>(null);
  const answers = Object.fromEntries(p.draft.kb.filter((e) => e.merchant === p.merchant).map((e) => [e.intent_key, ((e.translations as Record<string, { answer_text?: string }>)[lang]?.answer_text || (e.translations as Record<string, { answer_text?: string }>).en?.answer_text || '')]));
  useEffect(() => { end.current?.scrollIntoView?.({ block: 'nearest' }); }, [lines]);
  useEffect(() => { setLines([]); setState(null); setButtons(null); setOver(false); }, [flow.id]);

  const run = async (st: unknown, input?: { text?: string; pick?: string }, shown?: string) => {
    setBusy(true);
    try {
      const o = await api<Out>('/api/admin/flows/try', { flow, state: st, input, lang, answers });
      setLines((l) => [...l, ...(shown ? [{ who: 'you' as const, text: shown }] : []), ...o.messages.map((t) => ({ who: 'bot' as const, text: t })), ...(o.handed ? [{ who: 'sys' as const, text: 'A person takes over here.' }] : o.done && !o.state ? [{ who: 'sys' as const, text: 'The flow is finished.' }] : [])]);
      setState(o.state); setButtons(o.buttons); setOver(o.done && !o.state);
    } catch (e) { p.toast((e as Error).message); }
    setBusy(false);
  };
  const start = () => { setLines([]); setState(null); setButtons(null); setOver(false); void run(null); };
  const send = () => { const t = text.trim(); if (!t || !state) return; setText(''); void run(state, { text: t }, t); };
  const waiting = !!state && !over;

  return (
    <aside className="card flowtry" aria-label="Try the flow">
      <div className="head"><h3 style={{ margin: 0 }}>Try it</h3><button type="button" className="btn sm" onClick={start} disabled={busy || !flow.blocks.length}>{lines.length ? '↻ Start again' : '▶ Start'}</button></div>
      <div className="sub">Chat with this flow as you drew it, even before you publish. Nothing is saved.</div>
      <div className="tryline" role="log" aria-label="Flow chat">
        {!lines.length && <div className="sub">Press Start to see the first step.</div>}
        {lines.map((l, i) => <div key={i} className={'tl ' + l.who}>{l.text}</div>)}
        {buttons?.length ? <div className="tbtns">{buttons.map((b) => <button key={b.key} type="button" className="btn sm" disabled={busy} onClick={() => void run(state, { pick: b.key }, b.label)}>{b.label}</button>)}</div> : null}
        <div ref={end} />
      </div>
      {waiting && !buttons?.length && <div className="tryin"><input aria-label="Your reply" placeholder="Type the customer's reply" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} /><button type="button" className="btn sm pri" onClick={send} disabled={busy}>Send</button></div>}
      {waiting && buttons?.length ? <div className="sub">Tap a choice, or type the choice in your own words:</div> : null}
      {waiting && buttons?.length ? <div className="tryin"><input aria-label="Your reply" placeholder="or type a reply" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') send(); }} /><button type="button" className="btn sm" onClick={send} disabled={busy}>Send</button></div> : null}
    </aside>
  );
}
