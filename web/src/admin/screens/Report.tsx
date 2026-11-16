import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { usePanel } from '../store';
import { IconBtn } from '../ui';

interface Report {
  days: number; total: number; helped: number; notUnderstood: number; handedOver: number; rude: number; byDecision: Record<string, number>; tests: number;
  daily: { day: string; total: number; helped: number; notUnderstood: number; handedOver: number }[];
  topTopics: { topic: string; n: number }[]; handedByTopic: { topic: string; handed: number; total: number }[]; topKeywords: { word: string; n: number }[];
  accuracy: { right: number; wrong: number; checked: number; wrongRate: number | null }; recent: { id: number; question: string; answer: string; topic: string | null; at: string; verdict: 'right' | 'wrong' | null }[];
  topAnswers: { intent: string; n: number }[]; topMissing: { text: string; hits: number }[];
}

/** Soft colours, the same in the tiles, the chart, the ring and the legend. */
const COL = { ans: '#7fc4a8', not: '#f0c27b', hand: '#e89a9a', oth: '#b9c3cf', topic: '#9b8bd8', kw: '#7fa8e8' };
const PARTS: { k: 'helped' | 'notUnderstood' | 'handedOver' | 'other'; label: string; color: string }[] = [
  { k: 'helped', label: 'Answered by the bot', color: COL.ans }, { k: 'notUnderstood', label: 'Not understood', color: COL.not },
  { k: 'handedOver', label: 'Handed to a person', color: COL.hand }, { k: 'other', label: 'Other (rude, etc.)', color: COL.oth },
];
const pct = (n: number, t: number) => (t ? Math.round((n / t) * 100) : 0);
const day = (iso: string, long = false) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', long ? { weekday: 'short', day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric' });
const parts = (d: { total: number; helped: number; notUnderstood: number; handedOver: number }) => ({ helped: d.helped, notUnderstood: d.notUnderstood, handedOver: d.handedOver, other: Math.max(0, d.total - d.helped - d.notUnderstood - d.handedOver) });

/** A big number with a thin coloured edge. */
function Tile({ label, value, note, color }: { label: string; value: string; note: string; color: string }) {
  return <div className="rptile"><i style={{ background: color }} /><small>{label}</small><b>{value}</b><span>{note}</span></div>;
}

/** A list of bars. Hover a row to see the exact number. */
function BarList({ rows, color, empty }: { rows: { label: string; n: number; tip: string }[]; color: string; empty: string }) {
  const m = Math.max(1, ...rows.map((x) => x.n));
  if (!rows.length) return <div className="sub">{empty}</div>;
  return <div className="rpbars">{rows.map((x) => <div className="rpbar" key={x.label} title={x.tip}><span className="rplab">{x.label}</span><div className="rptrack"><i style={{ width: Math.max(4, (x.n / m) * 100) + '%', background: color }} /></div><b>{x.n}</b></div>)}</div>;
}

/** Messages per day: every day of the period, with the day names, a number scale and a card with the numbers when the mouse is over a day. */
function DayChart({ daily }: { daily: Report['daily'] }) {
  const [hov, setHov] = useState<number | null>(null);
  const W = 760, H = 230, L = 40, R = 8, T = 10, B = 30; const pw = W - L - R, ph = H - T - B; const n = daily.length;
  const m = Math.max(1, ...daily.map((d) => d.total)); const step = m <= 5 ? 1 : m <= 10 ? 2 : m <= 25 ? 5 : m <= 50 ? 10 : m <= 100 ? 20 : m <= 250 ? 50 : 100;
  const top = Math.ceil(m / step) * step; const grp = pw / n, bw = Math.min(64, grp * 0.68); const y = (v: number) => T + ph - (v / top) * ph;
  const every = n <= 10 ? 1 : n <= 20 ? 2 : 5;
  const d = hov === null ? null : daily[hov]; const pd = d ? parts(d) : null; const cx = hov === null ? 0 : L + grp * hov + grp / 2;
  return (
    <div className="rpchart" onMouseLeave={() => setHov(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Messages per day" style={{ width: '100%', display: 'block' }}>
        {Array.from({ length: top / step + 1 }, (_, i) => i * step).map((g) => <g key={g}><line x1={L} x2={W - R} y1={y(g)} y2={y(g)} stroke="var(--line)" strokeDasharray={g === 0 ? '0' : '3 4'} /><text x={L - 8} y={y(g) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{g}</text></g>)}
        {daily.map((dd, i) => {
          const x = L + grp * i + (grp - bw) / 2; let yy = y(0); const p = parts(dd);
          return (
            <g key={dd.day} tabIndex={0} onMouseEnter={() => setHov(i)} onFocus={() => setHov(i)} onBlur={() => setHov(null)} aria-label={`${day(dd.day, true)}: ${dd.total} messages`}>
              <rect x={L + grp * i} y={T} width={grp} height={ph} fill={hov === i ? 'var(--accent)' : 'transparent'} opacity={hov === i ? 0.07 : 1} rx="6" />
              {dd.total === 0 && <rect x={x} y={y(0) - 3} width={bw} height="3" rx="1.5" fill="var(--line)" />}
              {PARTS.map((pt) => { const v = p[pt.k]; if (!v) return null; const h = (v / top) * ph; yy -= h; return <rect key={pt.k} x={x} y={yy} width={bw} height={h} fill={pt.color} rx="2" opacity={hov === null || hov === i ? 1 : 0.55} />; })}
              {i % every === 0 && <text x={x + bw / 2} y={H - 9} textAnchor="middle" fontSize="11.5" fill={hov === i ? 'var(--fg)' : 'var(--muted)'} fontWeight={hov === i ? 700 : 400}>{day(dd.day)}</text>}
            </g>
          );
        })}
      </svg>
      {d && pd && (
        <div className="rptip" role="tooltip" style={{ left: Math.min(84, Math.max(16, (cx / W) * 100)) + '%' }}>
          <b>{day(d.day, true)} · {d.total} message{d.total === 1 ? '' : 's'}</b>
          {d.total === 0 ? <div className="r"><span>No messages this day</span></div> : PARTS.map((pt) => <div className="r" key={pt.k}><span><s style={{ background: pt.color }} />{pt.label}</span><b>{pd[pt.k]} · {pct(pd[pt.k], d.total)}%</b></div>)}
        </div>
      )}
      <div className="rpleg">{PARTS.map((pt) => <span key={pt.k}><s style={{ background: pt.color }} />{pt.label}</span>)}</div>
    </div>
  );
}

/** Where the messages went, as a ring. Hover a part to see its number in the middle. */
function Ring({ r }: { r: Report }) {
  const [hov, setHov] = useState<number | null>(null);
  const v = parts(r); const R = 70, C = 2 * Math.PI * R; let off = 0;
  const h = hov === null ? null : PARTS[hov];
  return (
    <div className="rpring">
      <svg viewBox="0 0 200 200" role="img" aria-label="Where the messages went" width="190" height="190" onMouseLeave={() => setHov(null)}>
        <circle cx="100" cy="100" r={R} fill="none" stroke="var(--surface2)" strokeWidth="26" />
        {PARTS.map((pt, i) => { const len = (v[pt.k] / Math.max(1, r.total)) * C; const el = len > 0 ? <circle key={pt.k} cx="100" cy="100" r={R} fill="none" stroke={pt.color} strokeWidth={hov === i ? 30 : 26} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} transform="rotate(-90 100 100)" tabIndex={0} aria-label={`${pt.label}: ${v[pt.k]}`} onMouseEnter={() => setHov(i)} onFocus={() => setHov(i)} onBlur={() => setHov(null)}><title>{`${pt.label}: ${v[pt.k]} (${pct(v[pt.k], r.total)}%)`}</title></circle> : null; off += len; return el; })}
        <text x="100" y={h ? 96 : 104} textAnchor="middle" fontSize="30" fontWeight="800" fill="var(--fg)">{h ? v[h.k] : r.total}</text>
        <text x="100" y={h ? 117 : 124} textAnchor="middle" fontSize="12" fill="var(--muted)">{h ? `${h.label} · ${pct(v[h.k], r.total)}%` : 'messages'}</text>
      </svg>
      <div className="sub" style={{ textAlign: 'center' }}>Hover a part of the ring to see the number</div>
    </div>
  );
}

/** How the bot is doing for this merchant: what it handled, what it did not understand, what went to a person. */
export default function Report() {
  const p = usePanel(); const [days, setDays] = useState<7 | 30>(7); const [withTest, setWithTest] = useState(true);
  const [r, setR] = useState<Report | null>(null); const [err, setErr] = useState('');
  const load = () => api<Report>(`/api/admin/report?merchant=${encodeURIComponent(p.merchant)}&days=${days}&test=${withTest ? 1 : 0}`);
  useEffect(() => {
    let alive = true; setErr('');
    load().then((x) => { if (alive) setR(x); }).catch((e: Error) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.merchant, days, withTest]);

  const mark = async (id: number, verdict: 'right' | 'wrong' | null) => {
    try { await api('/api/admin/feedback', { merchant: p.merchant, decisionId: id, verdict }); setR(await load()); } catch (e) { p.toast((e as Error).message); }
  };
  const v = r ? parts(r) : null; const a = r?.accuracy;
  return (
    <>
      <div className="head"><div><h2 style={{ margin: 0 }}>Report · {p.M.name}</h2><div className="sub">What the bot did with customer messages. Hover a bar or a ring to see the numbers.</div></div>
        <div className="tools"><div className="segs" role="group" aria-label="Period">{([7, 30] as const).map((d) => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>Last {d} days</button>)}</div>
          <label className="switch"><input type="checkbox" role="switch" checked={withTest} onChange={(e) => setWithTest(e.target.checked)} /><span className="track"><span className="thumb" /></span> Include test chat{r && r.tests ? ` (${r.tests})` : ''}</label></div></div>
      {err && <div className="note" style={{ background: 'var(--badbg)' }}>{err}</div>}
      {r && v && <>
        <div className="rptiles">
          <Tile label="Messages" value={String(r.total)} note={`in the last ${r.days} days`} color="var(--accent)" />
          <Tile label="Answered by bot" value={pct(r.helped, r.total) + '%'} note={`${r.helped} messages`} color={COL.ans} />
          <Tile label="Not understood" value={pct(r.notUnderstood, r.total) + '%'} note={`${r.notUnderstood} messages`} color={COL.not} />
          <Tile label="Handed to a person" value={pct(r.handedOver, r.total) + '%'} note={`${r.handedOver} messages`} color={COL.hand} />
          <Tile label="Wrong-answer rate" value={a?.wrongRate === null || !a ? '—' : Math.round(a.wrongRate * 100) + '%'} note={a && a.checked ? `${a.wrong} of ${a.checked} checked` : 'no answer checked yet'} color={COL.oth} />
        </div>
        {!r.total ? <div className="card"><div className="sub">No messages in this period yet. {withTest ? '' : 'Try "Include test chat" to see the messages typed in the tests.'}</div></div> : <div className="rpg2">
          <div className="card"><h3 style={{ margin: 0 }}>Messages per day</h3><div className="sub" style={{ marginBottom: 6 }}>Every day of the period is shown, also the days with no messages.</div><DayChart daily={r.daily} /></div>
          <div className="card"><h3 style={{ margin: 0 }}>Where the messages went</h3><Ring r={r} /></div>
        </div>}
        <div className="rpg3">
          <div className="card"><h3>Top topics</h3><BarList color={COL.topic} empty="No topic was asked about in this period." rows={r.topTopics.map((t) => ({ label: t.topic, n: t.n, tip: `${t.topic}: ${t.n} message${t.n === 1 ? '' : 's'} (${pct(t.n, r.total)}% of all)` }))} /></div>
          <div className="card"><h3>Top keywords</h3><BarList color={COL.kw} empty="No keyword was used yet. Chats before this report was added are not counted." rows={r.topKeywords.map((k) => ({ label: k.word, n: k.n, tip: `${k.word}: heard ${k.n} time${k.n === 1 ? '' : 's'}` }))} /></div>
          <div className="card"><h3>Answers used most</h3><BarList color={COL.ans} empty="No answer was used in this period." rows={r.topAnswers.map((x) => ({ label: x.intent, n: x.n, tip: `${x.intent}: used ${x.n} time${x.n === 1 ? '' : 's'}` }))} /></div>
        </div>
        <div className="rpg2b">
          <div className="card"><h3>Topics handed to a person most</h3><div className="sub" style={{ marginBottom: 6 }}>Messages on this topic that went to a person or were not understood. A topic high here often needs a better answer.</div>
            <BarList color={COL.hand} empty="None in this period." rows={r.handedByTopic.map((t) => ({ label: t.topic, n: t.handed, tip: `${t.topic}: ${t.handed} of ${t.total} messages (${pct(t.handed, t.total)}%) went to a person or were not understood` }))} /></div>
          <div className="card"><h3>Check recent answers</h3><div className="sub" style={{ marginBottom: 4 }}>The last answers the bot gave. Mark each one right or wrong; this feeds the wrong-answer rate.</div>
            {r.recent.length ? r.recent.map((x) => <div className="rprec" key={x.id}><div><div className="rpq">“{x.question}”{x.topic ? <span className="rptag">{x.topic}</span> : null}</div><div className="sub rpans">{x.answer}</div></div>
              <span className="rpact"><IconBtn tip="Right" pressed={x.verdict === 'right'} onClick={() => void mark(x.id, x.verdict === 'right' ? null : 'right')}><path d="m5 12 4 4 10-10" /></IconBtn><IconBtn tip="Wrong" danger pressed={x.verdict === 'wrong'} onClick={() => void mark(x.id, x.verdict === 'wrong' ? null : 'wrong')}><path d="M6 6l12 12M18 6 6 18" /></IconBtn></span></div>)
              : <div className="sub">No answers in this period.</div>}</div>
        </div>
        <div className="card"><h3>Not understood most</h3><div className="sub" style={{ marginBottom: 6 }}>Messages the bot could not answer in this period. Add a keyword or an answer for the frequent ones.</div>
          {r.topMissing.length ? r.topMissing.map((m) => <div className="rprec" key={m.text}><div className="rpq">“{m.text}”</div><span className="sub">{m.hits} time{m.hits === 1 ? '' : 's'}</span></div>) : <div className="sub">Nothing is waiting. Every message was understood or already dealt with.</div>}</div>
      </>}
    </>
  );
}
