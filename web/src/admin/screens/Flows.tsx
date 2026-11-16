import { useMemo, useState } from 'react';
import { LANGS, LN, FLOW_STOP, FLOW_TYPES, blankBlock, flowProblems, newBlockId, newFlowId, topicNames, type Flow, type FlowBlock } from '../model';
import { usePanel } from '../store';
import { Pill } from '../ui';
import { FlowTry } from './FlowTry';

const TYPE_NAME = Object.fromEntries(FLOW_TYPES.map(([k, l]) => [k, l])) as Record<string, string>;

export default function Flows() {
  const p = usePanel();
  const flows = useMemo(() => (p.draft.flows ?? []).filter((f) => f.merchant === p.merchant), [p.draft, p.merchant]);
  const [sel, setSel] = useState<number | null>(null);
  const [lang, setLang] = useState('en');
  const cur = flows.find((f) => f.id === sel) ?? flows[0] ?? null;
  const topics = topicNames(p.draft, p.merchant);
  const intents = p.draft.kb.filter((e) => e.merchant === p.merchant).map((e) => e.intent_key);

  /** Changes one flow in the draft. */
  const change = (id: number, fn: (f: Flow) => void, note: string) => p.edit((d, nt) => { const f = (d.flows ?? []).find((x) => x.id === id && x.merchant === p.merchant); if (f) { fn(f); nt(note + ' (' + p.M.name + ')'); } });
  const add = () => {
    const id = newFlowId(p.draft);
    p.edit((d, nt) => { (d.flows ??= []).push({ merchant: p.merchant, id, name: 'New flow', topic: topics[0] ?? '', status: 'draft', blocks: [] }); nt('Added flow "New flow" (' + p.M.name + ')'); });
    setSel(id);
  };
  const remove = (f: Flow) => {
    if (!confirm('Delete the flow "' + f.name + '"? It is removed from the draft until you publish.')) return;
    p.edit((d, nt) => { d.flows = (d.flows ?? []).filter((x) => !(x.id === f.id && x.merchant === p.merchant)); nt('Deleted flow "' + f.name + '" (' + p.M.name + ')'); });
    setSel(null);
  };

  return (
    <>
      <div className="card"><div className="head"><div><h2>Flows · {p.M.name}</h2><div className="sub">Draw a short conversation for a topic: the bot says something, asks a question, asks for a detail, or hands over to a person. When a customer asks about the topic, the bot runs the flow.</div></div>
        <button className="btn pri" type="button" onClick={add}>＋ New flow</button></div></div>
      {!cur ? <div className="card"><div className="sub">No flows yet. Press “New flow” to draw the first one.</div></div> : (
        <div className="flowsgrid">
          <aside className="flowlist card" aria-label="Flows">
            {flows.map((f) => { const bad = flowProblems(f, intents).length; return (
              <button key={f.id} type="button" className={'fl' + (f.id === cur.id ? ' on' : '')} onClick={() => setSel(f.id)}>
                <b>{f.name || 'Untitled'}</b><span className="sub">{f.topic || 'no topic'} · {f.blocks.length} step{f.blocks.length === 1 ? '' : 's'}</span>
                <span className="fls"><Pill c={f.status === 'live' ? 'ok' : 'warn'}>{f.status}</Pill>{bad ? <Pill c="bad">needs work</Pill> : null}</span></button>); })}
          </aside>
          <FlowEditor key={cur.id} f={cur} lang={lang} setLang={setLang} topics={topics} intents={intents} change={change} remove={remove} />
          <FlowTry flow={cur} lang={lang} />
        </div>)}
    </>
  );
}

type Next = FlowBlock extends infer B ? (B extends { next?: infer N } ? N : never) : never;

function FlowEditor({ f, lang, setLang, topics, intents, change, remove }: {
  f: Flow; lang: string; setLang: (l: string) => void; topics: string[]; intents: string[];
  change: (id: number, fn: (f: Flow) => void, note: string) => void; remove: (f: Flow) => void;
}) {
  const bad = flowProblems(f, intents);
  const up = (fn: (f: Flow) => void, note = 'Edited flow "' + f.name + '"') => change(f.id, fn, note);
  const text = (t: Record<string, string> | undefined) => (t ?? {})[lang] ?? '';
  const ph = (t: Record<string, string> | undefined, what: string) => (lang === 'en' ? what : (t?.en ? 'English: ' + t.en : what));
  const setText = (get: (b: FlowBlock) => Record<string, string> | undefined, i: number, v: string) => up((x) => { const t = get(x.blocks[i]); if (t) t[lang] = v; });
  const nextSel = (value: Next | undefined, onChange: (v: string) => void, i: number, label = 'Then') => (
    <label className="fnext"><span>{label}</span><select value={value ?? ''} aria-label={label + ' (step ' + (i + 1) + ')'} onChange={(e) => onChange(e.target.value)}>
      <option value="">continue with the step below</option>{f.blocks.map((b, j) => (j === i ? null : <option key={b.id} value={b.id}>go to step {j + 1}: {TYPE_NAME[b.type]}</option>))}<option value={FLOW_STOP}>stop here</option></select></label>);
  const setNext = (i: number, v: string) => up((x) => { (x.blocks[i] as { next?: Next }).next = v || undefined; });
  const move = (i: number, d: number) => up((x) => { const j = i + d; if (j < 0 || j >= x.blocks.length) return; const [b] = x.blocks.splice(i, 1); x.blocks.splice(j, 0, b); }, 'Moved a step in flow "' + f.name + '"');
  const del = (i: number) => up((x) => { const id = x.blocks[i].id; x.blocks.splice(i, 1); for (const b of x.blocks) { if ((b as { next?: Next }).next === id) (b as { next?: Next }).next = undefined; if (b.type === 'question') for (const o of b.options) if (o.next === id) o.next = undefined; } }, 'Removed a step from flow "' + f.name + '"');
  const addBlock = (type: FlowBlock['type']) => up((x) => { x.blocks.push(blankBlock(type, x.blocks)); }, 'Added a ' + TYPE_NAME[type].toLowerCase() + ' step to flow "' + f.name + '"');

  return (
    <section className="card floweditor" aria-label="Flow editor">
      <div className="form">
        <label className="fld"><span>Flow name</span><input value={f.name} onChange={(e) => up((x) => { x.name = e.target.value; }, 'Renamed a flow')} /></label>
        <label className="fld"><span>Topic it is for</span><select value={f.topic} onChange={(e) => up((x) => { x.topic = e.target.value; })}><option value="">Choose a topic…</option>{topics.map((t) => <option key={t}>{t}</option>)}</select></label>
        <label className="fld"><span>Status</span><select value={f.status} onChange={(e) => up((x) => { x.status = e.target.value as 'live' | 'draft'; })}><option value="live">Live</option><option value="draft">Draft (the bot ignores it)</option></select></label>
        <div className="fld"><span>Language of the texts</span><div className="segs" role="group" aria-label="Language of the texts">{LANGS.map((l) => <button key={l} type="button" aria-pressed={lang === l} onClick={() => setLang(l)}>{LN[l]}</button>)}</div></div>
      </div>
      {bad.length > 0 ? <div className="note" role="status" style={{ background: 'var(--warnbg)' }}><b>Before this flow can go live:</b><ul className="plain">{bad.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        : <div className="note" role="status" style={{ background: 'var(--okbg)' }}>✓ Ready. {f.status === 'live' ? 'Save and Publish to use it.' : 'It is a draft: set the status to Live to use it.'}</div>}
      <ol className="fsteps">
        {f.blocks.map((b, i) => (
          <li key={b.id} className={'fb t-' + b.type}>
            <div className="fbh"><span className="fbn">{i + 1}</span><b>{TYPE_NAME[b.type]}</b>
              <span className="fbt"><button type="button" className="x" aria-label={'Move step ' + (i + 1) + ' up'} disabled={i === 0} onClick={() => move(i, -1)}>↑</button><button type="button" className="x" aria-label={'Move step ' + (i + 1) + ' down'} disabled={i === f.blocks.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button type="button" className="x del" aria-label={'Delete step ' + (i + 1)} onClick={() => del(i)}>🗑</button></span></div>
            <div className="fbb">
              {(b.type === 'message' || b.type === 'ask' || b.type === 'question' || b.type === 'handoff' || b.type === 'end') && (
                <textarea rows={2} aria-label={'Text of step ' + (i + 1)} value={text(b.text)} placeholder={ph(b.text, b.type === 'question' ? 'The question the bot asks' : b.type === 'ask' ? 'What the bot asks for, e.g. What is your username?' : b.type === 'handoff' ? 'Optional: what the bot says before a person joins' : b.type === 'end' ? 'Optional: a closing line' : 'What the bot says. Use {name} for a detail asked earlier.')} onChange={(e) => setText((x) => (x as { text: Record<string, string> }).text, i, e.target.value)} />)}
              {b.type === 'ask' && <label className="fnext"><span>Keep it as</span><input aria-label={'Name of the detail in step ' + (i + 1)} value={b.field} onChange={(e) => up((x) => { (x.blocks[i] as { field: string }).field = e.target.value.replace(/[^\w]/g, ''); })} /><span className="sub">write {'{' + (b.field || 'name') + '}'} in a later text to use it</span></label>}
              {b.type === 'answer' && <label className="fnext"><span>Say this answer</span><select aria-label={'Answer of step ' + (i + 1)} value={b.intent} onChange={(e) => up((x) => { (x.blocks[i] as { intent: string }).intent = e.target.value; })}><option value="">Choose an answer…</option>{intents.map((k) => <option key={k}>{k}</option>)}</select></label>}
              {b.type === 'question' && <div className="fopts">{b.options.map((o, k) => (
                <div className="fopt" key={o.id}><input aria-label={'Choice ' + (k + 1) + ' of step ' + (i + 1)} value={text(o.label)} placeholder={ph(o.label, 'Choice ' + (k + 1))} onChange={(e) => up((x) => { (x.blocks[i] as Extract<FlowBlock, { type: 'question' }>).options[k].label[lang] = e.target.value; })} />
                  <select aria-label={'After choice ' + (k + 1) + ' of step ' + (i + 1)} value={o.next ?? ''} onChange={(e) => up((x) => { (x.blocks[i] as Extract<FlowBlock, { type: 'question' }>).options[k].next = e.target.value || undefined; })}>
                    <option value="">then the step below</option>{f.blocks.map((c, j) => (j === i ? null : <option key={c.id} value={c.id}>then step {j + 1}: {TYPE_NAME[c.type]}</option>))}<option value={FLOW_STOP}>then stop</option></select>
                  <button type="button" className="x" aria-label={'Remove choice ' + (k + 1) + ' of step ' + (i + 1)} disabled={b.options.length <= 2} onClick={() => up((x) => { (x.blocks[i] as Extract<FlowBlock, { type: 'question' }>).options.splice(k, 1); })}>×</button></div>))}
                {b.options.length < 6 && <button type="button" className="btn sm" onClick={() => up((x) => { const q = x.blocks[i] as Extract<FlowBlock, { type: 'question' }>; q.options.push({ id: newBlockId(q.options, 'o'), label: { en: '' } }); })}>＋ Add a choice</button>}</div>}
              {(b.type === 'message' || b.type === 'answer' || b.type === 'ask') && nextSel((b as { next?: Next }).next, (v) => setNext(i, v), i)}
              {(b.type === 'handoff') && <div className="sub">A person takes over here. The flow stops.</div>}
              {(b.type === 'end') && <div className="sub">The flow is finished here.</div>}
            </div>
          </li>))}
      </ol>
      {!f.blocks.length && <div className="sub">No steps yet. Add the first one below.</div>}
      <div className="fadd"><span className="sub">Add a step:</span>{FLOW_TYPES.map(([k, l, tip]) => <button key={k} type="button" className="btn sm" title={tip} onClick={() => addBlock(k)}>＋ {l}</button>)}</div>
      <div className="head" style={{ marginTop: 6 }}><span className="sub">Saved as a draft change until you publish.</span><button className="btn sm bad" type="button" onClick={() => remove(f)}>Delete this flow</button></div>
    </section>
  );
}
