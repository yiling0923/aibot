import { useState, type DragEvent } from 'react';
import { usePanel } from '../store';
import { LANGS, addOwnTopic, slug, topicNames, type Entry } from '../model';
import { useAssign } from './assign';

/**
 * Flowchart view of the topics: keywords → topic → answers → hand to a human.
 * It edits the same draft as the list view, so the two views always show the same thing.
 * Drag a keyword, an answer or a word customers typed onto a topic to move it there.
 * Every drag also has a "Move to…" menu, for keyboard and touch.
 */
type Drag = { t: 'kw'; i: number } | { t: 'entry'; id: number } | { t: 'word'; w: string };
const MIME = 'application/x-aibot-flow';

export default function TopicFlow() {
  const p = usePanel(); const d = p.draft; const assign = useAssign();
  const [over, setOver] = useState<string | null>(null);
  const [name, setName] = useState('');
  const topics = topicNames(d, p.merchant);
  const mine = (d.mAliases[p.merchant] || []).map((a, i) => [a, i] as const);
  const entries = d.kb.filter((e) => e.merchant === p.merchant) as Entry[];
  const unset = p.kw.filter((r) => !r.ignored && p.status(r.w).t === 'Not set yet').slice(0, 24);

  const move = (what: Drag, topic: string) => {
    if (what.t === 'kw') {
      const a = (d.mAliases[p.merchant] || [])[what.i]; if (!a || a.canonical === topic) return;
      p.edit((x, note) => { const m = x.mAliases[p.merchant][what.i]; note('Moved keyword "' + m.variant + '" from ' + m.canonical + ' to ' + topic); m.canonical = topic; });
    } else if (what.t === 'entry') {
      const e = d.kb.find((k) => k.id === what.id && k.merchant === p.merchant); if (!e || e.topic === topic) return;
      p.edit((x, note) => { const k = x.kb.find((z) => z.id === what.id && z.merchant === p.merchant) as Entry; note('Moved answer "' + k.intent_key + '" from ' + k.topic + ' to ' + topic); k.topic = topic; k.dirty = true; });
    } else {
      const r = assign([what.w], 'topic', topic); p.toast(r.done.length ? '"' + what.w + '" now means ' + topic : r.err || '"' + what.w + '" is already set.');
    }
  };
  const drop = (topic: string) => (e: DragEvent) => {
    e.preventDefault(); setOver(null);
    try { move(JSON.parse(e.dataTransfer.getData(MIME)) as Drag, topic); } catch { /* not ours */ }
  };
  const drag = (what: Drag) => (e: DragEvent) => { e.dataTransfer.setData(MIME, JSON.stringify(what)); e.dataTransfer.effectAllowed = 'move'; };
  const moveMenu = (what: Drag, from: string) => <select className="mv" aria-label="Move to topic" value="" onChange={(e) => e.target.value && move(what, e.target.value)}>
    <option value="">Move to…</option>{topics.filter((t) => t !== from).map((t) => <option key={t} value={t}>{t}</option>)}</select>;
  const removeKw = (i: number) => p.edit((x, note) => { note('Removed short form "' + x.mAliases[p.merchant].splice(i, 1)[0].variant + '" (' + p.M.name + ')'); });
  const addTopic = () => {
    const n = slug(name); if (!n) return p.toast('Type a name first');
    if (topics.includes(n)) return p.toast('The topic "' + n + '" already exists');
    p.edit((x, note) => { addOwnTopic(x, p.merchant, n, []); note('Added topic "' + n + '" (' + p.M.name + ')'); }); setName(''); p.toast('Topic "' + n + '" created. Drag keywords and answers onto it.');
  };

  return <div className="flow" data-testid="flow">
    <div className="note">Drag a keyword or an answer onto another topic to move it. Words customers typed that are not set yet wait on the left: drop one on a topic. This is the same data as the list view.</div>
    {unset.length > 0 && <div className="flowtray"><b>Not set yet</b><div className="chips">{unset.map((r) => <span key={r.w} className="chip ro" draggable onDragStart={drag({ t: 'word', w: r.w })}>{r.w}<span className="n">{r.n}</span></span>)}</div></div>}
    {topics.map((t) => {
      const shared = d.aliases[t] || {}; const own = mine.filter(([a]) => a.canonical === t); const ans = entries.filter((e) => e.topic === t);
      return <div key={t} className="flowrow" data-topic={t}>
        <div className="fnode kwn"><div className="fh">Keywords</div><div className="chips">
          {LANGS.flatMap((l) => (shared[l] || []).map((w) => <span key={l + w} className="chip ro" title="Shared by all merchants (admin edits it in the list view)">{w}</span>))}
          {own.map(([a, i]) => <span key={i} className="chip" draggable onDragStart={drag({ t: 'kw', i })}>{a.variant}{moveMenu({ t: 'kw', i }, t)}<button type="button" aria-label={'Remove ' + a.variant} onClick={() => removeKw(i)}>×</button></span>)}
          {!own.length && !Object.values(shared).flat().length && <span className="sub">No keywords yet</span>}</div></div>
        <span className="arrow">→</span>
        <div className={'fnode topn' + (over === t ? ' over' : '')} onDragOver={(e) => { e.preventDefault(); setOver(t); }} onDragLeave={() => setOver(null)} onDrop={drop(t)} aria-label={'Topic ' + t}>
          <div className="fh">Topic</div><b>{t}</b><div className="sub">{d.aliases[t] ? 'shared' : p.M.name + ' only'}</div></div>
        <span className="arrow">→</span>
        <div className={'fnode ansn' + (over === t ? ' over' : '')} onDragOver={(e) => { e.preventDefault(); setOver(t); }} onDragLeave={() => setOver(null)} onDrop={drop(t)}>
          <div className="fh">Answers</div><div className="chips">{ans.map((e) => <span key={e.id} className="chip" draggable onDragStart={drag({ t: 'entry', id: e.id })}>{e.intent_key}{moveMenu({ t: 'entry', id: e.id }, t)}</span>)}
            {!ans.length && <span className="sub">No answer yet</span>}</div></div>
        <span className="arrow">→</span>
        <div className={'fnode hon' + (ans.length ? '' : ' warn')}><div className="fh">If not clear</div>{ans.length ? 'Asks once, then hands to a person' : 'Hands to a person (no answer yet)'}</div>
      </div>;
    })}
    <div className="addrow"><label className="fld"><span>New topic ({p.M.name} only)</span><input type="text" value={name} placeholder="e.g. refund" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTopic(); } }} /></label>
      <button className="btn pri" type="button" onClick={addTopic}>Create topic</button></div>
  </div>;
}
