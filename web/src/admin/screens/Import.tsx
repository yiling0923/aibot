import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePanel } from '../store';
import { LANGS, LN, SAMPLE_CSV, TPL_HEAD, analyzeImport, addOwnTopic, topicNames, kbToCSV, type Entry, type ImportGroup } from '../model';
import { Pill } from '../ui';

type Tr = { question_examples: string[]; answer_text: string };

export default function Import() {
  const p = usePanel(); const nav = useNavigate();
  const [text, setText] = useState(''); const [name, setName] = useState(''); const [mode, setMode] = useState('update'); const [status, setStatus] = useState<'draft' | 'live'>('draft'); const [out, setOut] = useState('');
  const R = useMemo(() => analyzeImport(text, p.draft, p.merchant, p.M.name), [text, p.draft, p.merchant, p.M.name]);
  const ok = R.entries.filter((g) => !g.errors.length);
  const nNew = ok.filter((g) => !g.exists).length, nUpd = ok.filter((g) => g.exists).length, nErr = R.entries.length - ok.length, nWarn = ok.filter((g) => g.issues.length).length;
  const willImport = ok.filter((g) => !(g.exists && mode === 'skip')).length;
  const mine = p.draft.kb.filter((e) => e.merchant === p.merchant);

  const dots = (g: ImportGroup) => LANGS.map((l) => {
    const x = g.langs[l]; const ex = g.existing?.translations[l] as Tr | undefined;
    const st = x ? (x.answer && x.examples.length >= 3 ? 'on' : 'part') : ex?.answer_text ? 'on' : '';
    return <span key={l} className={'dot ' + st}>{LN[l]}</span>;
  });

  const copy = (txt: string, done: string) => { try { navigator.clipboard.writeText(txt).then(() => p.toast(done), () => setOut(txt)); } catch { setOut(txt); } };

  const run = () => {
    const todo = ok.filter((g) => !(g.exists && mode === 'skip')); let nn = 0, nu = 0;
    p.edit((d, note) => {
      const needT = new Map<string, string[]>();
      todo.forEach((g) => { const t = g.topic || g.existing?.topic; if (t) { const a = needT.get(t) || []; g.topicWords.forEach((w) => a.push(w)); needT.set(t, a); } });
      needT.forEach((words, t) => {
        if (!topicNames(d, p.merchant).includes(t)) note('Added topic word "' + t + '" (' + p.M.name + ')');
        addOwnTopic(d, p.merchant, t, words);                                              // a topic and its keywords from a file belong to this merchant
      });
      todo.forEach((g) => {
        const tr = (l: string): Tr | null => (g.langs[l] ? { question_examples: g.langs[l].examples, answer_text: g.langs[l].answer } : null);
        const e = d.kb.find((x) => x.merchant === p.merchant && x.intent_key === g.key);
        if (e) {
          LANGS.forEach((l) => { const x = tr(l); if (x && (x.answer_text || x.question_examples.length)) (e.translations as Record<string, Tr>)[l] = x; });
          if (g.topic) e.topic = g.topic; if (g.aspect) e.aspect = g.aspect; if (g.optional) e.topic_optional = true; e.dirty = true; nu++;
        } else {
          const tl: Record<string, Tr> = {}; LANGS.forEach((l) => { tl[l] = tr(l) || { question_examples: [], answer_text: '' }; });
          const ne: Entry = { id: Math.max(0, ...d.kb.map((x) => x.id)) + 1, merchant: p.merchant, category: 'Imported', intent_key: g.key, topic: g.topic || '', aspect: g.aspect || null, topic_optional: g.optional, translations: tl, status, dirty: true, updated: 'just now' };
          d.kb.push(ne); nn++;
        }
      });
      note('Imported ' + (nn + nu) + ' entries from ' + (name || 'pasted text') + ' (' + nn + ' new, ' + nu + ' updated) for ' + p.M.name);
    });
    p.toast('Imported ' + (nn + nu) + ' entries to draft'); nav('/admin/kb');
  };

  return (
    <div className="card"><div className="head"><div><h2>Import knowledge base · {p.M.name}</h2><div className="sub">Load a whole set from a file instead of typing it. Each merchant has its own file. Nothing goes live until you publish.</div></div></div>
      <div className="steps" style={{ marginTop: 12 }}>
        <div className="step"><span className="n">1</span><div><b>Merchant</b><div className="sub">The file is imported into <b>{p.M.name}</b>. Change it in the sidebar. If the file has a <span className="mono">merchant</span> column, rows for other merchants are skipped.</div></div></div>
        <div className="step"><span className="n">2</span><div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><b>Add the file</b>
          <div className="drop"><div className="tools">
            <input type="file" accept=".csv,.tsv,.txt" aria-label="Choose a CSV file" onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const fr = new FileReader(); fr.onload = () => { setText(String(fr.result)); setName(f.name); setOut(''); }; fr.readAsText(f, 'utf-8'); }} />
            <button className="btn sm" type="button" onClick={() => { setText(SAMPLE_CSV); setName('sample_' + p.merchant.toLowerCase() + '.csv'); setOut(''); }}>Load a sample file</button>
            <button className="btn sm" type="button" onClick={() => copy(TPL_HEAD, 'Template copied')}>Copy blank template</button>
            <button className="btn sm" type="button" onClick={() => copy(kbToCSV(mine), 'KB copied as CSV')}>Copy this merchant's KB as CSV</button></div>
            <textarea placeholder="Or paste CSV here (from Excel or Google Sheets works too)" aria-label="Paste CSV" value={text} onChange={(e) => { setText(e.target.value); if (!e.target.value) setName(''); setOut(''); }} />
            {name && <div className="sub">Loaded: <b>{name}</b> <button className="btn sm" type="button" onClick={() => { setText(''); setName(''); }}>Clear</button></div>}</div>
          <details><summary>File format</summary><div className="sub" style={{ marginTop: 6 }}>One row for each entry and language. Use the same <span className="mono">intent_key</span> on every language row of an entry. Separate example questions with <span className="mono">|</span>.</div>
            <div className="scroll"><table><thead><tr><th>Column</th><th>Needed?</th><th>Example</th></tr></thead><tbody>
              <tr><td className="mono">intent_key</td><td>yes</td><td>deposit_time</td></tr><tr><td className="mono">language</td><td>yes</td><td>en, ms or zh</td></tr><tr><td className="mono">answer_text</td><td>yes (English at least)</td><td>Deposits are usually credited within 5 minutes.</td></tr>
              <tr><td className="mono">question_examples</td><td>recommended</td><td>how long deposit take | dep not arrive | depo pending</td></tr><tr><td className="mono">topic</td><td><b>yes</b></td><td>deposit, refund. A new one is created automatically.</td></tr><tr><td className="mono">topic_short_forms</td><td>optional</td><td>refunds | bayaran balik | 退款</td></tr>
              {p.adv && <tr><td className="mono">question_type</td><td>optional</td><td>time, limit, how, change, hours</td></tr>}<tr><td className="mono">merchant</td><td>optional</td><td>MERCH_A or LuckyPay</td></tr></tbody></table></div>
            <div className="sub" style={{ marginTop: 6 }}>Files made by this tool's "Copy KB as CSV" import back with no changes.</div></details>
          {out && <div><div className="sub">Copying was blocked here, so the text is shown. Select it and copy:</div><textarea readOnly style={{ minHeight: 120, fontFamily: 'var(--mono)', fontSize: 12, whiteSpace: 'pre' }} value={out} /></div>}
        </div></div>
        <div className="step"><span className="n">3</span><div style={{ flex: 1, minWidth: 0 }}><b>Check</b>
          {R.fatal ? <div className="note" style={{ background: 'var(--badbg)', marginTop: 6 }}>{R.fatal}</div>
            : !R.entries.length ? <div className="sub">Add a file or paste text to see the check.</div>
            : <>
              <div className="stats" style={{ margin: '6px 0' }}><div className="stat"><b>{nNew}</b>new</div><div className="stat"><b>{nUpd}</b>update an existing entry</div><div className="stat"><b>{nWarn}</b>with warnings</div><div className="stat"><b>{nErr}</b>blocked</div>{R.skippedRows ? <div className="stat"><b>{R.skippedRows}</b>rows for other merchants skipped</div> : null}</div>
              <div className="scroll"><table><thead><tr><th>Entry</th><th>Action</th><th>Topic · question</th><th>Languages</th><th>Check</th></tr></thead><tbody>
                {R.entries.map((g, i) => {
                  const blocked = g.errors.length; const topic = g.topic || g.existing?.topic || '', asp = g.aspect || g.existing?.aspect || '';
                  return (
                    <tr key={i}><td><b>{g.key || '(no name)'}</b></td>
                      <td>{blocked ? <Pill c="bad">blocked</Pill> : g.exists ? (mode === 'skip' ? <Pill>skipped</Pill> : <Pill c="info">update</Pill>) : <Pill c="ok">new</Pill>}</td>
                      <td>{topic ? <Pill c="info">{topic}</Pill> : <span className="sub">none</span>} {asp ? <Pill>{asp}</Pill> : null}</td>
                      <td><div className="dots">{dots(g)}</div></td>
                      <td>{blocked ? <ul className="iss" style={{ color: 'var(--bad)' }}>{g.errors.map((x, j) => <li key={j}>{x}</li>)}</ul> : null}
                        {g.issues.length ? <ul className="iss" style={{ color: 'var(--warn)' }}>{g.issues.map((x, j) => <li key={j}>{x}</li>)}</ul> : !blocked ? <Pill c="ok">looks good</Pill> : null}</td></tr>
                  );
                })}</tbody></table></div></>}
        </div></div>
        <div className="step"><span className="n">4</span><div><b>Import</b>
          <div className="form" style={{ marginTop: 6 }}>
            <label className="fld"><span>If the entry already exists</span><select value={mode} onChange={(e) => setMode(e.target.value)}><option value="update">Update it (languages in the file replace the old ones)</option><option value="skip">Skip it</option></select></label>
            <label className="fld"><span>New entries start as</span><select value={status} onChange={(e) => setStatus(e.target.value as 'draft' | 'live')}><option value="draft">Draft (bot ignores them until you set them live)</option><option value="live">Live</option></select></label></div>
          <div className="tools" style={{ marginTop: 8 }}><button className="btn pri" type="button" disabled={!willImport} onClick={run}>Import {willImport} entr{willImport === 1 ? 'y' : 'ies'} to draft</button><span className="sub">Blocked entries are left out. Warnings do not stop an import. Updated entries keep their live or draft status.</span></div></div></div>
      </div></div>
  );
}
