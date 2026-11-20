import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePanel } from '../store';
import { api } from '../../lib/api';
import ImportGrid from './ImportGrid';
import { readXlsx, rowsToCsv, writeXlsx } from '../xlsx';
import { BLANK_ROWS, EXAMPLE_ROWS, WIDTHS } from '../importSamples';
import { TO_WRITE, STARTER_ENTRIES, STARTER_TAGS, STARTER_TOPICS_NEW, COVERED_ELSEWHERE, starterCsv, luckypayCsv, LUCKYPAY_ENTRIES } from '../starterPack';
import { LANGS, LN, SAMPLE_CSV, TPL_HEAD, analyzeImport, addOwnTopic, topicNames, kbToCSV, parseTable, type Entry, type ImportGroup } from '../model';
import { Pill } from '../ui';
import { useT } from '../i18n';

type Tr = { question_examples: string[]; answer_text: string };

const saveFile = (name: string, bytes: Uint8Array | string, type: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes as BlobPart], { type })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); };
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
type TF = (s: string, v?: Record<string, string | number>) => string;
/** A check message from analyzeImport(), in the panel language. The ones with a name or a number are matched and written out again. */
const tIssue = (T: TF, x: string): string => {
  let m: RegExpMatchArray | null;
  if ((m = x.match(/^(\w+) is missing$/))) return T('{l} is missing', { l: m[1] });
  if ((m = x.match(/^(\w+): answer is empty$/))) return T('{l}: answer is empty', { l: m[1] });
  if ((m = x.match(/^(\w+): (\d+) example questions? \(3 or more is better\)$/))) return T(m[2] === '1' ? '{l}: 1 example question (3 or more is better)' : '{l}: {n} example questions (3 or more is better)', { l: m[1], n: m[2] });
  if ((m = x.match(/^New topic word "(.*)" will be created with (\d+) short forms?$/))) return T(m[2] === '1' ? 'New topic word "{k}" will be created with 1 short form' : 'New topic word "{k}" will be created with {n} short forms', { k: m[1], n: m[2] });
  if ((m = x.match(/^New topic word "(.*)" will be created\. Add short forms in Keywords\.$/))) return T('New topic word "{k}" will be created. Add short forms in Keywords.', { k: m[1] });
  if ((m = x.match(/^Unknown question type "(.*)"$/))) return T('Unknown question type "{k}"', { k: m[1] });
  if ((m = x.match(/^(\d+) duplicate rows? for the same language/))) return T(m[1] === '1' ? '1 duplicate row for the same language (the last one is used)' : '{n} duplicate rows for the same language (the last one is used)', { n: m[1] });
  if ((m = x.match(/^Name changed to "(.*)" \(/))) return T('Name changed to "{k}" (lowercase letters and underscores)', { k: m[1] });
  if ((m = x.match(/^Row (\d+): entry name is empty$/))) return T('Row {n}: entry name is empty', { n: m[1] });
  if ((m = x.match(/^Row (\d+): unknown language "(.*)" \(use /))) return T('Row {n}: unknown language "{k}" (use en, ms, zh, vi, th or tl)', { n: m[1], k: m[2] });
  if ((m = x.match(/^Missing column: (.*)\. Found: (.*)$/))) return T('Missing column: {a}. Found: {b}', { a: m[1], b: m[2] });
  return T(x);
};
const LANG_NAME: Record<string, string> = { ms: 'Malay', zh: 'Chinese', vi: 'Vietnamese', th: 'Thai', tl: 'Filipino' };

export default function Import() {
  const p = usePanel(); const nav = useNavigate(); const { t: T, lang } = useT(); const zh = lang === 'zh';
  const [text, setText] = useState(''); const [name, setName] = useState(''); const [mode, setMode] = useState('update'); const [status, setStatus] = useState<'draft' | 'live'>('draft'); const [out, setOut] = useState('');
  const [menu, setMenu] = useState<'' | 'packs' | 'more'>('');
  const [view, setView] = useState<'table' | 'file'>('table'); const [tick, setTick] = useState(0);
  const [trOn, setTrOn] = useState(true); const [trLangs, setTrLangs] = useState<Set<string>>(new Set(['ms', 'zh'])); const [busy, setBusy] = useState('');
  const R = useMemo(() => analyzeImport(text, p.draft, p.merchant, p.M.name), [text, p.draft, p.merchant, p.M.name]);
  const ok = R.entries.filter((g) => !g.errors.length);
  const nNew = ok.filter((g) => !g.exists).length, nUpd = ok.filter((g) => g.exists).length, nErr = R.entries.length - ok.length;
  const willImport = ok.filter((g) => !(g.exists && mode === 'skip')).length;
  const mine = p.draft.kb.filter((e) => e.merchant === p.merchant);

  const copy = (txt: string, done: string) => { try { navigator.clipboard.writeText(txt).then(() => p.toast(T(done)), () => setOut(txt)); } catch { setOut(txt); } };

  /** The translations the AI would make: only for languages left empty, from the English answer. Placeholders that still say TO WRITE are not translated. */
  const jobs = useMemo(() => (!trOn || !p.ai.translate ? [] : ok.filter((g) => !(g.exists && mode === 'skip')).flatMap((g) => {
    const ex = g.existing?.translations as Record<string, Tr> | undefined;
    const en = g.langs.en?.answer || ex?.en?.answer_text || ''; if (!en.trim() || en.includes(TO_WRITE)) return [];
    const exs = g.langs.en?.examples ?? ex?.en?.question_examples ?? [];
    return [...trLangs].filter((l) => !g.langs[l]?.answer && !ex?.[l]?.answer_text?.trim()).map((l) => ({ key: g.key, lang: l, answer: en, examples: exs }));
  })), [ok, mode, trOn, trLangs, p.ai.translate]);

  const issuesOf = (g: ImportGroup) => g.issues.filter((x) => !jobs.some((j) => j.key === g.key && x === LN[j.lang] + ' is missing'));   // a language the AI will fill is not a problem
  const nWarn = ok.filter((g) => issuesOf(g).length).length;

  /** Which languages an entry gets: the ones written in the file, the ones the AI will fill, and the ones it already has. */
  const tags = (g: ImportGroup) => {
    const out = LANGS.flatMap((l) => {
      const x = g.langs[l];
      if (x?.answer) return [<span key={l} className={'ltag ok'} title={x.examples.length < 3 ? T('Fewer than 3 example questions') : undefined}>{LN[l]} {T('written')}{x.examples.length < 3 ? ' *' : ''}</span>];
      if (jobs.some((j) => j.key === g.key && j.lang === l)) return [<span key={l} className="ltag ai">{LN[l]} {T('by AI')}</span>];
      return [];
    });
    return out.length ? out : <span className="sub">{T('none')}</span>;
  };

  /** Asks the AI for each missing translation, three at a time. A failed one is only counted: the entry stays as it was. */
  const translateAll = async () => {
    const got: { key: string; lang: string; answer: string; examples: string[] }[] = []; let failed = 0, why = '', next = 0, done = 0;
    setBusy(T('Translating {a} of {b}…', { a: 0, b: jobs.length }));
    const worker = async () => {
      while (next < jobs.length) {
        const j = jobs[next++];
        try { const r = await api<{ answer: string; examples: string[] }>('/api/admin/translate', { merchant: p.merchant, from: 'en', to: j.lang, answer: j.answer, examples: j.examples, style: p.draft.settings[p.merchant]?.ai_instructions ?? '' }); got.push({ ...j, answer: r.answer, examples: r.examples }); }
        catch (e) { failed++; why = why || (e as Error).message; }
        setBusy(T('Translating {a} of {b}…', { a: ++done, b: jobs.length }));
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    if (got.length) p.edit((d, note) => {
      got.forEach((r) => {
        const e = d.kb.find((x) => x.merchant === p.merchant && x.intent_key === r.key); if (!e) return;
        const t = e.translations as Record<string, Tr>; const cur = t[r.lang]; if (cur?.answer_text?.trim()) return;
        const have = new Set((cur?.question_examples ?? []).map((q) => q.toLowerCase()));
        t[r.lang] = { answer_text: r.answer, question_examples: [...(cur?.question_examples ?? []), ...r.examples.filter((q) => !have.has(q.toLowerCase()))] }; e.dirty = true;
      });
      note('AI translated ' + got.length + ' answer' + (got.length === 1 ? '' : 's') + ' (' + [...new Set(got.map((g) => LANG_NAME[g.lang]))].join(', ') + ') for ' + p.M.name + '. Check the wording before publishing');
    });
    setBusy('');
    return { made: got.length, failed, why };
  };

  const run = async (publishAfter = false) => {
    const st: 'draft' | 'live' = publishAfter ? 'live' : status;                       // "Import and publish" makes every new entry live
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
          if (g.topic) e.topic = g.topic; if (g.aspect) e.aspect = g.aspect; if (g.optional) e.topic_optional = true; if (g.entryType) e.entry_type = g.entryType; e.dirty = true; nu++;
        } else {
          const tl: Record<string, Tr> = {}; LANGS.forEach((l) => { tl[l] = tr(l) || { question_examples: [], answer_text: '' }; });
          const ne: Entry = { id: Math.max(0, ...d.kb.map((x) => x.id)) + 1, merchant: p.merchant, category: 'Imported', intent_key: g.key, topic: g.topic || '', aspect: g.aspect || null, topic_optional: g.optional, translations: tl, status: st, ...(g.entryType && g.entryType !== 'answer' ? { entry_type: g.entryType } : {}), dirty: true, updated: 'just now' };
          d.kb.push(ne); nn++;
        }
      });
      note('Imported ' + (nn + nu) + ' entries from ' + (name || 'pasted text') + ' (' + nn + ' new, ' + nu + ' updated) for ' + p.M.name);
    });
    let extra = '';
    if (jobs.length) { const r = await translateAll(); extra = r.made ? ' ' + T(r.made === 1 ? 'The AI translated 1 answer: please check the wording.' : 'The AI translated {n} answers: please check the wording.', { n: r.made }) : ''; if (r.failed) extra += ' ' + T(r.failed === 1 ? '1 translation failed ({w}). Open the entry and use Translate.' : '{n} translations failed ({w}). Open the entry and use Translate.', { n: r.failed, w: r.why }); }
    p.toast(publishAfter ? T('Imported {n} entries. Check the window and press Publish.', { n: nn + nu }) + extra : T('Imported {n} entries to draft.', { n: nn + nu }) + extra); nav('/admin/kb', publishAfter ? { state: { publish: true } } : undefined);
  };

  return (
    <div className="card"><div className="head"><div><h2>{T('Import')} · {p.M.name}</h2><div className="sub">{T('Add many answers at one time. Nothing goes live until you publish.')}</div></div><button className="linkbtn" type="button" onClick={() => nav('/admin/guide')}>{T('How to import →')}</button></div>
      {p.ai.translate && <div className="imptip" role="note"><span aria-hidden="true">🌐</span><span><b>{T('Write in one language only')}</b> {T('(English is fine). The AI translates the other languages for you.')}</span></div>}
      <div className="steps" style={{ marginTop: 12 }}>
        <div className="step"><span className="n">1</span><div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}><b>{T('Add your entries')}</b>
          <div className="improw"><div className="imptabs" role="group" aria-label={T('How to add entries')}><button type="button" aria-pressed={view === 'table'} onClick={() => { if (view !== 'table') { setView('table'); setTick((t) => t + 1); } }}>{T('Type in a table')}</button><button type="button" aria-pressed={view === 'file'} onClick={() => setView('file')}>{T('Upload a file')}</button></div>
          <div className="imptools"><button className="btn sm ghost dl" type="button" onClick={() => saveFile('knowledge_base_example.xlsx', writeXlsx(EXAMPLE_ROWS, WIDTHS, 'Knowledge base'), XLSX)}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>{T('Download Excel example')}</button><button className="btn sm ghost dl" type="button" onClick={() => saveFile('knowledge_base_blank.xlsx', writeXlsx(BLANK_ROWS, WIDTHS, 'Knowledge base'), XLSX)}><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>{T('Download blank Excel')}</button></div></div>
          {view === 'table' ? <ImportGrid key={tick} start={text} onCsv={(c) => { setText(c); setName(c ? 'table' : ''); setOut(''); }} /> : <>
          <div className="drop"><div className="tools">
            <input type="file" accept=".xlsx,.csv,.tsv,.txt" aria-label={T('Choose an Excel or CSV file')} onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; setOut('');
              if (/\.xlsx$/i.test(f.name)) { const fr = new FileReader(); fr.onload = () => { try { setText(rowsToCsv(readXlsx(new Uint8Array(fr.result as ArrayBuffer)))); setName(f.name); } catch (er) { p.toast((er as Error).message); } }; fr.readAsArrayBuffer(f); }
              else { const fr = new FileReader(); fr.onload = () => { setText(String(fr.result)); setName(f.name); }; fr.readAsText(f, 'utf-8'); } }} />
            <span className="pmenu"><button className="btn sm" type="button" aria-haspopup="menu" aria-expanded={menu === 'packs'} onClick={() => setMenu(menu === 'packs' ? '' : 'packs')}>{T('Starter packs')} ▾</button>
              {menu === 'packs' && <div className="pmenu-list" role="menu">
                <button role="menuitem" type="button" title={T("Entries for the categories of the team's LiveChat FAQ list. Every answer says TO WRITE until you write it.")} onClick={() => { setText(starterCsv()); setName('faq_category_starter.csv'); setOut(''); setMenu(''); }}>{T('FAQ category starter')} ({STARTER_ENTRIES})</button>
                {p.M.name.toLowerCase() === 'luckypay' && <button role="menuitem" type="button" title={T('The seven named promotions and VIP. Only LuckyPay has them. Every answer says TO WRITE until you write it.')} onClick={() => { setText(luckypayCsv()); setName('luckypay_promotions.csv'); setOut(''); setMenu(''); }}>{T('LuckyPay promotions')} ({LUCKYPAY_ENTRIES})</button>}</div>}</span>
            <span className="pmenu"><button className="btn sm" type="button" aria-haspopup="menu" aria-expanded={menu === 'more'} onClick={() => setMenu(menu === 'more' ? '' : 'more')}>{T('More')} ▾</button>
              {menu === 'more' && <div className="pmenu-list" role="menu">
                <button role="menuitem" type="button" onClick={() => { setText(SAMPLE_CSV); setName('sample_' + p.merchant.toLowerCase() + '.csv'); setOut(''); setMenu(''); }}>{T('Load a sample file')}</button>
                <button role="menuitem" type="button" onClick={() => { copy(TPL_HEAD, 'Template copied'); setMenu(''); }}>{T('Copy blank template')}</button>
                <button role="menuitem" type="button" onClick={() => { copy(kbToCSV(mine), 'KB copied as CSV'); setMenu(''); }}>{T("Copy this merchant's KB as CSV")}</button>
                <button role="menuitem" type="button" onClick={() => { saveFile('knowledge_base_' + p.merchant.toLowerCase() + '.xlsx', writeXlsx(parseTable(kbToCSV(mine)), WIDTHS, 'Knowledge base'), XLSX); setMenu(''); }}>{T("Download this merchant's KB as Excel")}</button></div>}</span></div>
            <details className="fold" aria-label={T('About the FAQ category starter')}><summary>{T('What is in the FAQ category starter?')}</summary>
              <div className="sub" style={{ margin: '6px 0' }}>{zh ? <>{STARTER_ENTRIES} 个英文和马来文条目，根据团队的 LiveChat FAQ 分类列表制作。它们以<b>草稿</b>导入（在你启用之前机器人会忽略），每个答案都写着 <b>TO WRITE</b>：在你换成真正的答案之前，面板会一直标出。应由真人回答的条目（投诉、被封账户、未到账、免费额度请求）标为<b>需要员工</b>：匹配时机器人会把聊天转给真人。新建的 Topic：{STARTER_TOPICS_NEW.join(', ')}。</> : <>{STARTER_ENTRIES} entries in English and Malay, made from the team's LiveChat FAQ category list. They come in as <b>drafts</b> (the bot ignores them until you set them live), and every answer says <b>TO WRITE</b>: the panel flags it until you replace it with the real answer. Entries a person should answer (complaints, blocked accounts, missing credit, free-credit requests) are marked <b>needs staff</b>: the bot hands the chat over when one matches. New topics made: {STARTER_TOPICS_NEW.join(', ')}.</>}</div>
              <table className="tight"><thead><tr><th>{T('Entry')}</th><th>{T('Category tag in the list')}</th></tr></thead><tbody>{Object.entries(STARTER_TAGS).map(([k, t]) => <tr key={k}><td className="mono">{k}</td><td>{t}</td></tr>)}</tbody></table>
              <div className="sub" style={{ margin: '8px 0 2px' }}><b>{T('Not added, because the bot already covers them:')}</b></div>
              <ul className="plain">{COVERED_ELSEWHERE.map(([t, w]) => <li key={t}><b>{t}</b>: {w}</li>)}</ul></details>
            <textarea placeholder={T('Or paste CSV here (from Excel or Google Sheets works too)')} aria-label={T('Paste CSV')} value={text} onChange={(e) => { setText(e.target.value); if (!e.target.value) setName(''); setOut(''); }} />
            {name && <div className="sub">{T('Loaded:')} <b>{name}</b> <button className="btn sm" type="button" onClick={() => { setText(''); setName(''); }}>{T('Clear')}</button></div>}</div>
          <details><summary>{T('File format')}</summary><div className="sub" style={{ marginTop: 6 }}>{zh ? <>文件会导入到 <b>{p.M.name}</b>。如果有 <span className="mono">merchant</span> 列，其他商户的行会被跳过。每个条目的每种语言一行。同一条目的每个语言行使用相同的 <span className="mono">intent_key</span>。示例问题用 <span className="mono">|</span> 分隔。</> : <>The file is imported into <b>{p.M.name}</b>. If it has a <span className="mono">merchant</span> column, rows for other merchants are skipped. One row for each entry and language. Use the same <span className="mono">intent_key</span> on every language row of an entry. Separate example questions with <span className="mono">|</span>.</>}</div>
            <div className="scroll"><table><thead><tr><th>{T('Column')}</th><th>{T('Needed?')}</th><th>{T('Example')}</th></tr></thead><tbody>
              <tr><td className="mono">intent_key</td><td>{T('yes')}</td><td>deposit_time</td></tr><tr><td className="mono">language</td><td>{T('yes')}</td><td>{T('en, ms or zh')}</td></tr><tr><td className="mono">answer_text</td><td>{T('yes (English at least)')}</td><td>{T('Deposits are usually credited within 5 minutes.')}</td></tr>
              <tr><td className="mono">question_examples</td><td>{T('recommended')}</td><td>how long deposit take | dep not arrive | depo pending</td></tr><tr><td className="mono">topic</td><td><b>{T('yes')}</b></td><td>{T('deposit, refund. A new one is created automatically.')}</td></tr><tr><td className="mono">topic_short_forms</td><td>{T('optional')}</td><td>refunds | bayaran balik | 退款</td></tr>
              {p.adv && <tr><td className="mono">question_type</td><td>{T('optional')}</td><td>time, limit, how, change, hours</td></tr>}<tr><td className="mono">merchant</td><td>{T('optional')}</td><td>MERCH_A or LuckyPay</td></tr></tbody></table></div>
            <div className="sub" style={{ marginTop: 6 }}>{T('Files made by this tool\'s "Copy KB as CSV" import back with no changes.')}</div></details>
          {out && <div><div className="sub">{T('Copying was blocked here, so the text is shown. Select it and copy:')}</div><textarea readOnly style={{ minHeight: 120, fontFamily: 'var(--mono)', fontSize: 12, whiteSpace: 'pre' }} value={out} /></div>}
          </>}
        </div></div>
        <div className="step"><span className="n">2</span><div style={{ flex: 1, minWidth: 0 }}><b>{T('Check')}</b>
          {R.fatal ? <div className="note" style={{ background: 'var(--badbg)', marginTop: 6 }}>{tIssue(T, R.fatal)}</div>
            : !R.entries.length ? <div className="sub">{T('Add a file or paste text to see the check.')}</div>
            : <>
              <div className="stats" style={{ margin: '6px 0' }}><div className="stat"><b>{nNew}</b>{T('new')}</div><div className="stat"><b>{nUpd}</b>{T('update an existing entry')}</div><div className="stat"><b>{nWarn}</b>{T('with warnings')}</div><div className="stat"><b>{nErr}</b>{T('blocked')}</div>{R.skippedRows ? <div className="stat"><b>{R.skippedRows}</b>{T('rows for other merchants skipped')}</div> : null}</div>
              <div className="scroll"><table><thead><tr><th>{T('Entry')}</th><th>{T('Action')}</th><th>{T('Topic')} · {T('question')}</th><th>{T('Languages')}</th><th>{T('Check')}</th></tr></thead><tbody>
                {R.entries.map((g, i) => {
                  const blocked = g.errors.length; const topic = g.topic || g.existing?.topic || '', asp = g.aspect || g.existing?.aspect || '';
                  return (
                    <tr key={i}><td><b>{g.key || T('(no name)')}</b></td>
                      <td>{blocked ? <Pill c="bad">{T('blocked')}</Pill> : g.exists ? (mode === 'skip' ? <Pill>{T('skipped')}</Pill> : <Pill c="info">{T('update')}</Pill>) : <Pill c="ok">{T('new')}</Pill>}</td>
                      <td>{topic ? <Pill c="info">{topic}</Pill> : <span className="sub">{T('none')}</span>} {asp ? <Pill>{asp}</Pill> : null}</td>
                      <td><div className="ltags">{tags(g)}</div></td>
                      <td>{blocked ? <ul className="iss" style={{ color: 'var(--bad)' }}>{g.errors.map((x, j) => <li key={j}>{tIssue(T, x)}</li>)}</ul> : null}
                        {issuesOf(g).length ? <ul className="iss" style={{ color: 'var(--warn)' }}>{issuesOf(g).map((x, j) => <li key={j}>{tIssue(T, x)}</li>)}</ul> : !blocked ? <Pill c="ok">{T('looks good')}</Pill> : null}</td></tr>
                  );
                })}</tbody></table></div></>}
        </div></div>
        <div className="step"><span className="n">3</span><div style={{ flex: 1, minWidth: 0 }}><b>{T('Import')}</b>
          {busy && <div className="note" role="status" style={{ marginTop: 6 }}>{busy}</div>}
          {p.ai.translate ? <div className="trbox">
            <label className="trsw"><input type="checkbox" role="switch" checked={trOn} onChange={(e) => setTrOn(e.target.checked)} /><span className="track" aria-hidden="true" /><span><b>{T('Translate the empty languages with AI')}</b><small>{T('Only the languages you left empty are filled. You can read them before you publish.')}</small></span></label>
            {trOn && <div className="chips" role="group" aria-label={T('Translate into')}><span className="l">{T('Translate into')}</span>{(['ms', 'zh', 'vi', 'th', 'tl'] as const).map((l) => <button key={l} type="button" className={'chip' + (trLangs.has(l) ? ' on' : '')} aria-pressed={trLangs.has(l)} onClick={() => setTrLangs((x) => { const n = new Set(x); if (n.has(l)) n.delete(l); else n.add(l); return n; })}>{T(LANG_NAME[l])}</button>)}</div>}
            {trOn && <div className="sub">{jobs.length ? <><b>{jobs.length}</b> {T(jobs.length === 1 ? 'translation will be made from the English answers and questions. The AI is charged to this merchant.' : 'translations will be made from the English answers and questions. The AI is charged to this merchant.')}</> : T('Nothing to translate: every chosen language already has an answer, or there is no English answer.')}</div>}
          </div> : <div className="sub" style={{ marginTop: 6 }}>{T('AI translation is off (no AI key yet), so only the languages you wrote are imported. You can translate later inside each entry.')}</div>}
          <div className="tools" style={{ marginTop: 12 }}><button className="btn pri" type="button" disabled={!willImport || !!busy} onClick={() => run(false)}>{T(willImport === 1 ? 'Import 1 entry to draft' : 'Import {n} entries to draft', { n: willImport })}</button><button className="btn" type="button" disabled={!willImport || !!busy} title={T('Imports the entries as live, then opens the Publish window. Entries that still say TO WRITE are ignored by the bot until they are written.')} onClick={() => run(true)}>{T('Import and publish')}</button></div>
          <details className="moreopt"><summary>{T('More options')}</summary>
            <div className="form" style={{ marginTop: 6 }}>
              <label className="fld"><span>{T('If the entry already exists')}</span><select value={mode} onChange={(e) => setMode(e.target.value)}><option value="update">{T('Update it (languages in the file replace the old ones)')}</option><option value="skip">{T('Skip it')}</option></select></label>
              <label className="fld"><span>{T('New entries start as')}</span><select value={status} onChange={(e) => setStatus(e.target.value as 'draft' | 'live')}><option value="draft">{T('Draft (bot ignores them until you set them live)')}</option><option value="live">{T('Live')}</option></select></label></div>
            <div className="sub" style={{ marginTop: 6 }}>{T('Blocked entries are left out. Warnings do not stop an import. Updated entries keep their live or draft status.')}</div></details>
        </div></div>
      </div></div>
  );
}
