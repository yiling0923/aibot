import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { usePanel } from '../store';

interface Report {
  days: number; total: number; helped: number; notUnderstood: number; handedOver: number; rude: number; byDecision: Record<string, number>; tests: number;
  daily: { day: string; total: number; helped: number; notUnderstood: number; handedOver: number }[];
  topAnswers: { intent: string; n: number }[]; topMissing: { text: string; hits: number }[];
}
/** One big number with a coloured edge and, for shares, a thin bar. */
function Tile({ label, value, note, color, share }: { label: string; value: string; note: string; color: string; share?: number }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderLeft: `5px solid ${color}`, borderRadius: 12, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 34, fontWeight: 700, lineHeight: 1.1, color }}>{value}</div>
      <div className="sub">{note}</div>
      {share !== undefined && <div style={{ background: 'var(--surface2)', borderRadius: 6, height: 6, marginTop: 4 }}><div style={{ width: Math.max(2, share * 100) + '%', height: 6, borderRadius: 6, background: color }} /></div>}
    </div>
  );
}
const pct = (n: number, t: number) => (t ? Math.round((n / t) * 100) : 0) + '%';

/** How the bot is doing for this merchant: what it handled, what it did not understand, what went to a person. */
export default function Report() {
  const p = usePanel(); const nav = useNavigate();
  const [days, setDays] = useState<7 | 30>(7); const [withTest, setWithTest] = useState(true);
  const [r, setR] = useState<Report | null>(null); const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true; setErr('');
    api<Report>(`/api/admin/report?merchant=${encodeURIComponent(p.merchant)}&days=${days}&test=${withTest ? 1 : 0}`).then((x) => { if (alive) setR(x); }).catch((e: Error) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [p.merchant, days, withTest]);

  const max = Math.max(1, ...(r?.daily.map((d) => d.total) ?? [1]));
  const bw = 100 / Math.max(1, r?.daily.length ?? 7);
  return (
    <>
      <div className="card"><div className="head"><div><h2>Report · {p.M.name}</h2><div className="sub">What the bot did with customer messages. Use it to see where it helps and what is still missing.</div></div>
        <div className="tools"><div className="segs" role="group" aria-label="Period">{([7, 30] as const).map((d) => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>Last {d} days</button>)}</div>
          <label className="tog" style={{ padding: 0 }}><input type="checkbox" checked={withTest} onChange={(e) => setWithTest(e.target.checked)} /> Include test chat{r && r.tests ? ` (${r.tests})` : ''}</label></div></div>
        {err && <div className="note" style={{ background: 'var(--badbg)' }}>{err}</div>}</div>
      {r && <>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 14 }}>
          <Tile label="Messages" value={String(r.total)} note={`in the last ${r.days} days`} color="var(--accent)" />
          <Tile label="Answered by bot" value={pct(r.helped, r.total)} note={`${r.helped} messages`} color="var(--ok)" share={r.total ? r.helped / r.total : 0} />
          <Tile label="Not understood" value={pct(r.notUnderstood, r.total)} note={`${r.notUnderstood} messages`} color="var(--warn)" share={r.total ? r.notUnderstood / r.total : 0} />
          <Tile label="Handed to a person" value={pct(r.handedOver, r.total)} note={`${r.handedOver} messages`} color="var(--bad)" share={r.total ? r.handedOver / r.total : 0} />
          {r.rude > 0 && <Tile label="Rude messages" value={String(r.rude)} note="answered kindly first" color="var(--muted)" />}
        </div>
        {!r.total ? <div className="card"><div className="sub">No messages in this period yet. {withTest ? '' : 'Try "Include test chat" to see messages typed in the Test chat.'}</div></div> : <>
          <div className="card"><h3>Messages per day</h3>
            <svg viewBox="0 0 100 42" role="img" aria-label="Messages per day" style={{ width: '100%', height: 190 }} preserveAspectRatio="none">
              {r.daily.map((d, i) => {
                const h = (v: number) => (v / max) * 34; let y = 36;
                const seg = (v: number, c: string) => { const hh = h(v); y -= hh; return hh > 0 ? <rect key={c} x={i * bw + bw * 0.15} y={y} width={bw * 0.7} height={hh} fill={c} /> : null; };
                return <g key={d.day}><title>{`${d.day}: ${d.total} messages, ${d.helped} answered, ${d.notUnderstood} not understood, ${d.handedOver} to a person`}</title>
                  {seg(d.helped, 'var(--ok)')}{seg(d.notUnderstood, 'var(--warn)')}{seg(d.handedOver, 'var(--bad)')}{seg(Math.max(0, d.total - d.helped - d.notUnderstood - d.handedOver), 'var(--line)')}</g>;
              })}
              <line x1="0" y1="36" x2="100" y2="36" stroke="var(--line)" strokeWidth="0.3" />
            </svg>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--muted)' }}><span>{r.daily[0]?.day}</span><span>{r.daily[r.daily.length - 1]?.day}</span></div>
            <div className="sub" style={{ marginTop: 6 }}><span style={{ color: 'var(--ok)' }}>■</span> answered by the bot &nbsp; <span style={{ color: 'var(--warn)' }}>■</span> not understood &nbsp; <span style={{ color: 'var(--bad)' }}>■</span> handed to a person &nbsp; <span style={{ color: 'var(--muted)' }}>■</span> other (rude, etc.)</div></div>
          <div className="card"><h3>Answers used most</h3>
            {r.topAnswers.length ? <table><thead><tr><th>Answer</th><th className="num">Times</th><th style={{ width: '40%' }}></th></tr></thead><tbody>
              {r.topAnswers.map((a) => <tr key={a.intent}><td><b>{a.intent}</b></td><td className="num">{a.n}</td><td><div style={{ background: 'var(--surface2)', borderRadius: 6, height: 10 }}><div style={{ width: (a.n / r.topAnswers[0].n) * 100 + '%', height: 10, borderRadius: 6, background: 'var(--accent)' }} /></div></td></tr>)}</tbody></table>
              : <div className="sub">No answer was used in this period.</div>}</div>
        </>}
        <div className="card"><div className="head"><h3>Not understood most</h3><button className="btn sm" type="button" onClick={() => nav('/admin/unm')}>Open the full list</button></div>
          {r.topMissing.length ? r.topMissing.map((m) => <div className="q" key={m.text}><div className="t">“{m.text}”</div><span className="sub">{m.hits} time{m.hits === 1 ? '' : 's'}</span></div>) : <div className="sub">Nothing is waiting. Every message was understood or already dealt with.</div>}</div>
      </>}
    </>
  );
}
