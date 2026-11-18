import { useState } from 'react';
import { writeXlsx } from '../xlsx';
import { BLANK_ROWS, EXAMPLE_ROWS, WIDTHS } from '../importSamples';

function save(name: string, bytes: Uint8Array) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
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

const CHECKS = ['Each entry has an English row (the AI can translate the rest)', 'Every row has an entry name, a topic, a language and an answer', 'Questions are separated with |, not commas', 'No private data (real names, phone numbers, passwords)'];

/** One big step: a number, a picture, a few words. */
function Step({ n, icon, title, children }: { n: number; icon: string; title: string; children?: React.ReactNode }) {
  return (
    <li className="gd-step">
      <span className="gd-bignum" aria-hidden="true">{n}</span>
      <span className="gd-icon" aria-hidden="true">{icon}</span>
      <div><b>{title}</b>{children ? <div className="gd-sub">{children}</div> : null}</div>
    </li>
  );
}
const Btn = ({ children }: { children: React.ReactNode }) => <span className="gd-fakebtn">{children}</span>;

/** How to import, for anyone: five big steps, then a little more help that stays closed until it is wanted. */
export default function Guide() {
  const [done, setDone] = useState<Set<number>>(new Set());
  const flip = (i: number) => setDone((x) => { const n = new Set(x); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  return (
    <div className="guide">
      <section className="card gd-hero">
        <h2>How to import: 5 easy steps</h2>
        <p className="gd-lead">Put many answers into the bot at one time.</p>
        <ol className="gd-steps2">
          <Step n={1} icon="📥" title="Get the Excel file">
            <button className="btn pri" type="button" onClick={() => save('knowledge_base_example.xlsx', writeXlsx(EXAMPLE_ROWS, WIDTHS, 'Knowledge base'))}>Download example file</button>
            <button className="btn" type="button" onClick={() => save('knowledge_base_blank.xlsx', writeXlsx(BLANK_ROWS, WIDTHS, 'Knowledge base'))}>Download blank file</button>
          </Step>
          <Step n={2} icon="✏️" title="Write in Excel">English is enough. One line for each question and its answer.</Step>
          <Step n={3} icon="📂" title="Open Import, then press"><Btn>Upload a file</Btn> and choose your Excel file.</Step>
          <Step n={4} icon="👆" title="Press the import button">Tick <b>Translate the empty languages with AI</b> if you see it. The AI writes Malay and Chinese for you.</Step>
          <Step n={5} icon="🚀" title="Press Publish">Look at the yellow bar at the top. Press <Btn>Review and publish</Btn>. Now customers can see it.</Step>
        </ol>
        <div className="gd-done">🎉 That is all!</div>
      </section>

      <details className="card gd-more">
        <summary>Need more help? Open here</summary>
        <h3>No Excel? Type in a table</h3>
        <p>On the <b>Import</b> page you can type in the table, or copy cells from Excel or Google Sheets and paste them in (click the first cell, press Ctrl+V).</p>
        <h3>What to write in each box</h3>
        <div className="gd-cols">
          {COLS.map(([c, n, w, e]) => (
            <div className="gd-col" key={c}>
              <div className="gd-colh"><span className="mono gd-name">{c}</span><span className={'gd-tag ' + (n === 'Optional' ? 'opt' : 'req')}>{n === 'Optional' ? 'Optional' : n === 'Yes' ? 'Required' : 'Strongly advised'}</span></div>
              <p>{w}</p>
              <div className="gd-eg"><small>Example</small><span className="mono">{e}</span></div>
            </div>
          ))}
        </div>
        <section className="gd-two">
          <div className="gd-do"><h3>Do</h3><ul>
            <li>Write real facts: time, amount, steps.</li>
            <li>Write each question the way customers type it, short and lazy.</li>
            <li>Keep answers to one to three sentences.</li>
          </ul></div>
          <div className="gd-dont"><h3>Do not</h3><ul>
            <li>Promise what you are not sure of ("always instant").</li>
            <li>Put two different questions in one answer.</li>
            <li>Use the same question in two entries. The bot cannot tell which to answer.</li>
          </ul></div>
        </section>
        <h3>Check before you import</h3>
        <ul className="gd-checks">{CHECKS.map((c, i) => <li key={c}><label><input type="checkbox" checked={done.has(i)} onChange={() => flip(i)} /> <span>{c}</span></label></li>)}</ul>
        <p className="sub">Import the same entry name again and it updates that entry, so a fixed file can be imported again safely.</p>
      </details>
    </div>
  );
}
