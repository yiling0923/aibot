import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { usePanel } from '../store';
import { IconBtn } from '../ui';
import { useNavigate } from 'react-router-dom';
import { SetKeywordModal } from './KeywordModals';

interface Report {
  days: number; total: number; helped: number; notUnderstood: number; handedOver: number; rude: number; byDecision: Record<string, number>; tests: number;
  daily: { day: string; total: number; helped: number; notUnderstood: number; handedOver: number }[];
  topTopics: { topic: string; n: number }[]; handedByTopic: { topic: string; handed: number; total: number }[]; topKeywords: { word: string; n: number }[];
  accuracy: { right: number; wrong: number; checked: number; wrongRate: number | null }; recent: { id: number; question: string; answer: string; topic: string | null; at: string; verdict: 'right' | 'wrong' | null }[];
  topAnswers: { intent: string; n: number }[]; topMissing: { text: string; hits: number }[];
  from: string; to: string; chatsBy: { members: number; visitors: number };
  prev: { total: number; helped: number; notUnderstood: number; handedOver: number };
  topicRates: { topic: string; n: number; rate: number; prevRate: number | null }[];
  languages: { lang: string; n: number; notUnderstood: number }[]; reasons: { reason: string; n: number }[];
}
const LANG_NAME: Record<string, string> = { en: 'English', ms: 'Malay', zh: 'Chinese', vi: 'Vietnamese', th: 'Thai', tl: 'Filipino', other: 'Not known' };

/** Soft colours, the same in the tiles, the chart, the ring and the legend. */
const COL = { ans: '#7fc4a8', not: '#f0c27b', hand: '#e89a9a', oth: '#b9c3cf', topic: '#9b8bd8', kw: '#7fa8e8' };
const PARTS: { k: 'helped' | 'notUnderstood' | 'handedOver' | 'other'; label: string; color: string }[] = [
  { k: 'helped', label: 'Answered by the bot', color: COL.ans }, { k: 'notUnderstood', label: 'Not understood', color: COL.not },
  { k: 'handedOver', label: 'Handed to a person', color: COL.hand }, { k: 'other', label: 'Other (rude, etc.)', color: COL.oth },
];
const pct = (n: number, t: number) => (t ? Math.round((n / t) * 100) : 0);
const day = (iso: string, long = false) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', long ? { weekday: 'short', day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric' });
const parts = (d: { total: number; helped: number; notUnderstood: number; handedOver: number }) => ({ helped: d.helped, notUnderstood: d.notUnderstood, handedOver: d.handedOver, other: Math.max(0, d.total - d.helped - d.notUnderstood - d.handedOver) });

/** A big number with a thin coloured edge, an arrow against the period before, and a small line over the days. */
function Tile({ label, value, note, color, delta, spark }: { label: string; value: string; note: string; color: string; delta?: { text: string; good: boolean | null }; spark?: number[] }) {
  const m = Math.max(1, ...(spark ?? [])); const n = spark?.length ?? 0;
  return (
    <div className="rptile"><i style={{ background: color }} /><small>{label}</small><b>{value}</b>
      <span>{delta ? <b className={'rpd ' + (delta.good === null ? '' : delta.good ? 'up' : 'dn')}>{delta.text}</b> : null} {note}</span>
      {n > 1 ? <svg className="rpspark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><polyline fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" points={spark!.map((v, i) => `${(i * 100) / (n - 1)},${26 - (v / m) * 24}`).join(' ')} /></svg> : null}
    </div>
  );
}
/** "▲ 9%" or "▼ 2 pts" against the period before. `goodUp` says whether more is good news. */
function change(now: number, before: number, goodUp: boolean, pts: boolean): { text: string; good: boolean | null } | undefined {
  const diff = pts ? Math.round(now - before) : before ? Math.round(((now - before) / before) * 100) : 0;
  if (!pts && !before) return undefined;
  if (diff === 0) return { text: '= same', good: null };
  return { text: (diff > 0 ? '▲ ' : '▼ ') + Math.abs(diff) + (pts ? (Math.abs(diff) === 1 ? ' pt' : ' pts') : '%'), good: diff > 0 === goodUp };
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
  const W = 1200, H = 175, L = 40, R = 8, T = 10, B = 30; const pw = W - L - R, ph = H - T - B; const n = daily.length;
  const m = Math.max(1, ...daily.map((d) => d.total)); const step = m <= 5 ? 1 : m <= 10 ? 2 : m <= 25 ? 5 : m <= 50 ? 10 : m <= 100 ? 20 : m <= 250 ? 50 : 100;
  const top = Math.ceil(m / step) * step; const grp = pw / n, bw = Math.min(64, grp * 0.68); const y = (v: number) => T + ph - (v / top) * ph;
  const every = n <= 10 ? 1 : n <= 20 ? 2 : 5;
  const d = hov === null ? null : daily[hov]; const pd = d ? parts(d) : null; const cx = hov === null ? 0 : L + grp * hov + grp / 2;
  return (
    <div className="rpchart" onMouseLeave={() => setHov(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Messages per day" style={{ width: "100%", maxHeight: 200, display: "block" }}>
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

/** One CSV with the numbers of the page, in blocks: summary, per day, topics, languages, reasons, missed messages. Opens in Excel. */
function downloadCsv(merchant: string, r: Report) {
  const cell = (x: unknown) => { const t = String(x ?? ''); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
  const rows: unknown[][] = [];
  const block = (title: string, head: string[], body: unknown[][]) => { rows.push([title]); rows.push(head); body.forEach((b) => rows.push(b)); rows.push([]); };
  block('Report', ['merchant', 'from', 'to', 'days'], [[merchant, r.from, r.to, r.days]]);
  block('Summary', ['what', 'this period', 'period before'], [['messages', r.total, r.prev.total], ['answered by the bot', r.helped, r.prev.helped], ['not understood', r.notUnderstood, r.prev.notUnderstood], ['handed to a person', r.handedOver, r.prev.handedOver], ['wrong-answer rate %', r.accuracy.wrongRate === null ? '' : Math.round(r.accuracy.wrongRate * 100), ''], ['chats from logged-in members', r.chatsBy.members, ''], ['chats from visitors', r.chatsBy.visitors, '']]);
  block('Messages per day', ['day', 'messages', 'answered', 'not understood', 'handed to a person'], r.daily.map((d) => [d.day, d.total, d.helped, d.notUnderstood, d.handedOver]));
  block('Topics', ['topic', 'messages', 'answered by the bot %', 'answered % before'], r.topicRates.map((t) => [t.topic, t.n, Math.round(t.rate * 100), t.prevRate === null ? '' : Math.round(t.prevRate * 100)]));
  block('Languages', ['language', 'messages', 'not understood'], r.languages.map((l) => [LANG_NAME[l.lang] ?? l.lang, l.n, l.notUnderstood]));
  block('Why chats went to a person', ['reason', 'chats'], r.reasons.map((x) => [x.reason, x.n]));
  block('Messages the bot missed', ['message', 'times'], r.topMissing.map((m) => [m.text, m.hits]));
  const text = '\ufeff' + rows.map((x) => x.map(cell).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  a.download = `report_${merchant.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${r.from}_to_${r.to}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** How the bot is doing for this merchant: what it handled, what it did not understand, what went to a person. */
export default function Report() {
  const p = usePanel(); const [days, setDays] = useState<7 | 30 | 'custom'>(7); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [withTest, setWithTest] = useState(true);
  const [r, setR] = useState<Report | null>(null); const [err, setErr] = useState(''); const [kw, setKw] = useState<string | null>(null); const nav = useNavigate();
  const range = days === 'custom' ? `&from=${from}&to=${to}` : `&days=${days}`;
  const load = () => api<Report>(`/api/admin/report?merchant=${encodeURIComponent(p.merchant)}${range}&test=${withTest ? 1 : 0}`);
  useEffect(() => {
    if (days === 'custom' && (!from || !to)) return;                                  // wait until both dates are chosen
    let alive = true; setErr('');
    load().then((x) => { if (alive) setR(x); }).catch((e: Error) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.merchant, days, from, to, withTest]);

  const mark = async (id: number, verdict: 'right' | 'wrong' | null) => {
    try { await api('/api/admin/feedback', { merchant: p.merchant, decisionId: id, verdict }); setR(await load()); } catch (e) { p.toast((e as Error).message); }
  };
  const v = r ? parts(r) : null; const a = r?.accuracy;
  return (
    <>
      <div className="head"><div><h2 style={{ margin: 0 }}>Report · {p.M.name}</h2><div className="sub">What the bot did with customer messages. Hover a bar or a ring to see the numbers.</div></div>
        <div className="tools"><div className="segs" role="group" aria-label="Period">{([7, 30] as const).map((d) => <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>Last {d} days</button>)}<button type="button" aria-pressed={days === 'custom'} onClick={() => { if (days !== 'custom') { const t = new Date(), f = new Date(Date.now() - 29 * 86400000); const iso = (x: Date) => x.toISOString().slice(0, 10); if (!from) setFrom(iso(f)); if (!to) setTo(iso(t)); setDays('custom'); } }}>Custom dates</button></div>
          {days === 'custom' && <span className="rpdates"><label>From <input type="date" aria-label="From date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></label><label>To <input type="date" aria-label="To date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></label></span>}
          <button className="btn sm" type="button" disabled={!r || !r.total} onClick={() => r && downloadCsv(p.M.name, r)}>Download CSV</button>
          <label className="switch"><input type="checkbox" role="switch" checked={withTest} onChange={(e) => setWithTest(e.target.checked)} /><span className="track"><span className="thumb" /></span> Include test chat{r && r.tests ? ` (${r.tests})` : ''}</label></div></div>
      {kw && <SetKeywordModal word={kw.toLowerCase()} onClose={() => setKw(null)} />}
      {err && <div className="note" style={{ background: 'var(--badbg)' }}>{err}</div>}
      {r && v && <>
        <div className="rptiles">
          <Tile label="Messages" value={String(r.total)} note={days === 'custom' ? `from ${r.from} to ${r.to}` : `in the last ${r.days} days`} color="var(--accent)" delta={change(r.total, r.prev.total, true, false)} spark={r.daily.map((x) => x.total)} />
          <Tile label="Answered by bot" value={pct(r.helped, r.total) + '%'} note={`${r.helped} messages`} color={COL.ans} delta={r.prev.total ? change(pct(r.helped, r.total), pct(r.prev.helped, r.prev.total), true, true) : undefined} spark={r.daily.map((x) => x.helped)} />
          <Tile label="Not understood" value={pct(r.notUnderstood, r.total) + '%'} note={`${r.notUnderstood} messages`} color={COL.not} delta={r.prev.total ? change(pct(r.notUnderstood, r.total), pct(r.prev.notUnderstood, r.prev.total), false, true) : undefined} spark={r.daily.map((x) => x.notUnderstood)} />
          <Tile label="Handed to a person" value={pct(r.handedOver, r.total) + '%'} note={`${r.handedOver} messages`} color={COL.hand} delta={r.prev.total ? change(pct(r.handedOver, r.total), pct(r.prev.handedOver, r.prev.total), false, true) : undefined} spark={r.daily.map((x) => x.handedOver)} />
          <Tile label="Wrong-answer rate" value={a?.wrongRate === null || !a ? '—' : Math.round(a.wrongRate * 100) + '%'} note={a && a.checked ? `${a.wrong} of ${a.checked} checked` : 'no answer checked yet'} color={COL.oth} />
        </div>
        <div className="sub">Arrows compare with the {r.days} days before. Green is better, red is worse. Chats in this period: <b>{r.chatsBy.members}</b> from logged-in members, <b>{r.chatsBy.visitors}</b> from visitors.</div>
        {!r.total ? <div className="card"><div className="sub">No messages in this period yet. {withTest ? '' : 'Try "Include test chat" to see the messages typed in the tests.'}</div></div> : <div className="card"><h3 style={{ margin: 0 }}>Messages per day</h3><div className="sub" style={{ marginBottom: 6 }}>Every day of the period is shown, also the days with no messages.</div><DayChart daily={r.daily} /></div>}

        <div className="card"><h3 style={{ margin: 0 }}>Fix these first</h3><div className="sub" style={{ marginBottom: 6 }}>Messages the bot could not answer, most often first. “Add keyword” teaches it a word. “Add answer” opens a new entry with the question filled in.</div>
          {r.topMissing.length ? <>{r.topMissing.map((m) => <div className="rprec" key={m.text}><div className="rpq">“{m.text}”</div><span className="rpact"><span className="sub">{m.hits} time{m.hits === 1 ? '' : 's'}</span>
            <button className="btn sm" type="button" onClick={() => setKw(m.text)}>Add keyword</button><button className="btn sm" type="button" onClick={() => nav('/admin/kb', { state: { newQuestion: m.text } })}>Add answer</button></span></div>)}
            <div className="sub" style={{ marginTop: 6 }}>These {r.topMissing.length} were missed {r.topMissing.reduce((x, m) => x + m.hits, 0)} times in total.</div></>
            : <div className="sub">Nothing is waiting. Every message was understood or already dealt with.</div>}</div>

        <div className="card"><h3 style={{ margin: 0 }}>Top topics, and how well they are answered</h3><div className="sub" style={{ marginBottom: 6 }}>The bar is the share of messages on the topic that the bot answered itself. The number on the right is the change since the {r.days} days before.</div>
          {r.topicRates.length ? <div className="scroll"><table><thead><tr><th>Topic</th><th>Messages</th><th>Answered by the bot</th><th>Change</th></tr></thead><tbody>
            {r.topicRates.map((t) => { const now = Math.round(t.rate * 100), dl = t.prevRate === null ? null : now - Math.round(t.prevRate * 100); const col = now >= 75 ? COL.ans : now >= 50 ? COL.not : COL.hand;
              return <tr key={t.topic}><td>{t.topic}</td><td>{t.n}</td><td><span className="rpmeter" title={`${now}% answered by the bot`}><i style={{ width: now + '%', background: col }} /></span> <b>{now}%</b></td>
                <td className={dl === null || dl === 0 ? 'sub' : dl > 0 ? 'rpd up' : 'rpd dn'}>{dl === null ? 'new' : dl === 0 ? '=' : (dl > 0 ? '▲ ' : '▼ ') + Math.abs(dl)}</td></tr>; })}</tbody></table></div>
            : <div className="sub">No topic was asked about in this period.</div>}</div>

        <div className="rpg2b">
          <div className="card"><h3 style={{ margin: 0 }}>Languages</h3><div className="sub" style={{ marginBottom: 6 }}>What customers write in.</div>
            <BarList color={COL.kw} empty="No messages yet." rows={r.languages.map((l) => ({ label: LANG_NAME[l.lang] ?? l.lang, n: l.n, tip: `${LANG_NAME[l.lang] ?? l.lang}: ${l.n} messages (${pct(l.n, r.total)}%), ${pct(l.notUnderstood, l.n)}% not understood` }))} />
            {(() => { const w = r.languages.filter((l) => l.n >= 10 && l.notUnderstood > 0).sort((x, y) => y.notUnderstood / y.n - x.notUnderstood / x.n)[0]; return w ? <div className="sub" style={{ marginTop: 6 }}>Not understood most in <b>{LANG_NAME[w.lang] ?? w.lang}</b> ({pct(w.notUnderstood, w.n)}% of its messages).</div> : null; })()}</div>
          <div className="card"><h3 style={{ margin: 0 }}>Why chats went to a person</h3><div className="sub" style={{ marginBottom: 6 }}>The reason the bot wrote down.</div>
            <BarList color={COL.hand} empty="No chat went to a person in this period." rows={r.reasons.map((x) => ({ label: x.reason, n: x.n, tip: `${x.reason}: ${x.n}` }))} /></div>
        </div>

        <div className="card"><h3>Check recent answers</h3><div className="sub" style={{ marginBottom: 4 }}>The last answers the bot gave. Mark each one right or wrong; this feeds the wrong-answer rate.</div>
          {r.recent.length ? r.recent.map((x) => <div className="rprec" key={x.id}><div><div className="rpq">“{x.question}”{x.topic ? <span className="rptag">{x.topic}</span> : null}</div><div className="sub rpans">{x.answer}</div></div>
            <span className="rpact"><IconBtn tip="Right" pressed={x.verdict === 'right'} onClick={() => void mark(x.id, x.verdict === 'right' ? null : 'right')}><path d="m5 12 4 4 10-10" /></IconBtn><IconBtn tip="Wrong" danger pressed={x.verdict === 'wrong'} onClick={() => void mark(x.id, x.verdict === 'wrong' ? null : 'wrong')}><path d="M6 6l12 12M18 6 6 18" /></IconBtn></span></div>)
            : <div className="sub">No answers in this period.</div>}</div>
      </>}
    </>
  );
}
