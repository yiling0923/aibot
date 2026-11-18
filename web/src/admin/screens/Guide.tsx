import { useState } from 'react';
import { SAMPLE_CSV, TPL_HEAD } from '../model';

function save(name: string, text: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const COLS: [string, string, string, string][] = [
  ['intent_key', 'Yes', 'A short name for the question, no spaces (use _). Use the same name on every language row of the same answer.', 'deposit_time'],
  ['topic', 'Yes', 'The big subject. A new subject is created automatically.', 'deposit'],
  ['language', 'Yes', 'en English, ms Malay, zh Chinese, vi Vietnamese, th Thai, tl Filipino', 'en'],
  ['question_examples', 'Strongly yes', 'How real customers type this question. Put | between each one. 4 to 8 is good. Include short, lazy and spelling-mistake versions.', 'how long deposit take | depo not in yet'],
  ['answer_text', 'Yes', 'The reply the customer sees. Facts only. Put it inside quotes "..." if it has a comma.', '"Deposits are credited within 5 minutes."'],
  ['question_type', 'Optional', 'Splits one topic into kinds: time, limit, how, change, hours. Leave empty if unsure.', 'time'],
  ['entry_type', 'Optional', 'answer (bot replies, the default), promotion (a current offer), needs_staff (a person must handle it; no answer text needed).', 'answer'],
  ['topic_short_forms', 'Optional', 'Other words customers use for the topic. Put | between.', 'depo | top up | 充值'],
  ['merchant', 'Optional', 'Only if one file holds several merchants. Otherwise leave it out.', 'LuckyPay'],
];

const STEPS: [string, string][] = [['Write', 'Fill the CSV file'], ['Import', 'Pick it in Import'], ['Check', 'Read the preview'], ['Publish', 'Make it live']];
const CHECKS = ['Saved as CSV UTF-8', 'Every row has intent_key, topic, language and answer_text', 'Questions are separated with |, not commas', 'Each entry has at least an English row', 'No private data (real names, phone numbers, passwords)'];
const EXAMPLE: [string, string, string, string][] = [
  ['deposit_time', 'en', 'how long deposit take | depo not in yet', 'Deposits are credited within 5 minutes.'],
  ['deposit_time', 'ms', 'berapa lama deposit masuk | depo lambat', 'Deposit dikreditkan dalam masa 5 minit.'],
  ['deposit_time', 'zh', '充值要多久 | 充值还没到账', '充值通常在5分钟内到账。'],
];
const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

/** A guide for the marketing team: how to write the knowledge base file and import it. */
export default function Guide() {
  const [done, setDone] = useState<Set<number>>(new Set());
  const flip = (i: number) => setDone((x) => { const n = new Set(x); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  return (
    <div className="guide">
      <section className="card gd-hero">
        <h2>Guide: write the knowledge base and import it</h2>
        <p className="gd-lead">The bot answers customers <b>only</b> from the knowledge base. If something is not written here, it does not guess. It asks once, then passes the customer to a person.</p>
        <ol className="gd-flow" aria-label="The four steps">
          {STEPS.map(([t, d], i) => <li key={t}><span className="gd-num">{i + 1}</span><b>{t}</b><small>{d}</small></li>)}
        </ol>
        <div className="gd-actions">
          <button className="btn pri" type="button" onClick={() => save('knowledge_base_example.csv', SAMPLE_CSV)}>Download example file</button>
          <button className="btn" type="button" onClick={() => save('knowledge_base_blank.csv', TPL_HEAD + '\n')}>Download blank file</button>
          <span className="gd-jump">Jump to: {[['gd-cols', 'Columns'], ['gd-rules', 'Rules'], ['gd-import', 'Import steps']].map(([id, l]) => <button key={id} type="button" className="linkbtn" onClick={() => jump(id)}>{l}</button>)}</span>
        </div>
      </section>

      <section className="card">
        <h3>1. Make the file</h3>
        <p>Use Excel or Google Sheets. One row is <b>one answer in one language</b>. When done choose <b>File, Save as, CSV (UTF-8)</b>. UTF-8 matters, or Chinese and Thai letters turn into strange symbols.</p>
        <p className="sub">Easiest start: download the example file, change the words, keep the first row.</p>
        <div className="scroll"><table className="gd-ex"><thead><tr><th>Entry name</th><th>Language</th><th>How customers ask</th><th>Reply</th></tr></thead><tbody>
          {EXAMPLE.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j < 2 ? 'mono' : ''}>{c}</td>)}</tr>)}
        </tbody></table></div>
        <p className="sub">Same entry name on three rows means the same answer in three languages.</p>
      </section>

      <section className="card" id="gd-cols">
        <h3>2. The columns</h3>
        <div className="gd-cols">
          {COLS.map(([c, n, w, e]) => (
            <div className="gd-col" key={c}>
              <div className="gd-colh"><span className="mono gd-name">{c}</span><span className={'gd-tag ' + (n === 'Optional' ? 'opt' : 'req')}>{n === 'Optional' ? 'Optional' : n === 'Yes' ? 'Required' : 'Strongly advised'}</span></div>
              <p>{w}</p>
              <div className="gd-eg"><small>Example</small><span className="mono">{e}</span></div>
            </div>
          ))}
        </div>
      </section>

      <section className="gd-two" id="gd-rules">
        <div className="card gd-do"><h3>Do</h3><ul>
          <li>Write real facts: time, amount, steps.</li>
          <li>Write each question the way customers type it, short and lazy.</li>
          <li>One question for each entry.</li>
          <li>Keep answers to one to three sentences.</li>
          <li>Do English first, then add other languages.</li>
        </ul></div>
        <div className="card gd-dont"><h3>Do not</h3><ul>
          <li>Promise what you are not sure of ("always instant").</li>
          <li>Put two different questions in one answer.</li>
          <li>Use the same example question in two entries. The bot then cannot tell which to answer.</li>
          <li>Leave <span className="mono">answer_text</span> empty on a normal entry.</li>
        </ul></div>
      </section>

      <section className="card" id="gd-import">
        <h3>3. Import it</h3>
        <ol className="gd-steps">
          <li>Choose the <b>merchant</b> at the top left.</li>
          <li>Go to <b>Import</b> and pick the CSV file.</li>
          <li>Read the preview: <b>new</b> entries, entries that will <b>update</b> an old one, and <b>problems</b> in red. Fix problems in the file and import again.</li>
          <li>Press the import button. The entries go into the <b>draft</b> only.</li>
          <li>Check a few entries in <b>Knowledge base</b>.</li>
          <li><b>Press Publish.</b> Customers get the new answers only after this. The yellow "Not live yet" bar reminds you.</li>
        </ol>
        <p className="sub">Importing the same entry name again updates that entry, so a fixed file can be imported again safely.</p>
      </section>

      <section className="card">
        <h3>4. Check before you import</h3>
        <ul className="gd-checks">{CHECKS.map((c, i) => <li key={c}><label><input type="checkbox" checked={done.has(i)} onChange={() => flip(i)} /> <span>{c}</span></label></li>)}</ul>
        <p className="sub">{done.size === CHECKS.length ? 'All checked. You are ready to import.' : done.size + ' of ' + CHECKS.length + ' checked'}</p>
      </section>
    </div>
  );
}
