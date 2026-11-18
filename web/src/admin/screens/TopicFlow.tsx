import { useEffect, useRef, useState, type DragEvent, type PointerEvent as RPointerEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePanel } from '../store';
import { addOwnTopic, findDup, guessLang, slug, topicNames, type Entry } from '../model';
import { useAssign } from './assign';

/**
 * Flowchart canvas of the topics. Each topic is a lane: a Keywords card → the Topic card → Answer cards → "If not clear".
 * Everything is drawn from the same draft as the list view, so the two views always show the same thing.
 * - Drag a card by its title to place it. Dragging a Topic card moves its whole lane. Places are remembered in this browser.
 * - Drag a keyword chip, or the round dot of an Answer card, onto a Topic card to move it there.
 * - Drag Topic or Keyword from the palette onto the grid (or click it) to add one.
 * - Every keyword and answer also has a "⇄" menu to move it, for keyboard and touch.
 */
type Src = { t: 'kw'; i: number } | { t: 'sh'; topic: string; l: string; w: string } | { t: 'entry'; id: number } | { t: 'word'; w: string };
type Pending = { id: number; kind: 'topic' | 'keyword' | 'answer'; x: number; y: number; text: string; body?: string; topic?: string; qs?: string };
type Pos = Record<string, { x: number; y: number }>;
type Kind = 'kw' | 'topic' | 'ans' | 'ho';
type Node = { key: string; kind: Kind; topic: string; x: number; y: number; w: number; h: number };
const MIME = 'application/x-aibot-flow';
const COL = { kw: 30, topic: 430, ans: 760, ho: 1180 }, W = { kw: 340, topic: 230, ans: 350, ho: 190 }, H = { topic: 100, ans: 116, ho: 88 };
const KWSCROLL = 200;                                                         // the most height the keywords inside a card take before they scroll
const GAP = 124;                                                             // distance between answer cards
const TYPE_LABEL: Record<string, string> = { needs_staff: 'Needs staff', promotion: 'Promotion' };

/** About how tall a keywords card is: its chips wrap inside the card width. */
const kwHeight = (words: string[]) => {
  let rows = 1, used = 0; for (const w of words) { const c = w.length * 6.9 + 30; if (used + c > W.kw - 24) { rows++; used = 0; } used += c; }
  return 40 + rows * 34 + 12;
};
const previewOf = (e: Entry) => { const t = e.translations as Record<string, { answer_text?: string }>; return (t.en?.answer_text || Object.values(t).find((x) => x?.answer_text)?.answer_text || '').replace(/\s+/g, ' ').trim(); };
const today = () => new Date().toISOString().slice(0, 10);

export default function TopicFlow() {
  const p = usePanel(); const d = p.draft; const assign = useAssign(); const nav = useNavigate();
  const canvas = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos>({});                                   // only while a card is being dragged: on drop every card goes back to its place in the automatic layout
  const [pend, setPend] = useState<Pending[]>([]); const nextId = useRef(1);
  const [over, setOver] = useState<string | null>(null);
  const [hoTopics, setHoTopicsState] = useState<Set<string>>(() => { try { return new Set<string>(JSON.parse(localStorage.getItem('flowho2') || '[]')); } catch { return new Set<string>(); } });   // topics that show their "If not clear" card (it is the same for every topic, so they start hidden)
  const setHoTopics = (n: Set<string>) => { setHoTopicsState(n); try { localStorage.setItem('flowho2', JSON.stringify([...n])); } catch { /* ignore */ } };
  const showHoFor = (t: string) => hoTopics.has(t);
  const [pal, setPalState] = useState(() => { try { return localStorage.getItem('flowpal') !== '0'; } catch { return true; } });   // the Add-a-block panel on the left can be folded away
  const setPal = (v: boolean) => { setPalState(v); try { localStorage.setItem('flowpal', v ? '1' : '0'); } catch { /* ignore */ } setTimeout(() => fit(), 50); };
  const [kwq, setKwq] = useState<Record<string, string>>({});                // the filter typed on each keywords card
  const [fq, setFq] = useState('');                                        // the search over the whole chart: topics that do not match fade out
  const [scale, setScale] = useState(1);
  const [link, setLink] = useState<{ x0: number; y0: number; x: number; y: number } | null>(null);

  const topics = topicNames(d, p.merchant);
  const mine = (d.mAliases[p.merchant] || []).map((a, i) => [a, i] as const);
  const entries = d.kb.filter((e) => e.merchant === p.merchant) as Entry[];
  const unset = p.kw.filter((r) => !r.ignored && p.status(r.w).t === 'Not set yet').slice(0, 24);
  /* what is live (published) and what is only in the draft, so the two can look different */
  const lv = p.live; const liveOwn = lv.mAliases[p.merchant] || [];
  const topicLive = (t: string) => !!lv.aliases[t] || liveOwn.some((a) => a.canonical === t) || lv.kb.some((e) => e.merchant === p.merchant && e.topic === t && e.status !== 'draft');
  const entryLive = (e: Entry) => e.status !== 'draft' && lv.kb.some((x) => x.merchant === p.merchant && x.intent_key === e.intent_key && x.status !== 'draft');
  const ownLive = (a: { variant: string; canonical: string; language?: string | null }) => liveOwn.some((x) => x.variant === a.variant && x.canonical === a.canonical && (x.language ?? null) === (a.language ?? null));
  const sharedLive = (t: string, l: string, w: string) => (lv.aliases[t]?.[l] ?? []).includes(w);
  const tag = (isLive: boolean, text = 'DRAFT') => (isLive ? <span className="tag lvt">LIVE</span> : <span className="tag drt" title="Only in your draft. Customers do not get this until you press Publish.">{text}</span>);

  const fl = fq.trim().toLowerCase();
  const matches = new Set<string>();
  if (fl) topics.forEach((t) => {
    const words = [...Object.values(d.aliases[t] || {}).flat(), ...mine.filter(([a]) => a.canonical === t).map(([a]) => a.variant)];
    const hasAns = entries.some((e) => e.topic === t && ([e.intent_key, previewOf(e), ...Object.values(e.translations as Record<string, { question_examples?: string[] }>).flatMap((x) => x?.question_examples ?? [])].some((x) => x.toLowerCase().includes(fl))));
    if (t.toLowerCase().includes(fl) || words.some((w) => w.toLowerCase().includes(fl)) || hasAns) matches.add(t);
  });
  const faded = (t: string) => !!fl && !matches.has(t);

  /* ---------- the data changes (the same as the list view makes) ---------- */
  const move = (what: Src, topic: string) => {
    if (what.t === 'kw') {
      const a = (d.mAliases[p.merchant] || [])[what.i]; if (!a || a.canonical === topic) return;
      p.edit((x, note) => { const m = x.mAliases[p.merchant][what.i]; note('Moved keyword "' + m.variant + '" from ' + m.canonical + ' to ' + topic); m.canonical = topic; });
    } else if (what.t === 'sh') {
      if (what.topic === topic) return;
      if (!d.aliases[topic]) return p.toast('"' + topic + '" is a topic of this merchant only, so a shared word cannot go there.');
      p.edit((x, note) => { const a = x.aliases[what.topic]?.[what.l]; const i = a ? a.indexOf(what.w) : -1; if (i < 0) return; a.splice(i, 1); (x.aliases[topic][what.l] = x.aliases[topic][what.l] || []).push(what.w); note('Moved shared word "' + what.w + '" from ' + what.topic + ' to ' + topic + ' (all merchants)'); });
    } else if (what.t === 'entry') {
      const e = d.kb.find((k) => k.id === what.id && k.merchant === p.merchant); if (!e || e.topic === topic) return;
      p.edit((x, note) => { const k = x.kb.find((z) => z.id === what.id && z.merchant === p.merchant) as Entry; note('Moved answer "' + k.intent_key + '" from ' + k.topic + ' to ' + topic); k.topic = topic; k.dirty = true; });
    } else {
      const r = assign([what.w], 'topic', topic); p.toast(r.done.length ? '"' + what.w + '" now means ' + topic : r.err || '"' + what.w + '" is already set.');
    }
  };
  const removeKw = (i: number) => p.edit((x, note) => { note('Removed short form "' + x.mAliases[p.merchant].splice(i, 1)[0].variant + '" (' + p.M.name + ')'); });
  const removeShared = (t: string, l: string, w: string) => p.edit((x, note) => { const a = x.aliases[t]?.[l]; const i = a ? a.indexOf(w) : -1; if (i >= 0) { a.splice(i, 1); note('Removed shared short form "' + w + '" from ' + t + ' (all merchants)'); } });
  /** Adds a keyword for this merchant to a topic, straight from the card. Returns true when it was added. */
  const addKeyword = (t: string, text: string) => {
    const w = text.trim().toLowerCase(); if (!w) return false;
    const dup = findDup(d, p.merchant, p.M.name, w); if (dup.length) { p.toast('"' + w + '" is already ' + dup[0] + '. Nothing was added.'); return false; }
    p.edit((x, note) => { (x.mAliases[p.merchant] = x.mAliases[p.merchant] || []).push({ language: guessLang(w), variant: w, canonical: t }); note('Added keyword "' + w + '" to topic "' + t + '" (' + p.M.name + ')'); });
    p.toast('"' + w + '" now means ' + t); return true;
  };
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
  const trash = <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /><path d="M10 11v6M14 11v6" /></svg>;
  const deleteAnswer = (id: number) => {
    const e = entries.find((x) => x.id === id); if (!e || !confirm('Delete the answer "' + e.intent_key + '"? It is removed from the draft until you publish.')) return;
    p.edit((x, note) => { x.kb = x.kb.filter((k) => !(k.id === id && k.merchant === p.merchant)); note('Deleted answer "' + e.intent_key + '" (' + p.M.name + ')'); });
    p.toast('Answer deleted. Press Publish to make it final.');
  };
  const deleteTopic = (t: string) => {
    const n = entries.filter((x) => x.topic === t).length;
    if (n) return p.toast('"' + t + '" still has ' + n + ' answer' + (n === 1 ? '' : 's') + '. Delete or move them first.');
    if (!confirm('Delete the topic "' + t + '" and its keywords? It is removed from the draft until you publish.')) return;
    p.edit((x, note) => { x.mAliases[p.merchant] = (x.mAliases[p.merchant] || []).filter((a) => a.canonical !== t); note('Deleted topic "' + t + '" (' + p.M.name + ')'); });
    p.toast('Topic deleted. Press Publish to make it final.');
  };
  const createAnswer = (b: Pending) => {
    const name = slug(b.text); const topic = b.topic || '';
    if (!name) return p.toast('Give the answer a name first');
    const qs = (b.qs || '').split('\n').map((x) => x.trim()).filter(Boolean);
    if (!qs.length) return p.toast('Type at least one question a customer would ask. The bot finds the answer by these questions.');
    if (!(b.body || '').trim()) return p.toast('Type the English answer first');
    if (!topic) return p.toast('Choose a topic for this answer');
    if (entries.some((e) => e.intent_key === name)) return p.toast('There is already an answer called "' + name + '"');
    p.edit((x, note) => { x.kb.push({ id: Math.max(0, ...x.kb.map((e) => e.id)) + 1, merchant: p.merchant, intent_key: name, topic, aspect: null, topic_optional: false, status: 'live', category: 'General', translations: { en: { question_examples: qs, answer_text: (b.body || '').trim() } }, dirty: true } as Entry); note('Added answer "' + name + '" to topic "' + topic + '" (' + p.M.name + ')'); });
    setPend((l) => l.filter((z) => z.id !== b.id)); p.toast('Answer "' + name + '" added to the draft. Press Publish to make it live for customers.');
  };
  const addBlock = (kind: 'topic' | 'keyword' | 'answer', x?: number, y?: number, topic?: string) => {
    const n = pend.length; setPend((l) => [...l, { id: nextId.current++, kind, x: x ?? 40 + n * 20, y: y ?? 30 + n * 70, text: '', body: '', topic }]);
  };

  /* ---------- layout: every card has a default place in its lane; a dragged card keeps the place you gave it ---------- */
  const nodes: Node[] = []; const edges: { a: string; b: string; kind: 'kw' | 'ans' | 'ho' }[] = []; const groups = new Map<string, string[]>();
  const lanes: { topic: string; x: number; y: number; w: number; h: number }[] = [];
  let cursor = 24;
  const add = (topic: string, key: string, kind: Kind, x: number, y: number, w: number, h: number) => { const o = pos[key]; nodes.push({ key, kind, topic, x: o?.x ?? x, y: o?.y ?? y, w, h }); groups.set(topic, [...(groups.get(topic) ?? []), key]); };
  topics.forEach((t) => {
    const shared = Object.values(d.aliases[t] || {}).flat(); const own = mine.filter(([a]) => a.canonical === t); const ans = entries.filter((e) => e.topic === t);
    const all = [...own.map(([a]) => a.variant + '    '), ...shared.map((w) => w + (p.isAdmin ? '    ' : ''))];
    const kwH = 40 + 12 + 40 + (all.length > 10 ? 40 : 0) + Math.min(kwHeight(all) - 52, KWSCROLL);   // the chips scroll inside the card when there are many
    const laneH = Math.max(ans.length * GAP, kwH, H.topic) + 60; const cy = cursor + laneH / 2;
    add(t, 'kw:' + t, 'kw', COL.kw, cy - kwH / 2, W.kw, kwH); edges.push({ a: 'kw:' + t, b: 'topic:' + t, kind: 'kw' });
    add(t, 'topic:' + t, 'topic', COL.topic, cy - H.topic / 2, W.topic, H.topic);
    ans.forEach((e, k) => { add(t, 'ans:' + e.id, 'ans', COL.ans, cy - H.ans / 2 + (k - (ans.length - 1) / 2) * GAP, W.ans, H.ans); edges.push({ a: 'topic:' + t, b: 'ans:' + e.id, kind: 'ans' }); if (showHoFor(t)) edges.push({ a: 'ans:' + e.id, b: 'ho:' + t, kind: 'ho' }); });
    if (showHoFor(t)) add(t, 'ho:' + t, 'ho', COL.ho, cy - H.ho / 2, W.ho, H.ho); if (showHoFor(t) && !ans.length) edges.push({ a: 'topic:' + t, b: 'ho:' + t, kind: 'ho' });
    cursor += laneH + 34;
  });
  const by = new Map(nodes.map((n) => [n.key, n] as const));
  topics.forEach((t) => {                                                       // a lane is the box around its cards, so it follows them when they move
    const ns = nodes.filter((n) => n.topic === t); if (!ns.length) return;
    const x1 = Math.min(...ns.map((n) => n.x)) - 22, y1 = Math.min(...ns.map((n) => n.y)) - 34, x2 = Math.max(...ns.map((n) => n.x + n.w)) + 22, y2 = Math.max(...ns.map((n) => n.y + n.h)) + 22;
    lanes.push({ topic: t, x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
  });
  const width = Math.max(900, ...nodes.map((n) => n.x + n.w + 60), ...pend.map((b) => b.x + 260)), height = Math.max(520, cursor + 20, ...nodes.map((n) => n.y + n.h + 60), ...pend.map((b) => b.y + 130));
  const curve = (x1: number, y1: number, x2: number, y2: number) => { const dx = Math.max(40, Math.abs(x2 - x1) / 2); return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`; };

  /* ---------- pointer work: moving cards, and drawing a line from a chip or a dot ---------- */
  const toCanvas = (cx: number, cy: number) => { const r = canvas.current?.getBoundingClientRect(); return { x: (cx - (r?.left ?? 0) + (canvas.current?.scrollLeft ?? 0)) / scale, y: (cy - (r?.top ?? 0) + (canvas.current?.scrollTop ?? 0)) / scale }; };
  const dragNode = (key: string, e: RPointerEvent, set?: (x: number, y: number) => void) => {
    if ((e.target as HTMLElement).closest('button,input,select,textarea,.port,.kc')) return;
    if (!set && !key.startsWith('ans:')) return;
    const n = by.get(key); const lane = n?.kind === 'topic' && !set ? (groups.get(n.topic) ?? []).map((k) => [k, by.get(k)!] as const) : null;
    const start = { cx: e.clientX, cy: e.clientY, x: n?.x ?? 0, y: n?.y ?? 0 }; let last: Pos = {};
    const mv = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.cx) / scale, dy = (ev.clientY - start.cy) / scale;
      if (set) return set(Math.max(0, start.x + dx), Math.max(0, start.y + dy));
      last = {}; for (const [k, m] of lane ?? [[key, n!] as const]) last[k] = { x: Math.max(0, m.x + dx), y: Math.max(0, m.y + dy) };
      setPos((o) => ({ ...o, ...last }));
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      if (set) return;
      setPos({});                                                  // the chart lines up again by itself
      if (n?.kind === 'ans') {                                     // an answer dropped inside another topic's box moves to that topic
        const to = laneAt(ev.clientX, ev.clientY);
        if (to && to !== n.topic && Math.hypot(ev.clientX - start.cx, ev.clientY - start.cy) > 6) move({ t: 'entry', id: Number(key.slice(4)) }, to);
      }
    };
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
  const html5Drop = (topic: string) => (e: DragEvent) => { let src: Src | null = null; try { src = JSON.parse(e.dataTransfer.getData(MIME)) as Src; } catch { /* a block from the palette: the canvas handles it */ } if (!src) return; e.preventDefault(); e.stopPropagation(); setOver(null); move(src, topic); };
  /** The topic lane under the pointer: dropping a word anywhere in a lane (on its keywords, answers or the empty space) puts it in that topic. */
  const laneAt = (cx: number, cy: number) => { const c = toCanvas(cx, cy); return lanes.find((l) => c.x >= l.x && c.x <= l.x + l.w && c.y >= l.y && c.y <= l.y + l.h)?.topic ?? null; };
  const onCanvasOver = (e: DragEvent) => { e.preventDefault(); const t = laneAt(e.clientX, e.clientY); if (t !== over) setOver(t); };
  const onCanvasDrop = (e: DragEvent) => {
    e.preventDefault(); let k = ''; try { k = e.dataTransfer.getData('application/x-aibot-block'); } catch { /* none */ }
    const t = laneAt(e.clientX, e.clientY); setOver(null);
    if (t) { try { const src = JSON.parse(e.dataTransfer.getData(MIME)) as Src; move(src, t); return; } catch { /* not a word or keyword */ } }
    if (k === 'ifnotclear') { if (t) setHoTopics(new Set([...hoTopics, t])); else p.toast('Drop it inside a topic'); return; }
    if (k === 'answer') { const c = toCanvas(e.clientX, e.clientY); addBlock('answer', Math.max(0, c.x - 120), Math.max(0, c.y - 30), t ?? undefined); return; }
    if (k === 'topic' || k === 'keyword') { const c = toCanvas(e.clientX, e.clientY); addBlock(k, Math.max(0, c.x - 100), Math.max(0, c.y - 30)); }
  };
  const moveMenu = (label: string, from: string, src: Src) => <select className="mv" aria-label={label} value="" onChange={(e) => e.target.value && move(src, e.target.value)}>
    <option value="">⇄</option>{topics.filter((t) => t !== from).map((t) => <option key={t} value={t}>{t}</option>)}</select>;
  useEffect(() => { const t = setTimeout(() => fit(), 0); return () => clearTimeout(t); }, [p.merchant]); // eslint-disable-line react-hooks/exhaustive-deps
  const fit = () => { const w = canvas.current?.clientWidth ?? 0; if (w) setScale(Math.max(0.5, Math.min(1, (w - 8) / width))); };
  const box = (n: { x: number; y: number; w: number; h: number; topic?: string }) => ({ left: n.x, top: n.y, width: n.w, minHeight: n.h, ...(n.topic && faded(n.topic) ? { opacity: 0.22 } : {}) });
  useEffect(() => {                                                                  // jump to the first topic that matches
    if (!fl) return; const l = lanes.find((x) => matches.has(x.topic)); if (l) canvas.current?.scrollTo?.({ top: Math.max(0, l.y * scale - 16), behavior: 'smooth' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fl]);

  return <div className="flow" data-testid="flow">
    <div className="flowbar">
      <div className="flowtools" role="toolbar" aria-label="Flowchart tools">
        <input type="search" className="flowfind" placeholder="Find a topic, keyword or answer" aria-label="Find in the flowchart" value={fq} onChange={(e) => setFq(e.target.value)} />
        {fl && <span className="sub" role="status">{matches.size} of {topics.length} topic{topics.length === 1 ? '' : 's'}</span>}
        <button type="button" className="tbtn" onClick={fit} title="Fit the whole chart in the window"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>Fit to screen</button>
        <span className="tdiv" aria-hidden="true" />
        <span className="zoom"><button type="button" aria-label="Zoom out" onClick={() => setScale((s) => Math.max(0.5, +(s - 0.1).toFixed(2)))}>−</button><span className="zoomv">{Math.round(scale * 100)}%</span><button type="button" aria-label="Zoom in" onClick={() => setScale((s) => Math.min(1.5, +(s + 0.1).toFixed(2)))}>＋</button></span>
      </div>
    </div>
    <div className={'flowwrap' + (pal ? '' : ' nopal')}>
      <aside className={'flowpal' + (pal ? '' : ' folded')} aria-label="Blocks">
        <button type="button" className="palh" aria-label="Add a block" aria-expanded={pal} onClick={() => setPal(!pal)} title={pal ? 'Hide the blocks' : 'Show the blocks'}><span>Add a block</span><span className="chev" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6" /></svg></span></button>
        {!pal && <div className="palrail" role="group" aria-label="Blocks (folded)"><span className="sep" aria-hidden="true" />
          <button type="button" className="ib t-tp" aria-label="Topic" title="Topic: what the customer wants" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-aibot-block', 'topic')} onClick={() => addBlock('topic')}>◆</button>
          <button type="button" className="ib t-kw" aria-label="Keyword" title="Keyword: a word that means a topic" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-aibot-block', 'keyword')} onClick={() => addBlock('keyword')}>#</button>
          <button type="button" className="ib t-an" aria-label="Answer" title="Answer: drag into a topic to write one" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-aibot-block', 'answer')} onClick={() => addBlock('answer')}>▤</button>
          <button type="button" className="ib t-ho" aria-label="If not clear" title="If not clear: drag into a topic, or click to show it on every topic" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-aibot-block', 'ifnotclear')} onClick={() => setHoTopics(topics.every(showHoFor) ? new Set() : new Set(topics))}>⚑</button></div>}
        {pal && <>
        <button type="button" className="ftile t-tp" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-aibot-block', 'topic')} onClick={() => addBlock('topic')}><i>◆</i><span><b>Topic</b><small>what the customer wants</small></span></button>
        <button type="button" className="ftile t-kw" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-aibot-block', 'keyword')} onClick={() => addBlock('keyword')}><i>#</i><span><b>Keyword</b><small>a word that means a topic</small></span></button>
        <button type="button" className="ftile t-an" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-aibot-block', 'answer')} onClick={() => addBlock('answer')}><i>▤</i><span><b>Answer</b><small>drag into a topic to write one</small></span></button>
        <button type="button" className="ftile t-ho" draggable onDragStart={(e) => e.dataTransfer.setData('application/x-aibot-block', 'ifnotclear')} onClick={() => setHoTopics(topics.every(showHoFor) ? new Set() : new Set(topics))} title="Drag into a topic to show what happens there when the bot is not sure. Click to show or hide it on every topic."><i>⚑</i><span><b>If not clear</b><small>drag into a topic to show it</small></span></button>
        <div className="sub palhint">Drag a keyword or an answer onto a topic to move it. Cards line up by themselves.</div>
        <button type="button" className="btn sm ghost" style={{ marginTop: 8 }} onClick={() => nav('/admin/kb')}>Open Knowledge base →</button>
        {unset.length > 0 && <><h4 style={{ marginTop: 14 }}>Words not set yet</h4><div className="sub" style={{ marginBottom: 6 }}>Drag onto a topic</div>
          <div className="chips">{unset.map((r) => <span key={r.w} className="chip ro" draggable onDragStart={(e) => { e.dataTransfer.setData(MIME, JSON.stringify({ t: 'word', w: r.w } as Src)); }}>{r.w}<span className="n">{r.n}</span></span>)}</div></>}
        </>}
      </aside>
      <div className="flowcanvas" ref={canvas} onDragOver={onCanvasOver} onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(null); }} onDrop={onCanvasDrop}>
        <div style={{ width: width * scale, height: height * scale }}>
          <div className="flowinner" style={{ position: 'relative', width, height, transform: `scale(${scale})`, transformOrigin: '0 0' }}>
            {lanes.map((l) => <div key={'lane' + l.topic} className={'lane' + (over === l.topic ? ' over' : '') + (topicLive(l.topic) ? '' : ' nl')} style={{ left: l.x, top: l.y, width: l.w, height: l.h, ...(faded(l.topic) ? { opacity: 0.35 } : {}) }}><span className="lt">{l.topic}{topicLive(l.topic) ? '' : ' · not live'}</span></div>)}
            <svg className="flowedges" width={width} height={height} aria-hidden="true">
              <defs>{(['kw', 'ans', 'ho'] as const).map((k) => <marker key={k} id={'arr-' + k} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0L10,5L0,10z" className={'ar-' + k} /></marker>)}
                <marker id="arr-live" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M0,0L10,5L0,10z" className="ar-live" /></marker></defs>
              {edges.map((e) => { const a = by.get(e.a), b = by.get(e.b); if (!a || !b) return null; return <path key={e.a + '>' + e.b} d={curve(a.x + a.w, a.y + a.h / 2, b.x, b.y + b.h / 2)} className={'edge e-' + e.kind} markerEnd={`url(#arr-${e.kind})`} />; })}
              {link && <path d={curve(link.x0, link.y0, link.x, link.y)} className="edge e-live" markerEnd="url(#arr-live)" />}
            </svg>
            {nodes.map((n) => {
              const t = n.topic;
              if (n.kind === 'topic') return <div key={n.key} className={'fc tp' + (over === t ? ' over' : '') + (topicLive(t) ? '' : ' draft')} style={box(n)} data-topic={t} aria-label={'Topic ' + t} onDragOver={(e) => { e.preventDefault(); setOver(t); }} onDragLeave={() => setOver(null)} onDrop={html5Drop(t)}>
                <div className="hd">◆ Topic{tag(topicLive(t))}{!d.aliases[t] && <button type="button" className="x del" aria-label={'Delete topic ' + t} title="Delete this topic (only topics made for this merchant)" onPointerDown={(ev) => ev.stopPropagation()} onClick={() => deleteTopic(t)}>{trash}</button>}</div><div className="bd"><div className="big">{t}</div><div className="pv">{entries.filter((x) => x.topic === t).length} answers · {d.aliases[t] ? 'shared topic' : p.M.name + ' only'}</div></div><span className="port l" /><span className="port r" /></div>;
              if (n.kind === 'kw') { const sharedL = Object.entries(d.aliases[t] || {}).flatMap(([l, ws]) => ws.map((w): [string, string] => [w, l])); const own = mine.filter(([a]) => a.canonical === t);
                const q = (kwq[t] || '').trim().toLowerCase(); const hit = (w: string) => !q || w.toLowerCase().includes(q); const total = own.length + sharedL.length;
                return <div key={n.key} className={'fc kw' + (topicLive(t) ? '' : ' draft')} style={box(n)}><div className="hd"># Keywords <span className="cnt">{total}</span>{tag(topicLive(t))}</div><div className="bd kwbd">
                  <input className="kadd" placeholder="＋ Add a keyword, press Enter" aria-label={'Add a keyword to ' + t} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key !== 'Enter') return; const el = e.target as HTMLInputElement; if (addKeyword(t, el.value)) el.value = ''; }} />
                  {total > 10 && <input className="kadd find" type="search" placeholder="Find a keyword" aria-label={'Find a keyword in ' + t} value={kwq[t] || ''} onPointerDown={(e) => e.stopPropagation()} onChange={(e) => setKwq({ ...kwq, [t]: e.target.value })} />}
                  <div className="kwscroll" style={{ maxHeight: KWSCROLL }}>
                  {own.filter(([a]) => hit(a.variant)).map(([a, i]) => <span key={i} className={'kc' + (ownLive(a) ? '' : ' nl')} onPointerDown={(e) => { e.stopPropagation(); startLink({ x: n.x + n.w, y: n.y + n.h / 2 }, e, (to) => move({ t: 'kw', i }, to)); }} title="Drag onto a topic to move it">{a.variant}{moveMenu('Move ' + a.variant + ' to topic', t, { t: 'kw', i })}<button type="button" className="x" aria-label={'Remove ' + a.variant} onClick={() => removeKw(i)}>×</button></span>)}
                  {sharedL.filter(([w]) => hit(w)).map(([w, l]) => <span key={l + w} className={'kc sh' + (p.isAdmin ? ' adm' : '') + (sharedLive(t, l, w) ? '' : ' nl')} title={p.isAdmin ? 'Shared by all merchants. Drag onto another topic to move it.' : 'Shared by all merchants (an admin edits it)'} onPointerDown={(e) => { e.stopPropagation(); if (p.isAdmin) startLink({ x: n.x + n.w, y: n.y + n.h / 2 }, e, (to) => move({ t: 'sh', topic: t, l, w }, to)); }}>{w}{p.isAdmin && <button type="button" className="x" aria-label={'Remove shared ' + w} onClick={() => removeShared(t, l, w)}>×</button>}</span>)}
                  {q && ![...own.map(([a]) => a.variant), ...sharedL.map(([w]) => w)].some(hit) && <span className="sub">No keyword matches.</span>}</div></div><span className="port r" /></div>; }
              if (n.kind === 'ans') { const e = entries.find((x) => x.id === Number(n.key.slice(4))); if (!e) return null; const ty = e.entry_type ?? 'answer'; const ended = !!e.ends_on && e.ends_on < today();
                return <div key={n.key} className={'fc an' + (entryLive(e) ? '' : ' draft')} style={box(n)} onPointerDown={(ev) => dragNode(n.key, ev)}><div className="hd">▤ Answer{ty !== 'answer' && <span className={'badge ' + (ty === 'promotion' ? 'b-pr' : 'b-st')}>{TYPE_LABEL[ty]}</span>}{tag(entryLive(e), 'DRAFT · NOT LIVE')}{moveMenu('Move ' + e.intent_key + ' to topic', t, { t: 'entry', id: e.id })}<button type="button" className="x del" aria-label={'Delete answer ' + e.intent_key} title="Delete this answer" onPointerDown={(ev) => ev.stopPropagation()} onClick={() => deleteAnswer(e.id)}>{trash}</button></div>
                  <div className="bd"><div className="nm">{e.intent_key}</div><div className="pv clamp">{previewOf(e) || 'No text yet'}</div>{e.status === 'draft' && <div><span className="badge b-end ended" title="A draft answer is ignored by the bot. Set it to Live in Knowledge base.">draft: bot ignores it</span></div>}{!Object.values(e.translations as Record<string, { question_examples?: string[] }>).some((x) => x?.question_examples?.length) && <div><span className="badge b-end ended" title="The bot finds an answer by the questions listed for it. Add some in Knowledge base.">no questions yet</span></div>}{e.ends_on && <div><span className={'badge b-end' + (ended ? ' ended' : '')}>{ended ? 'ended ' : 'ends '}{e.ends_on}</span></div>}</div>
                  <span className="port l" /><span className="port r" title="Drag onto a topic to move this answer" onPointerDown={(ev) => startLink({ x: n.x + n.w, y: n.y + n.h / 2 }, ev, (to) => move({ t: 'entry', id: e.id }, to))} /></div>; }
              const has = entries.some((x) => x.topic === t);
              return <div key={n.key} className={'fc ho' + (has ? '' : ' warn')} style={box(n)}><div className="hd">⚑ If not clear</div><div className="bd"><b>{has ? 'Ask once,' : 'A person'}</b><div className="pv">{has ? 'then a person' : 'no answer yet'}</div></div><span className="port l" /></div>;
            })}
            {pend.map((b) => <div key={b.id} className={'fc pend ' + (b.kind === 'topic' ? 'tp' : b.kind === 'answer' ? 'an' : 'kw')} style={{ left: b.x, top: b.y, width: 240 }} onPointerDown={(e) => dragNode('p' + b.id, e, (x, y) => setPend((l) => l.map((z) => (z.id === b.id ? { ...z, x, y } : z))))}>
              <div className="hd">{b.kind === 'topic' ? '◆ New topic' : b.kind === 'answer' ? '▤ New answer' : '# New keyword'}<button type="button" className="x" aria-label="Cancel" onClick={() => setPend((l) => l.filter((z) => z.id !== b.id))}>×</button></div>
              <div className="bd"><input type="text" aria-label={b.kind === 'topic' ? 'New topic name' : b.kind === 'answer' ? 'New answer name' : 'New keyword'} placeholder={b.kind === 'topic' ? 'e.g. refund' : b.kind === 'answer' ? 'name, e.g. daily_limit' : 'e.g. depoo'} value={b.text} onChange={(e) => setPend((l) => l.map((z) => (z.id === b.id ? { ...z, text: e.target.value } : z)))} onKeyDown={(e) => { if (e.key === 'Enter' && b.kind === 'topic') { e.preventDefault(); createTopic(b.id); } }} />
                 {b.kind === 'answer' && <><textarea aria-label="Questions customers ask" rows={3} placeholder={'Questions customers ask, one per line\ne.g. what is the daily limit'} value={b.qs || ''} onPointerDown={(e) => e.stopPropagation()} onChange={(e) => setPend((l) => l.map((z) => (z.id === b.id ? { ...z, qs: e.target.value } : z)))} />
                  <textarea aria-label="New answer text" rows={3} placeholder="The answer the bot says (English)" value={b.body || ''} onPointerDown={(e) => e.stopPropagation()} onChange={(e) => setPend((l) => l.map((z) => (z.id === b.id ? { ...z, body: e.target.value } : z)))} />
                  <select className="mv wide" aria-label="Topic for the answer" value={b.topic || ''} onChange={(e) => setPend((l) => l.map((z) => (z.id === b.id ? { ...z, topic: e.target.value } : z)))}><option value="">Choose a topic…</option>{topics.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                  <button type="button" className="btn sm pri" onClick={() => createAnswer(b)}>Add answer</button></>}
                {b.kind === 'topic' ? <button type="button" className="btn sm pri" onClick={() => createTopic(b.id)}>Create topic</button>
                  : b.kind === 'answer' ? null
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
