import { useEffect, useRef, useState, type DragEvent, type PointerEvent as RPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePanel } from '../store';
import { addOwnTopic, findDup, groupKeywords, guessLang, slug, topicNames, type Entry } from '../model';
import { useAssign } from './assign';

/**
 * Flowchart canvas of the topics. Each topic is a lane: a Keywords card → the Topic card → Answer cards → "If not clear".
 * Everything is drawn from the same draft as the list view, so the two views always show the same thing.
 * - Drag a card by its title to place it. Dragging a Topic card moves its whole lane. Places are remembered in this browser.
 * - Drag a keyword chip, or the round dot of an Answer card, onto a Topic card to move it there.
 * - Drag Topic or Keyword from the palette onto the grid (or click it) to add one.
 * - Every keyword and answer also has a "⇄" menu to move it, for keyboard and touch.
 */
type Src = { t: 'kw'; i: number } | { t: 'entry'; id: number } | { t: 'word'; w: string };
type Pending = { id: number; kind: 'topic' | 'keyword'; x: number; y: number; text: string };
type Pos = Record<string, { x: number; y: number }>;
type Kind = 'kw' | 'topic' | 'ans' | 'ho';
type Node = { key: string; kind: Kind; topic: string; x: number; y: number; w: number; h: number };
const MIME = 'application/x-aibot-flow';
const COL = { kw: 30, topic: 360, ans: 640, ho: 960 }, W = { kw: 270, topic: 200, ans: 270, ho: 170 }, H = { topic: 100, ans: 116, ho: 88 };
const GAP = 124;                                                             // distance between answer cards
const TYPE_LABEL: Record<string, string> = { needs_staff: 'Needs staff', promotion: 'Promotion' };

/** About how tall a keywords card is: a label per group, and the chips of each group wrap inside the card width. */
const kwHeight = (groups: string[][]) => {
  let h = 40 + 12;
  for (const words of groups) { let rows = 1, used = 0; for (const w of words) { const c = w.length * 7.6 + 34; if (used + c > W.kw - 24) { rows++; used = 0; } used += c; } h += 20 + rows * 34; }
  return Math.max(h, 40 + 34 + 12);
};
type KwItem = { variant: string; language: string; kind?: string | null; own: boolean; i: number };
const SHOW_SHARED = 4;                                                         // shared words shown per group; the rest is "+N shared"
const previewOf = (e: Entry) => { const t = e.translations as Record<string, { answer_text?: string }>; return (t.en?.answer_text || Object.values(t).find((x) => x?.answer_text)?.answer_text || '').replace(/\s+/g, ' ').trim(); };
const today = () => new Date().toISOString().slice(0, 10);

export default function TopicFlow() {
  const p = usePanel(); const d = p.draft; const assign = useAssign(); const nav = useNavigate();
  const canvas = useRef<HTMLDivElement>(null);
  const storeKey = 'flowpos:' + p.merchant;
  const read = (): Pos => { try { return JSON.parse(localStorage.getItem(storeKey) || '{}') as Pos; } catch { return {}; } };
  const [pos, setPos] = useState<Pos>(read);
  useEffect(() => { setPos(read()); }, [storeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const persist = (n: Pos) => { try { localStorage.setItem(storeKey, JSON.stringify(n)); } catch { /* ignore */ } };
  const [pend, setPend] = useState<Pending[]>([]); const nextId = useRef(1);
  const [over, setOver] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [link, setLink] = useState<{ x0: number; y0: number; x: number; y: number } | null>(null);

  const topics = topicNames(d, p.merchant);
  const mine = (d.mAliases[p.merchant] || []).map((a, i) => [a, i] as const);
  const entries = d.kb.filter((e) => e.merchant === p.merchant) as Entry[];
  const unset = p.kw.filter((r) => !r.ignored && p.status(r.w).t === 'Not set yet').slice(0, 24);

  /* ---------- the data changes (the same as the list view makes) ---------- */
  const move = (what: Src, topic: string) => {
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
  const removeKw = (i: number) => p.edit((x, note) => { note('Removed short form "' + x.mAliases[p.merchant].splice(i, 1)[0].variant + '" (' + p.M.name + ')'); });
  const createTopic = (id: number) => {
    const b = pend.find((x) => x.id === id); if (!b) return; const n = slug(b.text);
    if (!n) return p.toast('Type a name first');
    if (topics.includes(n)) return p.toast('The topic "' + n + '" already exists');
    p.edit((x, note) => { addOwnTopic(x, p.merchant, n, []); note('Added topic "' + n + '" (' + p.M.name + ')'); });
    setPend((l) => l.filter((x) => x.id !== id)); p.toast('Topic "' + n + '" created. Drag keywords onto it.');
  };
  const connectPending = (b: Pending, topic: string) => {
    const w = b.text.trim().toLowerCase(); if (!w) return p.toast('Type the keyword first');
    const dup = findDup(d, p.merchant, p.M.name, w); if (dup.length) return p.toast('"' + w + '" is already ' + dup[0] + '. Nothing was added.');
    p.edit((x, note) => { (x.mAliases[p.merchant] = x.mAliases[p.merchant] || []).push({ language: guessLang(w), variant: w, canonical: topic }); note('Added keyword "' + w + '" to topic "' + topic + '" (' + p.M.name + ')'); });
    setPend((l) => l.filter((x) => x.id !== b.id)); p.toast('"' + w + '" now means ' + topic);
  };
  const addBlock = (kind: 'topic' | 'keyword', x?: number, y?: number) => {
    const n = pend.length; setPend((l) => [...l, { id: nextId.current++, kind, x: x ?? 40 + n * 20, y: y ?? 30 + n * 70, text: '' }]);
  };

  /** The main keyword's words in groups (short forms, slang, same meaning, other languages); each group shows all of this merchant's words and a few shared ones. */
  const cardGroups = (t: string) => {
    const own: KwItem[] = mine.filter(([a]) => a.canonical === t).map(([a, i]) => ({ variant: a.variant, language: a.language, kind: a.kind, own: true, i }));
    const sh: KwItem[] = Object.entries(d.aliases[t] || {}).flatMap(([l, ws]) => ws.map((w) => ({ variant: w, language: l, own: false, i: -1 })));
    return groupKeywords(t, [...own, ...sh]).map((g) => { const mineW = g.items.filter((x) => x.own), shW = g.items.filter((x) => !x.own); return { ...g, items: [...mineW, ...shW.slice(0, SHOW_SHARED)], more: Math.max(0, shW.length - SHOW_SHARED), all: shW.map((x) => x.variant) }; });
  };
  /* ---------- layout: every card has a default place in its lane; a dragged card keeps the place you gave it ---------- */
  const nodes: Node[] = []; const edges: { a: string; b: string; kind: 'kw' | 'ans' | 'ho' }[] = []; const groups = new Map<string, string[]>();
  const lanes: { topic: string; x: number; y: number; w: number; h: number }[] = [];
  let cursor = 24;
  const add = (topic: string, key: string, kind: Kind, x: number, y: number, w: number, h: number) => { const o = pos[key]; nodes.push({ key, kind, topic, x: o?.x ?? x, y: o?.y ?? y, w, h }); groups.set(topic, [...(groups.get(topic) ?? []), key]); };
  topics.forEach((t) => {
    const shared = Object.values(d.aliases[t] || {}).flat(); const own = mine.filter(([a]) => a.canonical === t); const ans = entries.filter((e) => e.topic === t);
    const kwH = kwHeight(cardGroups(t).map((g) => [...g.items.map((x) => x.variant + (x.own ? '    ' : '')), g.more ? '+99 shared' : ''].filter(Boolean)));
    const laneH = Math.max(ans.length * GAP, kwH, H.topic) + 60; const cy = cursor + laneH / 2;
    add(t, 'kw:' + t, 'kw', COL.kw, cy - kwH / 2, W.kw, kwH); edges.push({ a: 'kw:' + t, b: 'topic:' + t, kind: 'kw' });
    add(t, 'topic:' + t, 'topic', COL.topic, cy - H.topic / 2, W.topic, H.topic);
    ans.forEach((e, k) => { add(t, 'ans:' + e.id, 'ans', COL.ans, cy - H.ans / 2 + (k - (ans.length - 1) / 2) * GAP, W.ans, H.ans); edges.push({ a: 'topic:' + t, b: 'ans:' + e.id, kind: 'ans' }); edges.push({ a: 'ans:' + e.id, b: 'ho:' + t, kind: 'ho' }); });
    add(t, 'ho:' + t, 'ho', COL.ho, cy - H.ho / 2, W.ho, H.ho); if (!ans.length) edges.push({ a: 'topic:' + t, b: 'ho:' + t, kind: 'ho' });
    cursor += laneH + 34;
  });
  const by = new Map(nodes.map((n) => [n.key, n] as const));
  topics.forEach((t) => {                                                       // a lane is the box around its cards, so it follows them when they move
    const ns = nodes.filter((n) => n.topic === t); if (!ns.length) return;
    const x1 = Math.min(...ns.map((n) => n.x)) - 22, y1 = Math.min(...ns.map((n) => n.y)) - 34, x2 = Math.max(...ns.map((n) => n.x + n.w)) + 22, y2 = Math.max(...ns.map((n) => n.y + n.h)) + 22;
    lanes.push({ topic: t, x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
  });
  const width = Math.max(1200, ...nodes.map((n) => n.x + n.w + 60), ...pend.map((b) => b.x + 260)), height = Math.max(520, cursor + 20, ...nodes.map((n) => n.y + n.h + 60), ...pend.map((b) => b.y + 130));
  const curve = (x1: number, y1: number, x2: number, y2: number) => { const dx = Math.max(40, Math.abs(x2 - x1) / 2); return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`; };

  /* ---------- pointer work: moving cards, and drawing a line from a chip or a dot ---------- */
  const toCanvas = (cx: number, cy: number) => { const r = canvas.current?.getBoundingClientRect(); return { x: (cx - (r?.left ?? 0) + (canvas.current?.scrollLeft ?? 0)) / scale, y: (cy - (r?.top ?? 0) + (canvas.current?.scrollTop ?? 0)) / scale }; };
  const dragNode = (key: string, e: RPointerEvent, set?: (x: number, y: number) => void) => {
    if ((e.target as HTMLElement).closest('button,input,select,textarea,.port,.kc')) return;
    const n = by.get(key); const lane = n?.kind === 'topic' && !set ? (groups.get(n.topic) ?? []).map((k) => [k, by.get(k)!] as const) : null;
    const start = { cx: e.clientX, cy: e.clientY, x: n?.x ?? 0, y: n?.y ?? 0 }; let last: Pos = {};
    const mv = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.cx) / scale, dy = (ev.clientY - start.cy) / scale;
      if (set) return set(Math.max(0, start.x + dx), Math.max(0, start.y + dy));
      last = {}; for (const [k, m] of lane ?? [[key, n!] as const]) last[k] = { x: Math.max(0, m.x + dx), y: Math.max(0, m.y + dy) };
      setPos((o) => ({ ...o, ...last }));
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (!set) setPos((o) => { persist(o); return o; }); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  const startLink = (from: { x: number; y: number }, e: RPointerEvent, drop: (topic: string) => void) => {
    e.preventDefault(); e.stopPropagation(); const c0 = toCanvas(e.clientX, e.clientY); setLink({ x0: from.x, y0: from.y, x: c0.x, y: c0.y });
    const mv = (ev: PointerEvent) => { const c = toCanvas(ev.clientX, ev.clientY); setLink({ x0: from.x, y0: from.y, x: c.x, y: c.y }); };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); setLink(null);
      const t = (document.elementFromPoint?.(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-topic]')?.dataset.topic; if (t) drop(t);
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  const html5Drop = (topic: string) => (e: DragEvent) => { e.preventDefault(); setOver(null); try { move(JSON.parse(e.dataTransfer.getData(MIME)) as Src, topic); } catch { /* not ours */ } };
  const onCanvasDrop = (e: DragEvent) => {
    e.preventDefault(); let k = ''; try { k = e.dataTransfer.getData('application/x-aibot-block'); } catch { /* none */ }
    if (k === 'topic' || k === 'keyword') { const c = toCanvas(e.clientX, e.clientY); addBlock(k, Math.max(0, c.x - 100), Math.max(0, c.y - 30)); }
  };
  const moveMenu = (label: string, from: string, src: Src) => <select className="mv" aria-label={label} value="" onChange={(e) => e.target.value && move(src, e.target.value)}>
    <option value="">⇄</option>{topics.filter((t) => t !== from).map((t) => <option key={t} value={t}>{t}</option>)}</select>;
  useEffect(() => { const t = setTimeout(() => fit(), 0); return () => clearTimeout(t); }, [p.merchant]); // eslint-disable-line react-hooks/exhaustive-deps
  const fit = () => { const w = canvas.current?.clientWidth ?? 0; if (w) setScale(Math.max(0.5, Math.min(1, (w - 8) / width))); };
  const box = (n: { x: number; y: number; w: number; h: number }) => ({ left: n.x, top: n.y, width: n.w, minHeight: n.h });

  return <div className="flow" data-testid="flow">
    <div className="flowbar">
      <span className="sub">Drag a keyword chip or the dot on an answer onto a topic to move it. Drag cards by their title to arrange. Same data as the list view.</span>
      <span className="flowtools"><button type="button" className="btn sm" onClick={() => { setPos({}); persist({}); }}>Auto-arrange</button><button type="button" className="btn sm" onClick={fit}>Fit to screen</button>
        <button type="button" className="btn sm" aria-label="Zoom out" onClick={() => setScale((s) => Math.max(0.5, +(s - 0.1).toFixed(2)))}>−</button><span className="zoomv">{Math.round(scale * 100)}%</span>
        <button type="button" className="btn sm" aria-label="Zoom in" onClick={() => setScale((s) => Math.min(1.5, +(s + 0.1).toFixed(2)))}>＋</button></span>
    </div>
    <div className="flowwrap">
      <aside className="flowpal" aria-label="Blocks">
        <h4>Add a block</h4>
        <button type="button" className="ftile t-tp" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-aibot-block', 'topic')} onClick={() => addBlock('topic')}><i>◆</i><span><b>Topic</b><small>what the customer wants</small></span></button>
        <button type="button" className="ftile t-kw" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-aibot-block', 'keyword')} onClick={() => addBlock('keyword')}><i>#</i><span><b>Keyword</b><small>a word that means a topic</small></span></button>
        <button type="button" className="ftile t-an" onClick={() => nav('/admin/kb')}><i>▤</i><span><b>Answer</b><small>written in Knowledge base</small></span></button>
        <div className="ftile t-ho static"><i>⚑</i><span><b>If not clear</b><small>comes with every topic</small></span></div>
        {unset.length > 0 && <><h4 style={{ marginTop: 14 }}>Words not set yet</h4><div className="sub" style={{ marginBottom: 6 }}>Drag onto a topic</div>
          <div className="chips">{unset.map((r) => <span key={r.w} className="chip ro" draggable onDragStart={(e) => { e.dataTransfer.setData(MIME, JSON.stringify({ t: 'word', w: r.w } as Src)); }}>{r.w}<span className="n">{r.n}</span></span>)}</div></>}
      </aside>
      <div className="flowcanvas" ref={canvas} onDragOver={(e) => e.preventDefault()} onDrop={onCanvasDrop}>
        <div style={{ width: width * scale, height: height * scale }}>
          <div className="flowinner" style={{ position: 'relative', width, height, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
            {lanes.map((l) => <div key={'lane' + l.topic} className="lane" style={{ left: l.x, top: l.y, width: l.w, height: l.h }}><span className="lt">{l.topic}</span></div>)}
            <svg className="flowedges" width={width} height={height} aria-hidden="true">
              <defs>{(['kw', 'ans', 'ho'] as const).map((k) => <marker key={k} id={'arr-' + k} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0L10,5L0,10z" className={'ar-' + k} /></marker>)}
                <marker id="arr-live" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0L10,5L0,10z" className="ar-live" /></marker></defs>
              {edges.map((e) => { const a = by.get(e.a), b = by.get(e.b); if (!a || !b) return null; return <path key={e.a + '>' + e.b} d={curve(a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2)} className={'edge e-' + e.kind} markerEnd={`url(#arr-${e.kind})`} />; })}
              {link && <path d={curve(link.x0, link.y0, link.x, link.y)} className="edge e-live" markerEnd="url(#arr-live)" />}
            </svg>
            {nodes.map((n) => {
              const t = n.topic;
              if (n.kind === 'topic') return <div key={n.key} className={'fc tp' + (over === t ? ' over' : '')} style={box(n)} data-topic={t} aria-label={'Topic ' + t} onPointerDown={(e) => dragNode(n.key, e)} onDragOver={(e) => { e.preventDefault(); setOver(t); }} onDragLeave={() => setOver(null)} onDrop={html5Drop(t)}>
                <div className="hd">◆ Topic</div><div className="bd"><div className="big">{t}</div><div className="pv">{entries.filter((x) => x.topic === t).length} answers · {d.aliases[t] ? 'shared topic' : p.M.name + ' only'}</div></div><span className="port l" /><span className="port r" /></div>;
              if (n.kind === 'kw') { const groups = cardGroups(t);
                return <div key={n.key} className="fc kw" style={box(n)} onPointerDown={(e) => dragNode(n.key, e)}><div className="hd"># Keywords</div><div className="bd">
                  {groups.map((g) => <div key={g.kind} className="kgrp"><span className="klabel">{g.label}</span><div>
                    {g.items.map((x) => x.own
                      ? <span key={'o' + x.i} className="kc" onPointerDown={(e) => startLink({ x: n.x + n.w, y: n.y + n.h / 2 }, e, (to) => move({ t: 'kw', i: x.i }, to))} title="Drag onto a topic to move it">{x.variant}{moveMenu('Move ' + x.variant + ' to topic', t, { t: 'kw', i: x.i })}<button type="button" className="x" aria-label={'Remove ' + x.variant} onClick={() => removeKw(x.i)}>×</button></span>
                      : <span key={'s' + x.variant} className="kc sh" title="Shared by all merchants (an admin edits it in the list view)">{x.variant}</span>)}
                    {g.more > 0 && <span className="kc sh" title={g.all.join(', ')}>+{g.more} shared</span>}</div></div>)}
                  {!groups.length && <span className="sub">No keywords yet</span>}</div><span className="port r" /></div>; }
              if (n.kind === 'ans') { const e = entries.find((x) => x.id === Number(n.key.slice(4))); if (!e) return null; const ty = e.entry_type ?? 'answer'; const ended = !!e.ends_on && e.ends_on < today();
                return <div key={n.key} className="fc an" style={box(n)} onPointerDown={(ev) => dragNode(n.key, ev)}><div className="hd">▤ Answer{ty !== 'answer' && <span className={'badge ' + (ty === 'promotion' ? 'b-pr' : 'b-st')}>{TYPE_LABEL[ty]}</span>}{moveMenu('Move ' + e.intent_key + ' to topic', t, { t: 'entry', id: e.id })}</div>
                  <div className="bd"><div className="nm">{e.intent_key}</div><div className="pv clamp">{previewOf(e) || 'No text yet'}</div>{e.ends_on && <div><span className={'badge b-end' + (ended ? ' ended' : '')}>{ended ? 'ended ' : 'ends '}{e.ends_on}</span></div>}</div>
                  <span className="port l" /><span className="port r" title="Drag onto a topic to move this answer" onPointerDown={(ev) => startLink({ x: n.x + n.w, y: n.y + n.h / 2 }, ev, (to) => move({ t: 'entry', id: e.id }, to))} /></div>; }
              const has = entries.some((x) => x.topic === t);
              return <div key={n.key} className={'fc ho' + (has ? '' : ' warn')} style={box(n)} onPointerDown={(e) => dragNode(n.key, e)}><div className="hd">⚑ If not clear</div><div className="bd"><b>{has ? 'Ask once,' : 'A person'}</b><div className="pv">{has ? 'then a person' : 'no answer yet'}</div></div><span className="port l" /></div>;
            })}
            {pend.map((b) => <div key={b.id} className={'fc pend ' + (b.kind === 'topic' ? 'tp' : 'kw')} style={{ left: b.x, top: b.y, width: 240 }} onPointerDown={(e) => dragNode('p' + b.id, e, (x, y) => setPend((l) => l.map((z) => (z.id === b.id ? { ...z, x, y } : z))))}>
              <div className="hd">{b.kind === 'topic' ? '◆ New topic' : '# New keyword'}<button type="button" className="x" aria-label="Cancel" onClick={() => setPend((l) => l.filter((z) => z.id !== b.id))}>×</button></div>
              <div className="bd"><input type="text" aria-label={b.kind === 'topic' ? 'New topic name' : 'New keyword'} placeholder={b.kind === 'topic' ? 'e.g. refund' : 'e.g. depoo'} value={b.text} onChange={(e) => setPend((l) => l.map((z) => (z.id === b.id ? { ...z, text: e.target.value } : z)))} onKeyDown={(e) => { if (e.key === 'Enter' && b.kind === 'topic') { e.preventDefault(); createTopic(b.id); } }} />
                {b.kind === 'topic' ? <button type="button" className="btn sm pri" onClick={() => createTopic(b.id)}>Create topic</button>
                  : <select className="mv wide" aria-label="Connect keyword to topic" value="" onChange={(e) => e.target.value && connectPending(b, e.target.value)}><option value="">Connect to topic…</option>{topics.map((t) => <option key={t} value={t}>{t}</option>)}</select>}</div>
              {b.kind === 'keyword' && <span className="port r" title="Drag onto a topic" onPointerDown={(e) => startLink({ x: b.x + 240, y: b.y + 48 }, e, (t) => connectPending(b, t))} />}
            </div>)}
          </div>
        </div>
      </div>
    </div>
    <div className="leg"><span><s className="s-kw" />Keyword</span><span><s className="s-tp" />Topic</span><span><s className="s-an" />Answer</span><span><s className="s-ho" />If not clear</span></div>
  </div>;
}
