import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { usePanel } from '../store';
import { LANGS, slug, type Entry } from '../model';
import { Modal } from '../ui';
import { parseTable } from '../model';
import { readXlsx, writeXlsx } from '../xlsx';
import { CHAT_EXAMPLE_ROWS, CHAT_WIDTHS } from '../importSamples';

interface Group { key: string; kind: 'covered' | 'topic' | 'text'; label: string; topic: string | null; intent: string | null; count: number; withReply: number; customers: { text: string; n: number }[]; replies: { text: string; n: number }[] }
interface Learn { mode: 'listening' | 'answering'; since: string | null; days: number | null; pairs: number; chats: number; withReply: number; groups: Group[] }
const MONTH = 30;

interface Msg { chat: string; from: 'customer' | 'staff'; text: string; at?: string }
const CUSTOMER = /^(visitor|customer|user|client|guest|member|buyer|顾客|客户|访客)$/i, STAFF = /^(operator|agent|staff|admin|human|support|bot|assistant|cs|service|客服)$/i;
const COLS: Record<'chat' | 'from' | 'text' | 'at', string[]> = { chat: ['chat_id', 'chat', 'conversation', 'conversation_id', 'session', 'session_id'], from: ['sender', 'from', 'role', 'sender_type', 'author', 'who'], text: ['text', 'message', 'body', 'content'], at: ['time', 'created_at', 'date', 'at', 'timestamp'] };

/** An export of past chats (rows of text, from Excel or CSV) as messages. Rows of a chat are put in time order when every one has a time, else the file order is kept. */
export function readChats(rows: string[][]): { messages: Msg[]; chats: number; customer: number; staff: number; skipped: number; error: string } {
  const none = { messages: [] as Msg[], chats: 0, customer: 0, staff: 0, skipped: 0 };
  if (rows.length < 2) return { ...none, error: 'The file needs a header row and at least one message.' };
  const head = rows[0].map((h) => h.trim().toLowerCase()); const at = (k: keyof typeof COLS) => head.findIndex((h) => COLS[k].includes(h));
  const ix = { chat: at('chat'), from: at('from'), text: at('text'), at: at('at') };
  const miss = (['chat', 'from', 'text'] as const).filter((k) => ix[k] < 0);
  if (miss.length) return { ...none, error: 'Missing column: ' + miss.map((k) => COLS[k][0]).join(', ') + '. Found: ' + head.join(', ') };
  const by = new Map<string, { m: Msg; t: number }[]>(); let skipped = 0;
  for (const r of rows.slice(1)) {
    const text = (r[ix.text] ?? '').trim(); const who = (r[ix.from] ?? '').trim(); const chat = (r[ix.chat] ?? '').trim();
    if (!text || !chat) { if (text || chat) skipped++; continue; }
    const from = CUSTOMER.test(who) ? 'customer' : STAFF.test(who) ? 'staff' : null; if (!from) { skipped++; continue; }
    const time = ix.at >= 0 ? (r[ix.at] ?? '').trim() : ''; const t = time ? Date.parse(time) : NaN;
    const list = by.get(chat) ?? []; list.push({ m: { chat, from, text: text.slice(0, 1000), ...(time ? { at: time } : {}) }, t }); by.set(chat, list);
  }
  const messages: Msg[] = []; let customer = 0, staff = 0;
  for (const list of by.values()) {
    const ordered = list.every((x) => !Number.isNaN(x.t)) ? [...list].sort((a, b) => a.t - b.t) : list;
    for (const x of ordered) { messages.push(x.m); if (x.m.from === 'customer') customer++; else staff++; }
  }
  return { messages, chats: by.size, customer, staff, skipped, error: '' };
}

/** The first weeks of a merchant in LiveChat: the bot only listens, then staff review what it learned and an admin switches it to answering. */
export default function Learning() {
  const p = usePanel(); const [d, setD] = useState<Learn | null>(null); const [err, setErr] = useState(''); const [ask, setAsk] = useState<'listening' | 'answering' | null>(null); const [busy, setBusy] = useState(false);
  const load = () => api<Learn>('/api/admin/learning?merchant=' + encodeURIComponent(p.merchant));
  useEffect(() => { let alive = true; setErr(''); setD(null); load().then((x) => { if (alive) setD(x); }).catch((e: Error) => { if (alive) setErr(e.message); }); return () => { alive = false; }; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [p.merchant]);

  const [file, setFile] = useState<{ name: string; r: ReturnType<typeof readChats> } | null>(null); const [importing, setImporting] = useState(false); const [fileKey, setFileKey] = useState(0);
  const pick = (f: File | undefined) => {
    if (!f) return; setFile(null);
    const done = (rows: string[][]) => setFile({ name: f.name, r: readChats(rows) });
    if (/\.xlsx$/i.test(f.name)) { const fr = new FileReader(); fr.onload = () => { try { done(readXlsx(new Uint8Array(fr.result as ArrayBuffer))); } catch (e) { setFile({ name: f.name, r: { messages: [], chats: 0, customer: 0, staff: 0, skipped: 0, error: (e as Error).message } }); } }; fr.readAsArrayBuffer(f); }
    else { const fr = new FileReader(); fr.onload = () => done(parseTable(String(fr.result))); fr.readAsText(f, 'utf-8'); }
  };
  const runImport = async () => {
    if (!file || file.r.error || !file.r.messages.length) return; setImporting(true);
    try {
      let chats = 0, pairs = 0, withReply = 0; const all = file.r.messages; let batch: Msg[] = [];
      const flush = async () => { if (!batch.length) return; const r = await api<{ chats: number; pairs: number; withReply: number }>('/api/admin/learning/import', { merchant: p.merchant, messages: batch }); chats += r.chats; pairs += r.pairs; withReply += r.withReply; batch = []; };
      let lastChat = ''; for (const m of all) { if (batch.length >= 2000 && m.chat !== lastChat) await flush(); batch.push(m); lastChat = m.chat; }
      await flush();
      setD(await load()); setFile(null); setFileKey((k) => k + 1); p.toast(`Learned from ${chats} old chat${chats === 1 ? '' : 's'}: ${pairs} question${pairs === 1 ? '' : 's'}, ${withReply} with a staff reply.`);
    } catch (e) { p.toast((e as Error).message); }
    setImporting(false);
  };
  const mine = p.draft.kb.filter((e) => e.merchant === p.merchant);
  const liveCount = mine.filter((e) => e.status === 'live').length;
  const switchTo = async (mode: 'listening' | 'answering') => {
    setBusy(true);
    try { await api('/api/admin/merchants/' + encodeURIComponent(p.merchant) + '/mode', { mode }); setD(await load()); await p.refreshMerchants(); setAsk(null);
      p.toast(mode === 'answering' ? 'The bot now answers customers in LiveChat.' : 'The bot now only listens. Staff answer customers.'); }
    catch (e) { p.toast((e as Error).message); }
    setBusy(false);
  };
  const added = (g: Group) => mine.some((e) => e.category === 'Learned' && ((e.translations as Record<string, { question_examples?: string[] }>).en?.question_examples ?? []).includes(g.customers[0]?.text ?? '\u0000'));      // an entry made from this group already exists
  const add = (g: Group) => {
    const key = slug(g.topic ? g.label + '_' + (g.customers[0]?.text ?? '') : g.customers[0]?.text ?? g.label).slice(0, 60) || 'learned_entry';
    const unique = (() => { let k = key, i = 2; while (mine.some((e) => e.intent_key === k)) k = key + '_' + i++; return k; })();
    p.edit((dr, note) => {
      const tl: Record<string, { question_examples: string[]; answer_text: string }> = {}; LANGS.forEach((l) => { tl[l] = { question_examples: [], answer_text: '' }; });
      tl.en = { question_examples: g.customers.slice(0, 8).map((c) => c.text), answer_text: g.replies[0]?.text ?? '' };
      const ne: Entry = { id: Math.max(0, ...dr.kb.map((x) => x.id)) + 1, merchant: p.merchant, category: 'Learned', intent_key: unique, topic: g.topic || '', aspect: null, topic_optional: false, translations: tl as Entry['translations'], status: 'draft', dirty: true, updated: 'just now' };
      dr.kb.push(ne); note(`Added "${unique}" from what the bot learned (${p.M.name})`);
    });
    p.toast('Added “' + unique + '” to the Knowledge base as a draft. Check the answer, set it live, then press Publish.');
  };

  const listening = d?.mode === 'listening';
  const day = d?.days ?? 0;
  return (
    <>
      <div className="card"><div className="head"><div><h2>Learning · {p.M.name}</h2><div className="sub">When a merchant is first put in LiveChat, the bot can only listen: it stays silent, staff answer as usual, and the bot saves each question with the staff reply. Then you check what it learned and switch it to answering.</div></div></div>
        {err && <div className="note" style={{ background: 'var(--badbg)' }}>{err}</div>}
        {d && <div className="lrn">
          <div className="lrnstat">
            <span className={'vchip ' + (listening ? 'warn' : '')}><i />{listening ? 'Listening: the bot is silent' : 'Answering: the bot replies to customers'}</span>
            {listening && d.since && <div className="lrnprog" role="progressbar" aria-label="Days listening" aria-valuenow={Math.min(day, MONTH)} aria-valuemax={MONTH}><i style={{ width: Math.min(100, Math.round((day / MONTH) * 100)) + '%' }} /></div>}
            {listening && d.since && <span className="sub">Day {day + 1} of about {MONTH}. {day >= MONTH ? 'A month has passed: you can start answering when you are ready.' : ''}</span>}
          </div>
          <div className="lrntiles">
            <div className="lrntile"><b>{d.chats}</b><span>chats seen</span></div>
            <div className="lrntile"><b>{d.pairs}</b><span>questions saved</span></div>
            <div className="lrntile"><b>{d.withReply}</b><span>with a staff reply</span></div>
            <div className="lrntile"><b>{liveCount}</b><span>live answers in the Knowledge base</span></div>
          </div>
          {p.isAdmin
            ? <div className="tools">{listening
              ? <button className="btn pri" type="button" onClick={() => setAsk('answering')}>Start answering</button>
              : <button className="btn" type="button" onClick={() => setAsk('listening')}>Go back to listening only</button>}</div>
            : <div className="sub">Only an admin can change this.</div>}
        </div>}
      </div>

      {d && <div className="card"><h3 style={{ margin: 0 }}>Learn from old conversations</h3>
        <div className="sub" style={{ marginBottom: 8 }}>Have an export of past chats? Add it here and the bot learns from it before it goes live. One row for each message, with the columns <span className="mono">chat_id</span>, <span className="mono">sender</span> (customer or staff), <span className="mono">text</span> and, if you have it, <span className="mono">time</span>. An Excel or CSV file works. Phone and bank numbers, emails and links are hidden when it is saved.</div>
        <div className="tools"><input key={fileKey} type="file" accept=".xlsx,.csv,.tsv,.txt" aria-label="Choose a file of old chats" onChange={(e) => pick(e.target.files?.[0])} />
          <button className="btn sm ghost" type="button" onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([writeXlsx(CHAT_EXAMPLE_ROWS, CHAT_WIDTHS, 'Chats') as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = 'old_chats_example.xlsx'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }}>Download Excel example</button></div>
        {file && (file.r.error ? <div className="note" style={{ background: 'var(--badbg)', marginTop: 8 }}>{file.r.error}</div>
          : <div className="note" role="status" style={{ marginTop: 8 }}><b>{file.name}</b>: {file.r.chats} chat{file.r.chats === 1 ? '' : 's'}, {file.r.customer} customer message{file.r.customer === 1 ? '' : 's'} and {file.r.staff} staff message{file.r.staff === 1 ? '' : 's'}.{file.r.skipped ? ` ${file.r.skipped} row${file.r.skipped === 1 ? ' was' : 's were'} left out (empty, or a sender that is not a customer or staff).` : ''}
            <div className="tools" style={{ marginTop: 8 }}><button className="btn pri" type="button" disabled={importing || !file.r.customer} onClick={() => void runImport()}>{importing ? 'Learning…' : 'Learn from this file'}</button><button className="btn" type="button" disabled={importing} onClick={() => { setFile(null); setFileKey((k) => k + 1); }}>Clear</button></div></div>)}
      </div>}

      {d && <div className="card"><h3 style={{ margin: 0 }}>What customers asked</h3>
        <div className="sub" style={{ marginBottom: 8 }}>Grouped by meaning, most asked first, with the reply staff gave most often. The bot never uses a past reply by itself: you check it and add it to the Knowledge base, and the bot answers only from what is live there. Phone and bank numbers, emails and links are hidden in what is saved.</div>
        {!d.groups.length ? <div className="sub">Nothing saved yet. {listening ? 'Once LiveChat sends customer messages to the bot, they show up here.' : 'Put the merchant in listening mode to collect conversations.'}</div>
          : <div className="scroll"><table className="lrntable"><thead><tr><th className="num">Asked</th><th>What customers wrote</th><th>What staff usually replied</th><th /></tr></thead><tbody>
            {d.groups.map((g) => <tr key={g.key}>
              <td className="num"><b>{g.count}</b>{g.withReply < g.count && <div className="sub">{g.withReply} replied</div>}</td>
              <td><div className="kwchips">{g.customers.map((c) => <span className="kwchip" key={c.text}>{c.text}{c.n > 1 && <small>{c.n}</small>}</span>)}</div>{g.topic && g.kind !== 'covered' && <div className="sub" style={{ marginTop: 4 }}>Topic: {g.topic}</div>}</td>
              <td>{g.replies.length ? <><div className="clamp2">{g.replies[0].text}</div>{g.replies[0].n > 1 && <div className="sub">given {g.replies[0].n} times</div>}</> : <span className="sub">No staff reply seen yet</span>}</td>
              <td className="lrnact">{g.kind === 'covered' ? <span className="ltag ok" title="The knowledge base already answers this">Already answered: {g.intent}</span>
                : added(g) ? <span className="ltag ai">Added as a draft</span>
                : <button className="btn sm pri" type="button" onClick={() => add(g)}>Add to Knowledge base</button>}</td></tr>)}
          </tbody></table></div>}
      </div>}

      {ask && <Modal label="Change what the bot does" small onClose={() => setAsk(null)}>
        <div className="head"><h2>{ask === 'answering' ? 'Start answering?' : 'Go back to listening only?'}</h2></div>
        {ask === 'answering'
          ? <><p style={{ margin: '8px 0' }}>From now on the bot replies to customers in LiveChat, from the live answers in the Knowledge base ({liveCount} now).</p>
            {liveCount < 10 && <div className="note" style={{ background: 'var(--warnbg)' }}>Only {liveCount} live answer{liveCount === 1 ? '' : 's'}. Add and publish the answers you checked first, or the bot will pass most questions to a person.</div>}
            <div className="sub">LiveChat may keep an earlier silent reply for the same words for up to two hours, so a few questions can stay unanswered for a while.</div></>
          : <p style={{ margin: '8px 0' }}>The bot goes silent again and only saves conversations. Staff answer every customer.</p>}
        <div className="tools" style={{ marginTop: 12, justifyContent: 'flex-end' }}><button className="btn" type="button" onClick={() => setAsk(null)}>Cancel</button><button className="btn pri" type="button" disabled={busy} onClick={() => void switchTo(ask)}>{ask === 'answering' ? 'Start answering' : 'Listen only'}</button></div></Modal>}
    </>
  );
}
