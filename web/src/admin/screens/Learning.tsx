import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { usePanel } from '../store';
import { LANGS, addOwnTopic, entryProblems, findDup, slug, type Entry } from '../model';
import { Modal } from '../ui';
import { useT } from '../i18n';
import { parseTable } from '../model';
import { readXlsx, writeXlsx } from '../xlsx';
import { CHAT_EXAMPLE_ROWS, CHAT_WIDTHS } from '../importSamples';

interface Group { key: string; kind: 'covered' | 'topic' | 'text'; label: string; topic: string | null; intent: string | null; count: number; withReply: number; customers: { text: string; n: number }[]; replies: { text: string; n: number }[] }
interface Hint { id: number; text: string; intent: string; hits: number }
interface Learn { mode: 'listening' | 'answering'; since: string | null; days: number | null; pairs: number; chats: number; withReply: number; groups: Group[] }
const MONTH = 30;
const MIN_READY = 10;                                          // the same number as the merchant setup checklist

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
  const p = usePanel(); const nav = useNavigate(); const { t, lang } = useT(); const zh = lang === 'zh'; const [d, setD] = useState<Learn | null>(null); const [err, setErr] = useState(''); const [ask, setAsk] = useState<'listening' | 'answering' | null>(null); const [busy, setBusy] = useState(false);
  const load = () => api<Learn>('/api/admin/learning?merchant=' + encodeURIComponent(p.merchant));
  useEffect(() => { let alive = true; setErr(''); setD(null); load().then((x) => { if (alive) setD(x); }).catch((e: Error) => { if (alive) setErr(e.message); }); return () => { alive = false; }; /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [p.merchant]);

  /** What customers chose: a message the bot could not place alone ("tng") and the answer the customer picked. Approving adds it to that entry as an example question (and a one-word message also as a keyword of its topic). */
  const [hints, setHints] = useState<Hint[]>([]);
  useEffect(() => { let alive = true; setHints([]); api<Hint[]>('/api/admin/learning/choices?merchant=' + encodeURIComponent(p.merchant)).then((x) => { if (alive) setHints(x); }).catch(() => { /* the card just stays hidden */ }); return () => { alive = false; }; }, [p.merchant]);
  const resolveHint = async (h: Hint, action: 'added' | 'dismissed') => {
    try { await api('/api/admin/learning/choices/resolve', { merchant: p.merchant, ids: [h.id], action }); setHints((l) => l.filter((x) => x.id !== h.id)); } catch (e) { p.toast((e as Error).message); }
  };
  const approveHint = async (h: Hint) => {
    const entry = p.draft.kb.find((e) => e.merchant === p.merchant && e.intent_key === h.intent);
    if (!entry) { p.toast(t('That answer is not in the Knowledge base any more.')); return void resolveHint(h, 'dismissed'); }
    const word = /^[\p{L}][\p{L}\p{N}_-]+$/u.test(h.text) && entry.topic && findDup(p.draft, p.merchant, p.M.name, h.text).length === 0 ? h.text.toLowerCase() : '';
    p.edit((dr, note) => {
      const e = dr.kb.find((x) => x.merchant === p.merchant && x.intent_key === h.intent); if (!e) return;
      const tl = e.translations as Record<string, { question_examples: string[]; answer_text: string }>; const en = tl.en ?? { question_examples: [], answer_text: '' };
      if (!en.question_examples.some((x) => x.toLowerCase() === h.text.toLowerCase())) { tl.en = { ...en, question_examples: [...en.question_examples, h.text] }; e.dirty = true; note(`Added example question "${h.text}" to "${h.intent}" (${p.M.name})`); }
      if (word) { addOwnTopic(dr, p.merchant, e.topic, [word]); note(`Added keyword "${word}" to topic "${e.topic}" (${p.M.name})`); }
    });
    await resolveHint(h, 'added');
    p.toast(word ? t('Added “{w}” to “{e}” as an example question and as a keyword. Press Publish to make it live.', { w: h.text, e: h.intent }) : t('Added “{w}” to “{e}” as an example question. Press Publish to make it live.', { w: h.text, e: h.intent }));
  };

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
      setD(await load()); setFile(null); setFileKey((k) => k + 1); p.toast(t('Learned from {chats} old chats: {pairs} questions, {withReply} with a staff reply.', { chats, pairs, withReply }).replace(/ (\d+) old chats/, (m, n) => (n === '1' ? ' 1 old chat' : m)));
    } catch (e) { p.toast((e as Error).message); }
    setImporting(false);
  };
  const mine = p.draft.kb.filter((e) => e.merchant === p.merchant);
  const liveCount = mine.filter((e) => e.status === 'live').length;
  /* the start-answering checklist: the first three must be done, the last one is only a hint */
  const ready = mine.filter((e) => e.status === 'live' && entryProblems(e).length === 0).length;
  const toWrite = mine.filter((e) => Object.values(e.translations as Record<string, { answer_text?: string }>).some((t) => /^\s*TO WRITE:/i.test(t?.answer_text ?? ''))).length;
  const unpublished = p.changes.length;
  const toCheck = (d?.groups ?? []).filter((g) => g.kind !== 'covered' && !(mine.some((e) => e.category === 'Learned' && ((e.translations as Record<string, { question_examples?: string[] }>).en?.question_examples ?? []).includes(g.customers[0]?.text ?? '\u0000')))).length;
  const steps: { key: string; ok: boolean; must: boolean; title: string; detail: string; to?: string }[] = [
    { key: 'ready', ok: ready >= MIN_READY, must: true, title: t('Enough live answers'), detail: t('{n} of {m} ready (live, with example questions). Add the learned answers below, check them and set them live.', { n: ready, m: MIN_READY }), to: '/admin/kb' },
    { key: 'towrite', ok: toWrite === 0, must: true, title: t('No "TO WRITE" left'), detail: toWrite ? t(toWrite === 1 ? '{n} entry still says TO WRITE. Write the real answer or delete it.' : '{n} entries still say TO WRITE. Write the real answer or delete it.', { n: toWrite }) : t('Every answer is written.'), to: '/admin/kb' },
    { key: 'published', ok: unpublished === 0, must: true, title: t('Everything is published'), detail: unpublished ? t(unpublished === 1 ? '{n} change is only in your draft. The bot answers from what is published: press Publish.' : '{n} changes are only in your draft. The bot answers from what is published: press Publish.', { n: unpublished }) : t('Nothing waits in the draft.') },
    { key: 'learned', ok: toCheck === 0, must: false, title: t('Learned questions checked'), detail: toCheck ? t(toCheck === 1 ? '{n} group of questions the bot learned is not in the Knowledge base yet. Only a hint: you may leave some out.' : '{n} groups of questions the bot learned are not in the Knowledge base yet. Only a hint: you may leave some out.', { n: toCheck }) : t('Every learned group is covered or added.') }];
  const unmet = steps.filter((x) => x.must && !x.ok);
  const switchTo = async (mode: 'listening' | 'answering') => {
    setBusy(true);
    try { await api('/api/admin/merchants/' + encodeURIComponent(p.merchant) + '/mode', { mode }); setD(await load()); await p.refreshMerchants(); setAsk(null);
      p.toast(mode === 'answering' ? t('The bot now answers customers in LiveChat.') : t('The bot now only listens. Staff answer customers.')); }
    catch (e) { p.toast((e as Error).message); }
    setBusy(false);
  };
  const added = (g: Group) => mine.some((e) => e.category === 'Learned' && ((e.translations as Record<string, { question_examples?: string[] }>).en?.question_examples ?? []).includes(g.customers[0]?.text ?? '\u0000'));      // an entry made from this group already exists
  const add = (g: Group, answer?: string) => {
    const key = slug(g.topic ? g.label + '_' + (g.customers[0]?.text ?? '') : g.customers[0]?.text ?? g.label).slice(0, 60) || 'learned_entry';
    const unique = (() => { let k = key, i = 2; while (mine.some((e) => e.intent_key === k)) k = key + '_' + i++; return k; })();
    p.edit((dr, note) => {
      const tl: Record<string, { question_examples: string[]; answer_text: string }> = {}; LANGS.forEach((l) => { tl[l] = { question_examples: [], answer_text: '' }; });
      tl.en = { question_examples: g.customers.slice(0, 8).map((c) => c.text), answer_text: answer ?? g.replies[0]?.text ?? '' };
      const ne: Entry = { id: Math.max(0, ...dr.kb.map((x) => x.id)) + 1, merchant: p.merchant, category: 'Learned', intent_key: unique, topic: g.topic || '', aspect: null, topic_optional: false, translations: tl as Entry['translations'], status: 'draft', dirty: true, updated: 'just now' };
      dr.kb.push(ne); note(`Added "${unique}" from what the bot learned (${p.M.name})`);
    });
    p.toast(t('Added “{key}” to the Knowledge base as a draft. Check the answer, set it live, then press Publish.', { key: unique }));
  };

  /** The AI writes one clean answer from the staff replies of a group. It opens in a window where a person reads and edits it before it is added as a draft entry. */
  const [drafting, setDrafting] = useState(''); const [draft, setDraft] = useState<{ g: Group; text: string } | null>(null);
  const makeDraft = async (g: Group) => {
    setDrafting(g.key);
    try { const r = await api<{ answer: string }>('/api/admin/learning/draft-answer', { merchant: p.merchant, questions: g.customers.map((c) => c.text), replies: g.replies.map((x) => x.text) }); setDraft({ g, text: r.answer }); }
    catch (e) { p.toast((e as Error).message); }
    setDrafting('');
  };
  const listening = d?.mode === 'listening';
  const day = d?.days ?? 0;
  return (
    <>
      <div className="card"><div className="head"><div><h2>{t('Learning')} · {p.M.name}</h2><div className="sub">{t('When a merchant is first put in LiveChat, the bot can only listen: it stays silent, staff answer as usual, and the bot saves each question with the staff reply. Then you check what it learned and switch it to answering.')}</div></div></div>
        {err && <div className="note" style={{ background: 'var(--badbg)' }}>{err}</div>}
        {d && <div className="lrn">
          <div className="lrnstat">
            <span className={'vchip ' + (listening ? 'warn' : '')}><i />{listening ? t('Listening: the bot is silent') : t('Answering: the bot replies to customers')}</span>
            {listening && d.since && <div className="lrnprog" role="progressbar" aria-label={t('Days listening')} aria-valuenow={Math.min(day, MONTH)} aria-valuemax={MONTH}><i style={{ width: Math.min(100, Math.round((day / MONTH) * 100)) + '%' }} /></div>}
            {listening && d.since && <span className="sub">{t('Day {n} of about {m}.', { n: day + 1, m: MONTH })} {day >= MONTH ? t('A month has passed: you can start answering when you are ready.') : ''}</span>}
          </div>
          <div className="lrntiles">
            <div className="lrntile"><b>{d.chats}</b><span>{t('chats seen')}</span></div>
            <div className="lrntile"><b>{d.pairs}</b><span>{t('questions saved')}</span></div>
            <div className="lrntile"><b>{d.withReply}</b><span>{t('with a staff reply')}</span></div>
            <div className="lrntile"><b>{liveCount}</b><span>{t('live answers in the Knowledge base')}</span></div>
          </div>
          {p.isAdmin
            ? <div className="tools">{listening
              ? <><button className="btn pri" type="button" disabled={unmet.length > 0} title={unmet.length ? t('Finish the checklist first: {list}', { list: unmet.map((x) => x.title).join(', ') }) : undefined} onClick={() => setAsk('answering')}>{t('Start answering')}</button>
                {unmet.length > 0 && <button className="btn ghost" type="button" onClick={() => setAsk('answering')}>{t('Start anyway')}</button>}</>
              : <button className="btn" type="button" onClick={() => setAsk('listening')}>{t('Go back to listening only')}</button>}</div>
            : <div className="sub">{t('Only an admin can change this.')}</div>}
        </div>}
      </div>

      {d && listening && <div className="card" aria-label="Before the bot starts answering"><h3 style={{ margin: 0 }}>{t('Before the bot starts answering')}</h3>
        <div className="sub" style={{ marginBottom: 8 }}>{unmet.length ? t('Three things must be done first. The Start answering button turns on when they are.') : t('Ready. You can start answering.')}</div>
        <ul className="checklist">{steps.map((x) => <li key={x.key} className={'chk ' + (x.ok ? 'done' : x.must ? 'todo' : 'optional')}>
          <span className={'cdot ' + (x.ok ? 'done' : x.must ? 'todo' : 'optional')} aria-hidden="true">{x.ok ? '✓' : x.must ? '' : '–'}</span>
          <div className="cbody"><b>{x.title}{!x.must && <span className="sub"> {t('(optional)')}</span>}</b><div className="sub">{x.detail}</div></div>
          {!x.ok && x.to && <button className="btn sm" type="button" onClick={() => nav(x.to!)}>{t('Open Knowledge base')}</button>}</li>)}</ul></div>}

      {d && <div className="card"><h3 style={{ margin: 0 }}>{t('Learn from old conversations')}</h3>
        <div className="sub" style={{ marginBottom: 8 }}>{zh ? <>有过去聊天的导出文件吗？在这里添加，机器人会在上线前先从中学习。每条消息一行，列名为 <span className="mono">chat_id</span>、<span className="mono">sender</span>（customer 或 staff）、<span className="mono">text</span>，如果有的话还有 <span className="mono">time</span>。Excel 或 CSV 文件都可以。保存时，电话和银行号码、电子邮件和链接会被隐藏。</> : <>Have an export of past chats? Add it here and the bot learns from it before it goes live. One row for each message, with the columns <span className="mono">chat_id</span>, <span className="mono">sender</span> (customer or staff), <span className="mono">text</span> and, if you have it, <span className="mono">time</span>. An Excel or CSV file works. Phone and bank numbers, emails and links are hidden when it is saved.</>}</div>
        <div className="tools"><input key={fileKey} type="file" accept=".xlsx,.csv,.tsv,.txt" aria-label={t('Choose a file of old chats')} onChange={(e) => pick(e.target.files?.[0])} />
          <button className="btn sm ghost" type="button" onClick={() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([writeXlsx(CHAT_EXAMPLE_ROWS, CHAT_WIDTHS, 'Chats') as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })); a.download = 'old_chats_example.xlsx'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }}>{t('Download Excel example')}</button></div>
        {file && (file.r.error ? <div className="note" style={{ background: 'var(--badbg)', marginTop: 8 }}>{file.r.error}</div>
          : <div className="note" role="status" style={{ marginTop: 8 }}><b>{file.name}</b>: {t('{chats} chats, {c} customer messages and {s} staff messages.', { chats: file.r.chats, c: file.r.customer, s: file.r.staff }).replace(/^1 chats/, '1 chat').replace(/ 1 customer messages/, ' 1 customer message').replace(/ 1 staff messages/, ' 1 staff message')}{file.r.skipped ? ' ' + t(file.r.skipped === 1 ? '{n} row was left out (empty, or a sender that is not a customer or staff).' : '{n} rows were left out (empty, or a sender that is not a customer or staff).', { n: file.r.skipped }) : ''}
            <div className="tools" style={{ marginTop: 8 }}><button className="btn pri" type="button" disabled={importing || !file.r.customer} onClick={() => void runImport()}>{importing ? t('Learning…') : t('Learn from this file')}</button><button className="btn" type="button" disabled={importing} onClick={() => { setFile(null); setFileKey((k) => k + 1); }}>{t('Clear')}</button></div></div>)}
      </div>}

      {hints.length > 0 && <div className="card"><h3 style={{ margin: 0 }}>{t('Learned from what customers chose')}</h3>
        <div className="sub" style={{ marginBottom: 8 }}>{t('When the bot was not sure what a message meant, it showed choices, and the customer picked one. Approve to add the message to that answer as an example question, so next time the bot answers straight away. Nothing is added until you press Approve.')}</div>
        <div className="scroll"><table className="lrntable"><thead><tr><th>{t('What the customer wrote')}</th><th>{t('The answer they chose')}</th><th className="num">{t('Times')}</th><th /></tr></thead><tbody>
          {hints.map((h) => { const e = p.draft.kb.find((x) => x.merchant === p.merchant && x.intent_key === h.intent); const a = (e?.translations as Record<string, { answer_text?: string }> | undefined)?.en?.answer_text ?? '';
            return <tr key={h.id}><td><span className="kwchip">{h.text}</span></td><td><b>{h.intent}</b>{a && <div className="clamp2 sub">{a}</div>}</td><td className="num">{h.hits}</td>
              <td className="lrnact"><div className="lrnbtns"><button className="btn sm pri" type="button" onClick={() => void approveHint(h)}>{t('Approve')}</button><button className="btn sm" type="button" onClick={() => void resolveHint(h, 'dismissed')}>{t('Dismiss')}</button></div></td></tr>; })}
        </tbody></table></div></div>}

      {d && <div className="card"><h3 style={{ margin: 0 }}>{t('What customers asked')}</h3>
        <div className="sub" style={{ marginBottom: 8 }}>{t('Grouped by meaning, most asked first, with the reply staff gave most often. The bot never uses a past reply by itself: you check it and add it to the Knowledge base, and the bot answers only from what is live there. Phone and bank numbers, emails and links are hidden in what is saved.')}</div>
        {!d.groups.length ? <div className="sub">{t('Nothing saved yet.')} {listening ? t('Once LiveChat sends customer messages to the bot, they show up here.') : t('Put the merchant in listening mode to collect conversations.')}</div>
          : <div className="scroll"><table className="lrntable"><thead><tr><th className="num">{t('Asked')}</th><th>{t('What customers wrote')}</th><th>{t('What staff usually replied')}</th><th /></tr></thead><tbody>
            {d.groups.map((g) => <tr key={g.key}>
              <td className="num"><b>{g.count}</b>{g.withReply < g.count && <div className="sub">{t('{n} replied', { n: g.withReply })}</div>}</td>
              <td><div className="kwchips">{g.customers.map((c) => <span className="kwchip" key={c.text}>{c.text}{c.n > 1 && <small>{c.n}</small>}</span>)}</div>{g.topic && g.kind !== 'covered' && <div className="sub" style={{ marginTop: 4 }}>{t('Topic:')} {g.topic}</div>}</td>
              <td>{g.replies.length ? <><div className="clamp2">{g.replies[0].text}</div>{g.replies[0].n > 1 && <div className="sub">{t('given {n} times', { n: g.replies[0].n })}</div>}</> : <span className="sub">{t('No staff reply seen yet')}</span>}</td>
              <td className="lrnact">{g.kind === 'covered' ? <span className="ltag ok" title={t('The knowledge base already answers this')}>{t('Already answered:')} {g.intent}</span>
                : added(g) ? <span className="ltag ai">{t('Added as a draft')}</span>
                : <div className="lrnbtns"><button className="btn sm pri" type="button" onClick={() => add(g)}>{t('Add to Knowledge base')}</button>
                  {p.ai.draft && g.replies.length > 0 && <button className="btn sm" type="button" disabled={drafting === g.key} title={t('The AI writes one clean answer from what staff replied. You read and edit it before it is added.')} onClick={() => void makeDraft(g)}>{drafting === g.key ? t('Thinking…') : t('Draft answer with AI')}</button>}</div>}</td></tr>)}
          </tbody></table></div>}
      </div>}

      {draft && <Modal label={t('AI draft answer')} wide onClose={() => setDraft(null)}>
        <div className="head"><h2>{t('AI draft answer')}</h2><button className="btn sm" type="button" onClick={() => setDraft(null)}>{t('Close')}</button></div>
        <div className="sub">{t('What customers wrote')}: {draft.g.customers.slice(0, 4).map((c) => '“' + c.text + '”').join(' · ')}</div>
        <div className="note"><b>{t('What staff replied')}</b><ul className="plain">{draft.g.replies.slice(0, 4).map((x, i) => <li key={i}>{x.text}{x.n > 1 ? ' ' + t('(given {n} times)', { n: x.n }) : ''}</li>)}</ul></div>
        <label className="fld"><span>{t('Draft answer (edit it as you like)')}</span><textarea aria-label={t('Draft answer')} rows={5} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} /></label>
        <div className="sub">{t('The AI used only what the staff replies say and may not add a number or link that they do not have. Still, read every fact. It is added as a draft: you set it live and publish.')}</div>
        <div className="tools" style={{ marginTop: 12, justifyContent: 'flex-end' }}><button className="btn" type="button" onClick={() => setDraft(null)}>{t('Cancel')}</button><button className="btn pri" type="button" disabled={!draft.text.trim()} onClick={() => { add(draft.g, draft.text.trim()); setDraft(null); }}>{t('Add to Knowledge base')}</button></div></Modal>}

      {ask && <Modal label="Change what the bot does" small onClose={() => setAsk(null)}>
        <div className="head"><h2>{ask === 'answering' ? t('Start answering?') : t('Go back to listening only?')}</h2></div>
        {ask === 'answering'
          ? <><p style={{ margin: '8px 0' }}>{t('From now on the bot replies to customers in LiveChat, from the live answers in the Knowledge base ({n} now).', { n: liveCount })}</p>
            {unmet.length > 0 && <div className="note" style={{ background: 'var(--warnbg)' }}><b>{t('Not ready yet:')}</b><ul className="plain">{unmet.map((x) => <li key={x.key}>{x.title}: {x.detail}</li>)}</ul>{t('The bot will pass many questions to a person until this is done.')}</div>}
            <div className="sub">{t('LiveChat may keep an earlier silent reply for the same words for up to two hours, so a few questions can stay unanswered for a while.')}</div></>
          : <p style={{ margin: '8px 0' }}>{t('The bot goes silent again and only saves conversations. Staff answer every customer.')}</p>}
        <div className="tools" style={{ marginTop: 12, justifyContent: 'flex-end' }}><button className="btn" type="button" onClick={() => setAsk(null)}>{t('Cancel')}</button><button className="btn pri" type="button" disabled={busy} onClick={() => void switchTo(ask)}>{ask === 'answering' ? t('Start answering') : t('Listen only')}</button></div></Modal>}
    </>
  );
}
