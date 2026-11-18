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

/** A guide for the marketing team: how to write the knowledge base file and import it. */
export default function Guide() {
  return (
    <div className="guide">
      <div className="card">
        <h2>Guide: write the knowledge base and import it</h2>
        <div className="sub">The bot answers customers <b>only</b> from what is written here. If it is not in the knowledge base, the bot does not guess. It asks once, then passes the customer to a person.</div>
        <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: 'wrap' }}>
          <button className="btn sm" type="button" onClick={() => save('knowledge_base_example.csv', SAMPLE_CSV)}>Download example file</button>
          <button className="btn sm" type="button" onClick={() => save('knowledge_base_blank.csv', TPL_HEAD + '\n')}>Download blank file</button>
        </div>
      </div>
      <div className="card">
        <h3>1. Make the file</h3>
        <p>Use Excel or Google Sheets. One row is <b>one answer in one language</b>. When done: <b>File, Save as, CSV (UTF-8)</b>. UTF-8 matters, or Chinese and Thai letters turn into strange symbols. Easiest start: download the example file, change the words, keep the first row.</p>
      </div>
      <div className="card">
        <h3>2. The columns</h3>
        <div className="scroll"><table><thead><tr><th>Column</th><th>Fill it?</th><th>What to write</th><th>Example</th></tr></thead><tbody>
          {COLS.map(([c, n, w, e]) => <tr key={c}><td className="mono">{c}</td><td>{n}</td><td>{w}</td><td className="mono">{e}</td></tr>)}
        </tbody></table></div>
        <p className="sub">The same <span className="mono">intent_key</span> on three rows (en, ms, zh) means the same answer in three languages.</p>
      </div>
      <div className="card">
        <h3>3. Writing rules</h3>
        <ul>
          <li><b>Do:</b> write real facts (time, amount, steps). Write each question the way customers type it. One question per entry. Keep answers short, one to three sentences. Do English first, then add other languages.</li>
          <li><b>Do not:</b> promise what you are not sure of ("always instant"). Put two different questions in one answer. Use the same example question in two different entries, because the bot then cannot tell which to answer. Leave <span className="mono">answer_text</span> empty on a normal entry.</li>
        </ul>
      </div>
      <div className="card">
        <h3>4. Import it</h3>
        <ol>
          <li>Choose the <b>merchant</b> at the top left.</li>
          <li>Go to <b>Import</b> and pick the CSV file.</li>
          <li>Read the preview: <b>new</b> entries, entries that will <b>update</b> an old one, and <b>problems</b> in red. Fix problems in the file and import again.</li>
          <li>Press the import button. The entries go into the <b>draft</b> only.</li>
          <li>Check a few entries in <b>Knowledge base</b>.</li>
          <li><b>Press Publish.</b> Customers get the new answers only after this. The yellow "Not live yet" bar reminds you.</li>
        </ol>
        <p className="sub">Importing the same <span className="mono">intent_key</span> again updates that entry, so a fixed file can be imported again safely.</p>
      </div>
      <div className="card">
        <h3>5. Check before you import</h3>
        <ul>
          <li>Saved as CSV <b>UTF-8</b>.</li>
          <li>Every row has intent_key, topic, language and answer_text.</li>
          <li>Questions are separated with <span className="mono">|</span>, not commas.</li>
          <li>Each entry has at least an English row.</li>
          <li>No private data (real names, phone numbers, passwords).</li>
        </ul>
      </div>
    </div>
  );
}
