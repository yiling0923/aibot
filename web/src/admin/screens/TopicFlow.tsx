import { useEffect, useRef, useState, type DragEvent, type PointerEvent as RPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePanel } from '../store';
import { addOwnTopic, findDup, guessLang, slug, topicNames, type Entry } from '../model';
import { useAssign } from './assign';

/**
 * Flowchart canvas of the topics: Keyword blocks → Topic block → Answer blocks → "if not clear" block.
 * The blocks are drawn from the same draft as the list view, so the two views always show the same thing.
 * - Drag a block by its title to place it where you like (the places are remembered in this browser).
 * - Drag from the round dot on the right of a Keyword or Answer block onto a Topic block to move it there.
 * - Drag a block from the left palette onto the canvas (or click it) to add a Topic or a Keyword.
 * - Every Keyword and Answer block also has a "Move to…" menu, for keyboard and touch.
 */
type Src = { t: 'kw'; i: number } | { t: 'entry'; id: number } | { t: 'word'; w: string };
type Pending = { id: number; kind: 'topic' | 'keyword'; x: number; y: number; text: string };
type Pos = Record<string, { x: number; y: number }>;
const MIME = 'application/x-aibot-flow';
const W = { kw: 190, topic: 140, ans: 200, ho: 140 }, X = { kw: 14, topic: 250, ans: 440, ho: 690 };
const H = { kw: 44, topic: 64, ans: 44, ho: 64 };

export default function TopicFlow() {
  const p = usePanel(); const d = p.draft; const assign = useAssign(); const nav = useNavigate();
  const canvas = useRef<HTMLDivElement>(null);
  const storeKey = 'flowpos:' + p.merchant;
  const [pos, setPos] = useState<Pos>(() => { try { return JSON.parse(localStorage.getItem(storeKey) || '{}') as Pos; } catch { return {}; } });
  useEffect(() => { try { setPos(JSON.parse(localStorage.getItem(storeKey) || '{}') as Pos); } catch { setPos({}); } }, [storeKey]);
  const savePos = (n: Pos) => { setPos(n); try { localStorage.setItem(storeKey, JSON.stringify(n)); } catch { /* ignore */ } };
  const [pend, setPend] = useState<Pending[]>([]); const nextId = useRef(1);
  const [over, setOver] = useState<string | null>(null);
  const [link, setLink] = useState<{ from: Src; x0: number; y0: number; x: number; y: number } | null>(null);

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
    const n = pend.length; setPend((l) => [...l, { id: nextId.current++, kind, x: x ?? 24 + n * 18, y: y ?? 24 + n * 56, text: '' }]);
  };

  /* ---------- layout: every block has a default place; a dragged block keeps the place you gave it ---------- */
  type Node = { key: string; kind: 'kw' | 'shared' | 'topic' | 'ans' | 'ho'; x: number; y: number; w: number; h: number };
  const nodes: Node[] = []; const edges: { a: string; b: string; dash?: boolean }[] = []; let y = 24;
  const place = (key: string, kind: Node['kind'], x: number, yy: number, w: number, h: number): Node => { const o = pos[key]; const n = { key, kind, x: o?.x ?? x, y: o?.y ?? yy, w, h }; nodes.push(n); return n; };
  topics.forEach((t) => {
    const shared = Object.values(d.aliases[t] || {}).flat(); const own = mine.filter(([a]) => a.canonical === t); const ans = entries.filter((e) => e.topic === t);
    const rows = Math.max(own.length + (shared.length ? 1 : 0), ans.length, 1); const rowH = rows * 54 + 18;
    let ky = y; if (shared.length) { place('sh:' + t, 'shared', X.kw, ky, W.kw, H.kw); edges.push({ a: 'sh:' + t, b: 'topic:' + t }); ky += 54; }
    own.forEach(([a]) => { place('kw:' + t + ':' + a.variant, 'kw', X.kw, ky, W.kw, H.kw); edges.push({ a: 'kw:' + t + ':' + a.variant, b: 'topic:' + t }); ky += 54; });
    place('topic:' + t, 'topic', X.topic, y + Math.max(0, (rowH - 18 - H.topic) / 2), W.topic, H.topic);
    ans.forEach((e, k) => { place('ans:' + e.id, 'ans', X.ans, y + k * 54, W.ans, H.ans); edges.push({ a: 'topic:' + t, b: 'ans:' + e.id }); edges.push({ a: 'ans:' + e.id, b: 'ho:' + t, dash: true }); });
    place('ho:' + t, 'ho', X.ho, y + Math.max(0, (rowH - 18 - H.ho) / 2), W.ho, H.ho); if (!ans.length) edges.push({ a: 'topic:' + t, b: 'ho:' + t, dash: true });
    y += rowH + 16;
  });
  const by = new Map(nodes.map((n) => [n.key, n] as const));
  const width = Math.max(840, ...nodes.map((n) => n.x + n.w + 40), ...pend.map((b) => b.x + 240)), height = Math.max(420, y + 40, ...nodes.map((n) => n.y + n.h + 40), ...pend.map((b) => b.y + 110));
  const curve = (x1: number, y1: number, x2: number, y2: number) => { const dx = Math.max(40, Math.abs(x2 - x1) / 2); return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`; };

  /* ---------- pointer work: moving a block, and drawing a line from a dot ---------- */
  const toCanvas = (cx: number, cy: number) => { const r = canvas.current?.getBoundingClientRect(); return { x: cx - (r?.left ?? 0) + (canvas.current?.scrollLeft ?? 0), y: cy - (r?.top ?? 0) + (canvas.current?.scrollTop ?? 0) }; };
  const dragNode = (key: string, e: RPointerEvent, set?: (x: number, y: number) => void) => {
    if ((e.target as HTMLElement).closest('button,input,select,textarea,.port')) return;
    const n = by.get(key); const start = { cx: e.clientX, cy: e.clientY, x: n?.x ?? 0, y: n?.y ?? 0 }; let last = { x: start.x, y: start.y };
    const mv = (ev: PointerEvent) => { last = { x: Math.max(0, start.x + ev.clientX - start.cx), y: Math.max(0, start.y + ev.clientY - start.cy) }; if (set) set(last.x, last.y); else setPos((o) => ({ ...o, [key]: last })); };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); if (!set) setPos((o) => { const nx = { ...o, [key]: last }; try { localStorage.setItem(storeKey, JSON.stringify(nx)); } catch { /* ignore */ } return nx; }); };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  const startLink = (from: Src, n: { x: number; y: number; w: number; h: number }, e: RPointerEvent, onDrop?: (topic: string) => void) => {
    e.preventDefault(); e.stopPropagation(); const s = { x0: n.x + n.w, y0: n.y + n.h / 2 };
    const c0 = toCanvas(e.clientX, e.clientY); setLink({ from, ...s, x: c0.x, y: c0.y });
    const mv = (ev: PointerEvent) => { const c = toCanvas(ev.clientX, ev.clientY); setLink({ from, ...s, x: c.x, y: c.y }); };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); setLink(null);
      const el = (document.elementFromPoint?.(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-topic]'); const t = el?.dataset.topic;
      if (t) (onDrop ? onDrop(t) : move(from, t));
    };
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
  };
  const html5Drop = (topic: string) => (e: DragEvent) => { e.preventDefault(); setOver(null); try { move(JSON.parse(e.dataTransfer.getData(MIME)) as Src, topic); } catch { /* not ours */ } };
  const onCanvasDrop = (e: DragEvent) => {
    e.preventDefault(); let k = ''; try { k = e.dataTransfer.getData('application/x-aibot-block'); } catch { /* none */ }
    if (k === 'topic' || k === 'keyword') { const c = toCanvas(e.clientX, e.clientY); addBlock(k, Math.max(0, c.x - 90), Math.max(0, c.y - 20)); }
  };
  const moveMenu = (from: string, src: Src) => <select className="mv" aria-label="Move to topic" value="" onChange={(e) => e.target.value && move(src, e.target.value)}>
    <option value="">Move to…</option>{topics.filter((t) => t !== from).map((t) => <option key={t} value={t}>{t}</option>)}</select>;

  const box = (n: { x: number; y: number; w: number; h: number }) => ({ left: n.x, top: n.y, width: n.w, minHeight: n.h });
  return <div className="flow" data-testid="flow">
    <div className="note">Drag a block by its title to place it. Drag from the round dot of a Keyword or Answer block onto a Topic block to move it there. Drag Topic or Keyword from the left onto the grid to add one. This is the same data as the list view.</div>
    <div className="flowwrap">
      <aside className="flowpal" aria-label="Blocks">
        <div className="sub">Blocks</div>
        <button type="button" className="pal topicb" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-aibot-block', 'topic')} onClick={() => addBlock('topic')}><b>◆ Topic</b><span>a new topic</span></button>
        <button type="button" className="pal kwb" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-aibot-block', 'keyword')} onClick={() => addBlock('keyword')}><b>＃ Keyword</b><span>a word for a topic</span></button>
        <button type="button" className="pal ansb" onClick={() => nav('/admin/kb')}><b>▤ Answer</b><span>add in Knowledge base</span></button>
        <div className="pal hob"><b>■ If not clear</b><span>comes with each topic: ask once, then a person</span></div>
        {unset.length > 0 && <><div className="sub" style={{ marginTop: 8 }}>Words not set yet (drop on a topic)</div>
          <div className="chips">{unset.map((r) => <span key={r.w} className="chip ro" draggable onDragStart={(e) => { e.dataTransfer.setData(MIME, JSON.stringify({ t: 'word', w: r.w } as Src)); }}>{r.w}<span className="n">{r.n}</span></span>)}</div></>}
      </aside>
      <div className="flowcanvas" ref={canvas} onDragOver={(e) => e.preventDefault()} onDrop={onCanvasDrop}>
        <div style={{ position: 'relative', width, height }}>
          <svg className="flowedges" width={width} height={height} aria-hidden="true">
            <defs><marker id="arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="currentColor" /></marker></defs>
            {edges.map((e) => { const a = by.get(e.a), b = by.get(e.b); if (!a || !b) return null; return <path key={e.a + '>' + e.b} d={curve(a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2)} className={'edge' + (e.dash ? ' dash' : '')} markerEnd="url(#arr)" />; })}
            {link && <path d={curve(link.x0, link.y0, link.x, link.y)} className="edge live" markerEnd="url(#arr)" />}
          </svg>
          {nodes.map((n) => {
            const t = n.key.split(':')[1];
            if (n.kind === 'topic') { const k = n.key.slice(6); return <div key={n.key} className={'fnode topn' + (over === k ? ' over' : '')} style={box(n)} data-topic={k} aria-label={'Topic ' + k} onPointerDown={(e) => dragNode(n.key, e)} onDragOver={(e) => { e.preventDefault(); setOver(k); }} onDragLeave={() => setOver(null)} onDrop={html5Drop(k)}>
              <div className="fh">◆ Topic</div><b>{k}</b><div className="sub">{d.aliases[k] ? 'shared' : p.M.name + ' only'}</div></div>; }
            if (n.kind === 'shared') { const words = Object.values(d.aliases[t] || {}).flat(); return <div key={n.key} className="fnode kwn ro" style={box(n)} onPointerDown={(e) => dragNode(n.key, e)} title={words.join(', ') + ' (shared by all merchants; an admin edits them in the list view)'}>
              <div className="fh">＃ Shared keywords</div><span className="sub">{words.slice(0, 3).join(', ')}{words.length > 3 ? ' +' + (words.length - 3) : ''}</span></div>; }
            if (n.kind === 'kw') { const word = n.key.split(':').slice(2).join(':'); const hit = mine.find(([a]) => a.canonical === t && a.variant === word); if (!hit) return null; const i = hit[1];
              return <div key={n.key} className="fnode kwn" style={box(n)} onPointerDown={(e) => dragNode(n.key, e)}><div className="fh">＃ Keyword <button type="button" className="x" aria-label={'Remove ' + word} onClick={() => removeKw(i)}>×</button></div>
                <b>{word}</b> {moveMenu(t, { t: 'kw', i })}<span className="port" role="presentation" title="Drag onto a topic" onPointerDown={(e) => startLink({ t: 'kw', i }, n, e)} /></div>; }
            if (n.kind === 'ans') { const id = Number(n.key.slice(4)); const e = entries.find((x) => x.id === id); if (!e) return null; const k = e.topic;
              return <div key={n.key} className="fnode ansn" style={box(n)} onPointerDown={(ev) => dragNode(n.key, ev)}><div className="fh">▤ Answer</div><b>{e.intent_key}</b> {moveMenu(k, { t: 'entry', id })}<span className="port" role="presentation" title="Drag onto a topic" onPointerDown={(ev) => startLink({ t: 'entry', id }, n, ev)} /></div>; }
            const k = n.key.slice(3); const has = entries.some((x) => x.topic === k);
            return <div key={n.key} className={'fnode hon' + (has ? '' : ' warn')} style={box(n)} onPointerDown={(e) => dragNode(n.key, e)}><div className="fh">■ If not clear</div>{has ? 'Asks once, then a person' : 'A person (no answer yet)'}</div>;
          })}
          {pend.map((b) => <div key={b.id} className={'fnode pend ' + (b.kind === 'topic' ? 'topn' : 'kwn')} style={{ left: b.x, top: b.y, width: 220, minHeight: 64 }} onPointerDown={(e) => dragNode('p' + b.id, e, (x, y) => setPend((l) => l.map((z) => (z.id === b.id ? { ...z, x, y } : z))))}>
            <div className="fh">{b.kind === 'topic' ? '◆ New topic' : '＃ New keyword'} <button type="button" className="x" aria-label="Cancel" onClick={() => setPend((l) => l.filter((z) => z.id !== b.id))}>×</button></div>
            <input type="text" aria-label={b.kind === 'topic' ? 'New topic name' : 'New keyword'} placeholder={b.kind === 'topic' ? 'e.g. refund' : 'e.g. depoo'} value={b.text} onChange={(e) => setPend((l) => l.map((z) => (z.id === b.id ? { ...z, text: e.target.value } : z)))} onKeyDown={(e) => { if (e.key === 'Enter' && b.kind === 'topic') { e.preventDefault(); createTopic(b.id); } }} />
            {b.kind === 'topic' ? <button type="button" className="btn sm pri" onClick={() => createTopic(b.id)}>Create topic</button>
              : <><select className="mv" aria-label="Connect keyword to topic" value="" onChange={(e) => e.target.value && connectPending(b, e.target.value)}><option value="">Connect to…</option>{topics.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                <span className="port" role="presentation" title="Drag onto a topic" onPointerDown={(e) => startLink({ t: 'word', w: b.text }, { x: b.x, y: b.y, w: 220, h: 64 }, e, (t) => connectPending(b, t))} /></>}
          </div>)}
        </div>
      </div>
    </div>
  </div>;
}

