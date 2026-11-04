/* Control panel. The screens are the approved mockup; the data now comes from /api/admin (your database).
   Changes stay a draft in this browser until Publish, which saves them for the bot. */
let D = { merchants: [], tests: [] };
let S = null;
const api = async (path, body) => {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
  return r.json();
};
const DRAFT_KEY = 'aibot_panel_draft_v1';
function agoISO(iso) {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  return s < 90 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' hours ago' : Math.round(s / 86400) + ' days ago';
}
/** What the server stores: the panel's data without the display-only fields. */
function snapshotOf(st) {
  return { kb: st.kb.map(({ dirty, updated, ...e }) => e), aliases: st.aliases, mAliases: st.mAliases, aspects: st.aspects, smalltalk: st.smalltalk, guard: st.guard, fillers: st.fillers, settings: st.settings };
}
function makeState(srv) {
  const sn = srv.snapshot;
  return {
    role: 'admin', merchant: (srv.merchants[0] || {}).code || 'MERCH_A', view: 'kb', ver: srv.ver,
    kb: sn.kb.map((e) => ({ ...e, updated: agoISO(e.updated) })),
    aliases: sn.aliases, mAliases: sn.mAliases, aspects: sn.aspects, smalltalk: sn.smalltalk, guard: sn.guard, fillers: sn.fillers, settings: sn.settings,
    adv: false, rankExcluded: new Set(), rankWeek: 0, rankSort: { k: 'rank', d: 1 }, rankTab: 'all', rankSel: new Set(), rankQ: '', rankType: 'all', rankStatus: 'all', rankLang: 'all', rankShowEx: false,
    kwQ: '', kwLang: 'all', changes: [], kbFilter: '', kbStatus: 'all', kwTab: 'short', newSel: new Set(), stTab: 'all', stQ: '', stLang: 'all', stFrom: 'all', revTab: 'unmatched',
    kwJust: [], kwNew: new Set(), kwScroll: false, testsRun: false, testsStale: true, testFilter: 'all',
    review: { unmatched: {}, handoff: {}, abuse: {}, done: {} }, history: srv.history,
  };
}
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ ver: S.ver, changes: S.changes, snapshot: snapshotOf(S) })); } catch (e) { /* the panel works without it */ }
}
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ } }
function restoreDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!d || d.ver !== S.ver || !d.changes.length) { if (d) clearDraft(); return false; }
    const s = d.snapshot; Object.assign(S, { aliases: s.aliases, mAliases: s.mAliases, aspects: s.aspects, smalltalk: s.smalltalk, guard: s.guard, fillers: s.fillers, settings: s.settings });
    S.kb = s.kb.map((e) => ({ ...e, updated: 'edited', dirty: true })); S.changes = d.changes; return true;
  } catch (e) { return false; }
}
function discardDraft() { if (confirm('Throw away all unpublished changes?')) { clearDraft(); location.reload(); } }

/* ---------- keywords, ranking and review come from the server ---------- */
let KW = [], KWMAP = {}, RKC = {};
const RANK_TYPES_CLASS = (st) => st === 'Filler' ? 'filler' : st.startsWith('Question word') ? 'question' : st.startsWith('Greeting') ? 'greeting' : st.startsWith('Rude') ? 'rude' : 'other';
function classify(w) {
  const st = kwStatus(w).t;
  if (st === 'Not set yet') { const g = KWMAP[w] && KWMAP[w].guess; return g || 'other'; }   // not set yet: use the suggested type, if any
  if (st.startsWith('Topic:')) { const topic = st.slice(7).replace(' (this merchant)', ''); return w.toLowerCase() === topic ? 'topic' : 'slang'; }
  return RANK_TYPES_CLASS(st);
}
const baseRow = (w) => { const k = KWMAP[w]; return k ? { w: k.w, n: k.n, c: 0, lg: k.lg, h: k.h, t: classify(k.w) } : undefined; };
async function loadKeywords() {
  KW = await api('/api/admin/keywords?merchant=' + encodeURIComponent(S.merchant));
  KWMAP = Object.fromEntries(KW.map((k) => [k.w, k]));
  S.rankExcluded = new Set(KW.filter((k) => k.ignored).map((k) => k.w));
}
async function loadRanking() {
  if (!RKC[S.rankWeek]) RKC[S.rankWeek] = await api(`/api/admin/ranking?merchant=${encodeURIComponent(S.merchant)}&week=${S.rankWeek}`);
}
async function loadReview() {
  const m = S.merchant, r = await api('/api/admin/review?merchant=' + encodeURIComponent(m)), R = S.review;
  R.unmatched[m] = r.unmatched.map((x) => [x.text, x.lang, x.hits, x.hint, x.isNew, x.id]);
  R.handoff[m] = r.handoff.map((x) => [x.text, x.lang, x.why, x.when, x.id]);
  R.abuse[m] = r.abuse.map((x) => [x.text, x.why, x.when, x.outcome, x.id]);
  Object.keys(R.done).forEach((k) => { if (k.startsWith(m)) delete R.done[k]; });
  r.unmatched.forEach((x, i) => { if (x.done) R.done[m + 'unmatched' + i] = x.done; });
  r.handoff.forEach((x, i) => { if (x.done) R.done[m + 'handoff' + i] = x.done; });
  r.abuse.forEach((x, i) => { if (x.done) R.done[m + 'abuse' + i] = x.done; });
}
async function loadMerchantData() { RKC = {}; await Promise.all([loadKeywords(), loadReview()]); }
const idCol = { unmatched: 5, handoff: 4, abuse: 4 };
function markDone(kind, i, label) {
  S.review.done[S.merchant + kind + i] = label;
  const row = (S.review[kind][S.merchant] || [])[i];
  if (row) api('/api/admin/review/resolve', { kind, id: row[idCol[kind]], label }).catch(() => toast('Could not save that'));
}
function ignoreWord(w) { S.rankExcluded.add(w); api('/api/admin/keywords/ignore', { merchant: S.merchant, words: [w], ignored: true }).catch(() => toast('Could not save that')); }
function unignoreWord(w) { S.rankExcluded.delete(w); api('/api/admin/keywords/ignore', { merchant: S.merchant, words: [w], ignored: false }).catch(() => toast('Could not save that')); }
function rankRows(offArg) {
  const off = offArg === undefined ? S.rankWeek : offArg, d = RKC[off] || { rows: [], total: 0 };
  const rows = d.rows.map((r) => { const k = KWMAP[r.w]; return { ...r, t: classify(r.w), st: kwStatus(r.w), isNew: !!(k && k.isNew), share: d.total ? r.n / d.total * 100 : 0 }; });
  rows.total = d.total; return rows;
}
function dateLabel() { const d = RKC[S.rankWeek]; return d ? d.from + ' – ' + d.to : ''; }
const unassigned = () => storeRows().filter((r) => !r.ignored && r.st.t === 'Not set yet');
const storeRows = () => KW.map((k) => ({ w: k.w, n: k.n, c: 0, lg: k.lg, t: classify(k.w), h: k.h, isNew: k.isNew, st: kwStatus(k.w), first: k.first, last: k.last, ignored: S.rankExcluded.has(k.w), from: k.from }));

/* ---------- tests, publish, history ---------- */
async function fetchTests() {
  const r = await api('/api/admin/tests', { snapshot: snapshotOf(S), includeDrafts: false });
  D.tests = r.results; S.testsRun = true; S.testsStale = false; return r;
}
async function prefetch() {
  if (S.view === 'rank') { await loadRanking(); }
  if (S.view === 'rank' || S.view === 'store') await loadKeywords();
  if (S.view === 'rev') await loadReview();
  if (S.view === 'test' && (S.testsStale || !D.tests.length)) await fetchTests();
}
async function reloadAll() {
  const keep = { merchant: S.merchant, view: S.view, role: S.role, adv: S.adv };
  S = makeState(await api('/api/admin/state')); Object.assign(S, keep); await loadMerchantData(); render();
}

/* ---------- screens (from the approved mockup) ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const LANGS=['en','ms','zh'];
const ASPECT_LABEL={time:'time: how long it takes',limit:'limit: minimum or maximum',how:'how: how to do it',change:'change: update or fix',hours:'hours: opening hours'}; const LN={en:'EN',ms:'MS',zh:'ZH'};
const clone=o=>JSON.parse(JSON.stringify(o));

/* ---------- state (everything edited here is a DRAFT until Publish) ---------- */
const M=()=>D.merchants.find(m=>m.code===S.merchant);
const SET=()=>S.settings[S.merchant];
const isAdmin=()=>S.role==='admin';
const entries=()=>S.kb.filter(e=>e.merchant===S.merchant);
const topicList=()=>Object.keys(S.aliases).filter(k=>!['balance','transactions','points'].includes(k));
function change(txt){ S.changes.push(txt); S.testsStale=true; saveDraft(); renderChrome(); }
function toast(t){ const el=$('#toast'); el.textContent=t; el.hidden=false; clearTimeout(toast.t); toast.t=setTimeout(()=>el.hidden=true,2600); }
const LABEL={deposit:'Deposit',withdraw:'Withdrawal',password:'Password',verify:'Verification',customer_service:'Customer service',promotion:'Promotion',bank_account:'Bank account'};

/* ---------- chrome ---------- */
const NAV_ICON={kb:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/><path d="M9 8h6"/></svg>',imp:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',kw:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12 12 20 4 12V4h8z"/><circle cx="8.5" cy="8.5" r="1"/></svg>',store:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',rank:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 20V10M12 20V4M18 20v-7"/></svg>',chat:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',test:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 4 4 10-10"/></svg>',rev:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',set:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',hist:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/></svg>'};
/* The menu, in four groups. */
const NAV_GROUPS=[['Answers',[['kb','Knowledge base'],['imp','Import']]],['Words',[['kw','Topics'],['store','Keywords'],['rank','Keyword ranking']]],['Check',[['chat','Test chat'],['test','Tests'],['rev','Needs review']]],['Setup',[['set','Merchant settings'],['hist','History']]]];
function revCount(){ const r=S.review; return ['unmatched','handoff','abuse'].reduce((n,k)=>n+(r[k][S.merchant]||[]).filter((_,i)=>!r.done[S.merchant+k+i]).length,0); }
function renderChrome(){
  $('#merchant').innerHTML=D.merchants.filter(m=>isAdmin()||m.code==='MERCH_A').map(m=>`<option value="${m.code}" ${m.code===S.merchant?'selected':''}>${esc(m.name)}</option>`).join('');
  $('#ver').innerHTML='<span class="vchip"><i></i>Live v'+S.ver+'</span>'+(S.changes.length?'<span class="vchip warn">Draft · '+S.changes.length+' change'+(S.changes.length>1?'s':'')+'</span><button class="btn sm ghost" data-act="discardDraft" type="button">Discard</button>':'');
  $('#publish').disabled=!S.changes.length; $('#publish').innerHTML='Publish'+(S.changes.length?' <span class="badge">'+S.changes.length+'</span>':'');
  $('#nav').innerHTML=NAV_GROUPS.map(([g,items])=>`<div class="grp"><div class="gl">${g}</div>${items.map(([k,l])=>`<button type="button" data-view="${k}" ${k===S.view?'aria-current="page"':''}>${NAV_ICON[k]}<span>${l}</span>${k==='rev'&&revCount()?`<span class="cnt">${revCount()}</span>`:''}${k==='store'&&unassigned().length?`<span class="cnt">${unassigned().length}</span>`:''}</button>`).join('')}</div>`).join('');
}
async function render(){ renderChrome(); try{ await prefetch(); }catch(e){ toast('Could not load: '+e.message); } renderChrome(); ({kb:vKB,imp:vIMP,chat:vCHAT,kw:vKW,store:vSTORE,rank:vRANK,set:vSET,rev:vREV,test:vTEST,hist:vHIST})[S.view](); }

/* ---------- Knowledge base ---------- */
function langState(e,l){ const t=e.translations[l]||{}; const a=(t.answer_text||'').trim(), n=(t.question_examples||[]).length; return a&&n>=3?'on':(a||n)?'part':''; }
function vKB(){
  const list=entries().filter(e=>(S.kbStatus==='all'||e.status===S.kbStatus)&&(!S.kbFilter||(e.intent_key+' '+LANGS.map(l=>(e.translations[l]||{}).answer_text||'').join(' ')).toLowerCase().includes(S.kbFilter.toLowerCase())));
  const all=entries(); const live=all.filter(e=>e.status==='live').length, miss=all.filter(e=>LANGS.some(l=>langState(e,l)!=='on')).length;
  $('#main').innerHTML=`<div class="card"><div class="head"><div><h2>Knowledge base · ${esc(M().name)}</h2><div class="sub">What the bot may answer for this merchant. Only live entries are used.</div></div>
    <button class="btn pri" data-act="newEntry" type="button">Add entry</button></div>
    <div class="quiet"><b>${live}</b> live${all.length-live?` · <b>${all.length-live}</b> draft`:''}${miss?` · <b>${miss}</b> missing a language or examples`:''}</div>
    <div class="filt-row" style="margin-top:10px"><input type="search" id="kbq" placeholder="Search entries or answers" value="${esc(S.kbFilter)}" aria-label="Search" style="min-width:220px">
      <select id="kbs" aria-label="Status"><option value="all">All</option><option value="live" ${S.kbStatus==='live'?'selected':''}>Live</option><option value="draft" ${S.kbStatus==='draft'?'selected':''}>Draft</option></select></div></div>
    <div class="card scroll"><table><thead><tr><th>Entry</th><th>Topic${S.adv?' · question':''}</th><th>Languages</th><th>Answer (English)</th><th>Status</th></tr></thead><tbody>
    ${list.map(e=>`<tr class="row" data-edit="${e.id}"><td><b>${esc(e.intent_key)}</b></td>
      <td>${e.topic?`<span class="pill info">${esc(e.topic)}</span>`:'<span class="pill bad">missing</span>'}${S.adv&&e.aspect?` <span class="pill">${esc(e.aspect)}${e.topic_optional?' (alone)':''}</span>`:''}</td>
      <td><div class="dots">${LANGS.map(l=>`<span class="dot ${langState(e,l)}" title="${LN[l]}: ${langState(e,l)==='on'?'complete':langState(e,l)==='part'?'needs 3+ examples or an answer':'empty'}">${LN[l]}</span>`).join('')}</div></td>
      <td>${esc(((e.translations.en||{}).answer_text||'').slice(0,110))}</td>
      <td><span class="pill ${e.status==='live'?'ok':'warn'}">${e.status}</span>${e.dirty?' <span class="pill info">edited</span>':''}</td></tr>`).join('')||'<tr><td colspan="5" class="sub">No entries match.</td></tr>'}
    </tbody></table></div>`;
  $('#kbq').oninput=e=>{S.kbFilter=e.target.value; vKB(); const q=$('#kbq'); q.focus(); q.setSelectionRange(q.value.length,q.value.length);};
  $('#kbs').onchange=e=>{S.kbStatus=e.target.value; vKB();};
}
let ED=null;
function openEditor(id,prefill){
  const src=id?S.kb.find(e=>e.id===id):null;
  ED=src?clone(src):{id:0,merchant:S.merchant,intent_key:'',topic:'',aspect:null,topic_optional:false,status:'draft',translations:{en:{question_examples:[],answer_text:''},ms:{question_examples:[],answer_text:''},zh:{question_examples:[],answer_text:''}},category:'General'};
  LANGS.forEach(l=>ED.translations[l]=ED.translations[l]||{question_examples:[],answer_text:''});
  if(prefill) ED.translations[prefill.lang].question_examples.push(prefill.text);
  ED.useAspect=!!ED.aspect; ED.tab='en'; ED.sug={}; drawEditor();
}
function drawEditor(){
  const t=ED.translations[ED.tab]; const sug=ED.sug[ED.tab]||[];
  $('#layer').innerHTML=`<div class="ov" data-close="1"><div class="pane" role="dialog" aria-label="Edit entry">
    <div class="head"><h2>${ED.id?'Edit entry':'New entry'}</h2><button class="btn sm" data-act="closeEd" type="button">Close</button></div>
    <div class="form">
      <label class="fld"><span>Entry name</span><input type="text" id="ed_key" value="${esc(ED.intent_key)}" placeholder="e.g. daily_withdraw_limit"></label>
      <label class="fld"><span>Status</span><select id="ed_status"><option value="live" ${ED.status==='live'?'selected':''}>Live</option><option value="draft" ${ED.status==='draft'?'selected':''}>Draft (bot ignores it)</option></select></label>
      <label class="fld"><span>Topic (required)</span><select id="ed_topic"><option value="">Choose a topic word…</option>${topicList().map(x=>`<option ${ED.topic===x?'selected':''}>${x}</option>`).join('')}<option value="__new" ${ED.topic==='__new'?'selected':''}>+ New topic…</option></select></label>
      ${ED.topic==='__new'?`<label class="fld"><span>Name of the new topic</span><input type="text" id="ed_newtopic" placeholder="e.g. refund" value="${esc(ED.newTopic||'')}"></label>
      <label class="fld full"><span>Keywords for it (comma separated, any language, optional)</span><input type="text" id="ed_newtopicw" placeholder="e.g. refunds, bayaran balik, 退款" value="${esc(ED.newTopicW||'')}"></label>`:''}
      <label class="tog full" style="align-items:flex-start"><input type="checkbox" id="ed_useq" ${ED.useAspect?'checked':''} style="margin-top:3px"><span><b>Add a question type</b><br><span class="sub">Tick this only if the topic has more than one entry, for example deposit: how to, how long, limit. The question type tells the bot which one the customer means.</span></span></label>
      ${ED.useAspect?`<label class="fld"><span>Question type</span><select id="ed_aspect"><option value="">Choose a question type…</option>${Object.keys(S.aspects).map(x=>`<option value="${x}" ${ED.aspect===x?'selected':''}>${esc(ASPECT_LABEL[x]||x)}</option>`).join('')}</select></label>
      ${S.adv?`<label class="tog full"><input type="checkbox" id="ed_opt" ${ED.topic_optional?'checked':''}> The question type alone is enough (no topic word needed), for example opening hours</label>`:''}`:''}
    </div>
    <div class="note">The bot looks for the topic word anywhere in the customer's sentence and then gives this answer. If one topic has several entries, the customer is shown buttons to choose.</div>
    <div class="tabs" role="tablist">${LANGS.map(l=>`<button type="button" role="tab" data-tab="${l}" aria-selected="${l===ED.tab}">${LN[l]} <span class="dot ${langState(ED,l)}">${langState(ED,l)==='on'?'ok':langState(ED,l)==='part'?'!':'—'}</span></button>`).join('')}</div>
    <label class="fld"><span>Answer in ${LN[ED.tab]} (facts only; the bot adds the tone)</span><textarea id="ed_ans" lang="${ED.tab}">${esc(t.answer_text)}</textarea></label>
    <div><h3>Example questions (${t.question_examples.length}) <span class="sub">at least 3, include slang</span></h3>
      <div class="chips">${t.question_examples.map((x,i)=>`<span class="chip">${esc(x)}<button type="button" data-rmex="${i}" aria-label="Remove">×</button></span>`).join('')||'<span class="sub">None yet</span>'}</div>
      <div class="addrow"><input type="text" id="ed_newex" placeholder="Add an example, then press Enter" style="flex:1;min-width:180px"><button class="btn sm" data-act="addEx" type="button">Add</button><button class="btn sm" data-act="suggest" type="button">Suggest with AI</button></div></div>
    ${sug.length?`<div class="sug"><b style="font-size:12.5px">AI suggestions · need your approval</b>${sug.map((x,i)=>`<div class="it"><span>${esc(x)}</span><span><button class="btn sm" data-okS="${i}" type="button">Approve</button> <button class="btn sm" data-noS="${i}" type="button">Dismiss</button></span></div>`).join('')}</div>`:''}
    <div class="head" style="margin-top:auto"><span class="sub">Saved as a draft change until you publish.</span><span class="tools">${ED.id?`<button class="btn sm bad" data-act="delEntry" type="button">Delete</button>`:''}<button class="btn pri" data-act="saveEd" type="button">Save to draft</button></span></div>
  </div></div>`;
  $('#ed_topic').onchange=()=>{ syncEd(); drawEditor(); };
  $('#ed_useq').onchange=()=>{ syncEd(); drawEditor(); };
  const inp=$('#ed_newex'); inp.onkeydown=e=>{ if(e.key==='Enter'){ e.preventDefault(); addEx(); } };
}
function syncEd(){ if(!ED) return; const g=id=>document.getElementById(id);
  ED.intent_key=g('ed_key').value.trim(); ED.status=g('ed_status').value; ED.topic=g('ed_topic').value; ED.newTopic=(g('ed_newtopic')||{}).value||ED.newTopic||''; ED.newTopicW=(g('ed_newtopicw')||{}).value||ED.newTopicW||''; ED.useAspect=!!(g('ed_useq')&&g('ed_useq').checked); if(ED.useAspect){ if(g('ed_aspect')) ED.aspect=g('ed_aspect').value||null; if(g('ed_opt')) ED.topic_optional=g('ed_opt').checked; } else { ED.aspect=null; ED.topic_optional=false; } ED.translations[ED.tab].answer_text=g('ed_ans').value; }
function addEx(){ syncEd(); const v=$('#ed_newex').value.trim(); if(v){ ED.translations[ED.tab].question_examples.push(v); } drawEditor(); $('#ed_newex').focus(); }
function suggestFor(){ const ex=ED.translations[ED.tab].question_examples; const base=ex[0]||(ED.intent_key||'question').replace(/_/g,' ');
  const sfx={en:['pls','boss','ya'],ms:['tolong','boss','lah'],zh:['请问','老板','呀']}[ED.tab];
  return ED.tab==='zh'?[sfx[0]+base,base+sfx[2],sfx[1]+base]:[base+' '+sfx[0],sfx[1]+' '+base,base+' '+sfx[2]]; }
function saveEd(){ syncEd(); if(!ED.intent_key){ toast('Give the entry a name first'); return; }
  if(!(ED.translations.en.answer_text||'').trim()){ toast('Add the English answer first'); return; }
  if(ED.topic==='__new'){ const n=slug(ED.newTopic||''); if(!n){ toast('Type a name for the new topic'); return; }
    if(!S.aliases[n]){ const byl={en:[n],ms:[],zh:[]}; (ED.newTopicW||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).forEach(w=>{ const l=/[\u4e00-\u9fff]/.test(w)?'zh':'en'; if(!byl[l].includes(w)) byl[l].push(w); }); S.aliases[n]=byl; change('Added topic "'+n+'"'); }
    ED.topic=n; }
  if(!ED.topic){ toast('Choose a topic first. It is required.'); return; }
  if(ED.useAspect&&!ED.aspect){ toast('Choose a question type, or untick "Add a question type".'); return; }
  const clean=clone(ED); delete clean.tab; delete clean.sug; delete clean.newTopic; delete clean.newTopicW; delete clean.useAspect;
  if(ED.id){ const i=S.kb.findIndex(e=>e.id===ED.id); S.kb[i]={...S.kb[i],...clean,dirty:true}; change('Edited entry "'+ED.intent_key+'" ('+M().name+')'); }
  else { clean.id=Math.max(...S.kb.map(e=>e.id))+1; clean.dirty=true; S.kb.push(clean); change('Added entry "'+ED.intent_key+'" ('+M().name+')'); }
  ED=null; $('#layer').innerHTML=''; toast('Saved to draft'); render();
}

/* ---------- Import ---------- */
const COLS={intent_key:['intent_key','entry','entry_name','name'],topic:['topic','topic_word'],aspect:['question_type','aspect','type'],language:['language','lang'],examples:['question_examples','examples','questions'],answer:['answer_text','answer'],merchant:['merchant'],optional:['topic_optional','alone'],topicwords:['topic_short_forms','short_forms']};
const LANGMAP={en:'en',english:'en',ms:'ms',bm:'ms',malay:'ms','bahasa melayu':'ms',zh:'zh',cn:'zh',chinese:'zh',中文:'zh'};
function parseTable(text){
  text=text.replace(/^﻿/,''); const first=text.split(/\r?\n/)[0]||''; const d=first.includes('\t')?'\t':',';
  const rows=[]; let row=[],cur='',q=false;
  for(let i=0;i<text.length;i++){ const c=text[i];
    if(q){ if(c==='"'){ if(text[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=c; }
    else if(c==='"') q=true;
    else if(c===d){ row.push(cur); cur=''; }
    else if(c==='\n'||c==='\r'){ if(c==='\r'&&text[i+1]==='\n') i++; row.push(cur); cur=''; if(row.some(x=>x.trim()!=='')) rows.push(row); row=[]; }
    else cur+=c; }
  row.push(cur); if(row.some(x=>x.trim()!=='')) rows.push(row); return rows; }
const slug=s=>s.trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
function analyzeImport(text){
  const out={entries:[],skippedRows:0,fatal:null,rows:0}; if(!text.trim()) return out;
  const rows=parseTable(text); if(rows.length<2){ out.fatal='The file needs a header row and at least one data row.'; return out; }
  const head=rows[0].map(h=>h.trim().toLowerCase()); const idx={};
  for(const [k,names] of Object.entries(COLS)) idx[k]=head.findIndex(h=>names.includes(h));
  const miss=['intent_key','language','answer'].filter(k=>idx[k]<0);
  if(miss.length){ out.fatal='Missing column: '+miss.map(k=>COLS[k][0]).join(', ')+'. Found: '+head.join(', '); return out; }
  const groups=new Map(); const get=(r,k)=>idx[k]<0?'':(r[idx[k]]||'').trim();
  rows.slice(1).forEach((r,ri)=>{ out.rows++;
    const mc=get(r,'merchant'); if(mc&&![S.merchant.toLowerCase(),M().name.toLowerCase()].includes(mc.toLowerCase())){ out.skippedRows++; return; }
    const raw=get(r,'intent_key'); const key=slug(raw); const lg=LANGMAP[get(r,'language').toLowerCase()];
    let g=groups.get(key||('row'+ri)); if(!g){ g={key,raw,topic:'',aspect:'',optional:false,topicWords:[],langs:{},issues:[],errors:[],dups:0}; groups.set(key||('row'+ri),g); }
    if(!key){ g.errors.push('Row '+(ri+2)+': entry name is empty'); return; }
    if(raw!==key) g.fixedName=raw;
    if(!lg){ g.errors.push('Row '+(ri+2)+': unknown language "'+get(r,'language')+'" (use en, ms or zh)'); return; }
    if(g.langs[lg]) g.dups++;
    g.langs[lg]={answer:get(r,'answer'),examples:[...new Set(get(r,'examples').split(/\s*\|\s*|\n/).map(x=>x.trim()).filter(Boolean))]};
    if(!g.topic) g.topic=get(r,'topic').toLowerCase(); if(!g.aspect) g.aspect=get(r,'aspect').toLowerCase().replace(/^(none|topic alone|-|—)$/,'');
    if(/^(yes|true|1|y)$/i.test(get(r,'optional'))) g.optional=true;
    if(!g.topicWords.length) g.topicWords=get(r,'topicwords').split(/\s*\|\s*/).map(x=>x.trim().toLowerCase()).filter(Boolean);
  });
  for(const g of groups.values()){
    const ex=S.kb.find(e=>e.merchant===S.merchant&&e.intent_key===g.key); g.exists=!!ex; g.existing=ex;
    if(!g.key) { out.entries.push(g); continue; }
    if(!g.langs.en||!g.langs.en.answer) g.errors.push('The English answer is required');
    LANGS.forEach(l=>{ const x=g.langs[l]; if(!x){ if(!(ex&&(ex.translations[l]||{}).answer_text)) g.issues.push(LN[l]+' is missing'); return; }
      if(!x.answer) g.issues.push(LN[l]+': answer is empty'); if(x.examples.length<3) g.issues.push(LN[l]+': '+x.examples.length+' example question'+(x.examples.length===1?'':'s')+' (3 or more is better)'); });
    const topic=g.topic||(ex&&ex.topic)||''; if(!topic) g.errors.push('A topic is required. Put it in the topic column.'); else if(!topicList().includes(topic)) g.issues.push('New topic word "'+topic+'" will be created'+(g.topicWords.length?' with '+g.topicWords.length+' short form'+(g.topicWords.length>1?'s':''):'. Add short forms in Keywords.'));
    const asp=g.aspect||(ex&&ex.aspect)||''; if(asp&&!S.aspects[asp]) g.issues.push('Unknown question type "'+asp+'"');
    if(g.dups) g.issues.push(g.dups+' duplicate row'+(g.dups>1?'s':'')+' for the same language (the last one is used)');
    if(g.fixedName) g.issues.push('Name changed to "'+g.key+'" (lowercase letters and underscores)');
    out.entries.push(g);
  }
  return out;
}
function sampleCSV(){
  return `intent_key,topic,question_type,language,question_examples,answer_text
deposit_time,deposit,,en,"how long deposit take | dep not arrive | depo still pending | when deposit arrive","Deposits are usually credited within 3 minutes. If it takes longer, please send us your payment receipt."
deposit_time,deposit,,ms,"berapa lama deposit masuk | depo belum masuk | deposit lambat","Deposit biasanya dikreditkan dalam masa 3 minit. Jika lebih lama, sila hantar resit pembayaran anda."
daily_withdraw_limit,withdraw,,en,"daily withdraw limit | max wd per day | wd limit harian","You can withdraw up to MYR 50,000 per day."
daily_withdraw_limit,withdraw,,ms,"had pengeluaran harian | wd limit harian berapa | max wd sehari","Anda boleh mengeluarkan sehingga MYR 50,000 sehari."
daily_withdraw_limit,withdraw,,zh,"每日提款限额 | 一天最多提多少 | 提款每天限额","每天最多可提款MYR 50,000。"
refund_how,,,en,"refund how | how to get refund","Refunds are returned to your original payment method within 7 days."
Delete Account,account,,en,"how to delete account",""`; }
const TPL_HEAD='intent_key,topic,question_type,language,question_examples,answer_text\nexample_entry,deposit,time,en,"first example | second example | third example","The answer the bot may use, facts only."';
const csvCell=v=>/[",\n|]/.test(v)?'"'+String(v).replace(/"/g,'""')+'"':v;
function kbToCSV(){ const rows=[['intent_key','topic','question_type','language','question_examples','answer_text','status']];
  entries().forEach(e=>LANGS.forEach(l=>{ const t=e.translations[l]; if(t&&(t.answer_text||t.question_examples.length)) rows.push([e.intent_key,e.topic||'',e.aspect||'',l,t.question_examples.join(' | '),t.answer_text,e.status]); }));
  return rows.map(r=>r.map(csvCell).join(',')).join('\n'); }
function vIMP(){
  const I=S.imp=S.imp||{text:'',mode:'update',status:'draft',name:'',out:''}; const R=analyzeImport(I.text); I.R=R;
  const ok=R.entries.filter(g=>!g.errors.length); const nNew=ok.filter(g=>!g.exists).length, nUpd=ok.filter(g=>g.exists).length, nErr=R.entries.length-ok.length, nWarn=ok.filter(g=>g.issues.length).length;
  const willImport=ok.filter(g=>!(g.exists&&I.mode==='skip')).length;
  const dots=g=>LANGS.map(l=>{ const x=g.langs[l]; const st=x?(x.answer&&x.examples.length>=3?'on':'part'):(g.existing&&(g.existing.translations[l]||{}).answer_text?'on':''); return `<span class="dot ${st}">${LN[l]}</span>`; }).join('');
  $('#main').innerHTML=`<div class="card"><div class="head"><div><h2>Import knowledge base · ${esc(M().name)}</h2><div class="sub">Load a whole set from a file instead of typing it. Each merchant has its own file. Nothing goes live until you publish.</div></div></div>
    <div class="steps" style="margin-top:12px">
      <div class="step"><span class="n">1</span><div><b>Merchant</b><div class="sub">The file is imported into <b>${esc(M().name)}</b>. Change it in the sidebar. If the file has a <span class="mono">merchant</span> column, rows for other merchants are skipped.</div></div></div>
      <div class="step"><span class="n">2</span><div style="display:flex;flex-direction:column;gap:8px"><b>Add the file</b>
        <div class="drop"><div class="tools"><input type="file" id="imp_file" accept=".csv,.tsv,.txt" aria-label="Choose a CSV file"><button class="btn sm" data-act="impSample" type="button">Load a sample file</button><button class="btn sm" data-act="impTpl" type="button">Copy blank template</button><button class="btn sm" data-act="impKb" type="button">Copy this merchant's KB as CSV</button></div>
          <textarea id="imp_text" placeholder="Or paste CSV here (from Excel or Google Sheets works too)" aria-label="Paste CSV">${esc(I.text)}</textarea>
          ${I.name?`<div class="sub">Loaded: <b>${esc(I.name)}</b> <button class="btn sm" data-act="impClear" type="button">Clear</button></div>`:''}</div>
        <details><summary>File format</summary><div class="sub" style="margin-top:6px">One row for each entry and language. Use the same <span class="mono">intent_key</span> on every language row of an entry. Separate example questions with <span class="mono">|</span>.</div>
          <div class="scroll"><table><thead><tr><th>Column</th><th>Needed?</th><th>Example</th></tr></thead><tbody>
          <tr><td class="mono">intent_key</td><td>yes</td><td>deposit_time</td></tr><tr><td class="mono">language</td><td>yes</td><td>en, ms or zh</td></tr><tr><td class="mono">answer_text</td><td>yes (English at least)</td><td>Deposits are usually credited within 5 minutes.</td></tr>
          <tr><td class="mono">question_examples</td><td>recommended</td><td>how long deposit take | dep not arrive | depo pending</td></tr><tr><td class="mono">topic</td><td><b>yes</b></td><td>deposit, refund. A new one is created automatically.</td></tr><tr><td class="mono">topic_short_forms</td><td>optional</td><td>refunds | bayaran balik | 退款</td></tr>${S.adv?'<tr><td class="mono">question_type</td><td>optional</td><td>time, limit, how, change, hours</td></tr>':''}<tr><td class="mono">merchant</td><td>optional</td><td>MERCH_A or LuckyPay</td></tr></tbody></table></div>
          <div class="sub" style="margin-top:6px">Files made by this tool's "Copy KB as CSV" import back with no changes.</div></details>
        ${I.out?`<div><div class="sub">Copying was blocked here, so the text is shown. Select it and copy:</div><textarea readonly style="min-height:120px;font-family:var(--mono);font-size:12px;white-space:pre">${esc(I.out)}</textarea></div>`:''}
      </div></div>
      <div class="step"><span class="n">3</span><div style="flex:1;min-width:0"><b>Check</b>
        ${R.fatal?`<div class="note" style="background:var(--badbg);margin-top:6px">${esc(R.fatal)}</div>`:!R.entries.length?'<div class="sub">Add a file or paste text to see the check.</div>':`
        <div class="stats" style="margin:6px 0"><div class="stat"><b>${nNew}</b>new</div><div class="stat"><b>${nUpd}</b>update an existing entry</div><div class="stat"><b>${nWarn}</b>with warnings</div><div class="stat"><b>${nErr}</b>blocked</div>${R.skippedRows?`<div class="stat"><b>${R.skippedRows}</b>rows for other merchants skipped</div>`:''}</div>
        <div class="scroll"><table><thead><tr><th>Entry</th><th>Action</th><th>Topic · question</th><th>Languages</th><th>Check</th></tr></thead><tbody>
        ${R.entries.map(g=>{ const blocked=g.errors.length; const act=blocked?'<span class="pill bad">blocked</span>':g.exists?(I.mode==='skip'?'<span class="pill">skipped</span>':'<span class="pill info">update</span>'):'<span class="pill ok">new</span>';
          const topic=g.topic||(g.existing&&g.existing.topic)||'', asp=g.aspect||(g.existing&&g.existing.aspect)||'';
          return `<tr><td><b>${esc(g.key||'(no name)')}</b></td><td>${act}</td><td>${topic?`<span class="pill info">${esc(topic)}</span>`:'<span class="sub">none</span>'} ${asp?`<span class="pill">${esc(asp)}</span>`:''}</td><td><div class="dots">${dots(g)}</div></td>
          <td>${blocked?`<ul class="iss" style="color:var(--bad)">${g.errors.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}${g.issues.length?`<ul class="iss" style="color:var(--warn)">${g.issues.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:(!blocked?'<span class="pill ok">looks good</span>':'')}</td></tr>`; }).join('')}</tbody></table></div>`}
      </div></div>
      <div class="step"><span class="n">4</span><div><b>Import</b>
        <div class="form" style="margin-top:6px"><label class="fld"><span>If the entry already exists</span><select id="imp_mode"><option value="update" ${I.mode==='update'?'selected':''}>Update it (languages in the file replace the old ones)</option><option value="skip" ${I.mode==='skip'?'selected':''}>Skip it</option></select></label>
        <label class="fld"><span>New entries start as</span><select id="imp_status"><option value="draft" ${I.status==='draft'?'selected':''}>Draft (bot ignores them until you set them live)</option><option value="live" ${I.status==='live'?'selected':''}>Live</option></select></label></div>
        <div class="tools" style="margin-top:8px"><button class="btn pri" data-act="impRun" type="button" ${willImport?'':'disabled'}>Import ${willImport} entr${willImport===1?'y':'ies'} to draft</button><span class="sub">Blocked entries are left out. Warnings do not stop an import. Updated entries keep their live or draft status.</span></div></div></div>
    </div></div>`;
  $('#imp_text').oninput=e=>{ I.text=e.target.value; I.name=I.name&&I.text?I.name:''; I.out=''; const p=e.target.selectionStart; vIMP(); const t=$('#imp_text'); t.focus(); t.setSelectionRange(p,p); };
  $('#imp_file').onchange=e=>{ const f=e.target.files[0]; if(!f) return; const fr=new FileReader(); fr.onload=()=>{ I.text=String(fr.result); I.name=f.name; I.out=''; vIMP(); }; fr.readAsText(f,'utf-8'); };
  $('#imp_mode').onchange=e=>{ I.mode=e.target.value; vIMP(); }; $('#imp_status').onchange=e=>{ I.status=e.target.value; };
}
function impRun(){
  const I=S.imp, R=I.R; const ok=R.entries.filter(g=>!g.errors.length&&!(g.exists&&I.mode==='skip')); let nNew=0,nUpd=0;
  const needT=new Map(); ok.forEach(g=>{ const t=g.topic||(g.existing&&g.existing.topic); if(t){ const a=needT.get(t)||[]; g.topicWords.forEach(w=>a.push(w)); needT.set(t,a); } });
  needT.forEach((words,t)=>{ if(!S.aliases[t]){ S.aliases[t]={en:[t],ms:[],zh:[]}; change('Added topic word "'+t+'"'); }
    words.forEach(w=>{ const l=/[\u4e00-\u9fff]/.test(w)?'zh':'en'; S.aliases[t][l]=S.aliases[t][l]||[]; if(!Object.values(S.aliases[t]).flat().map(x=>x.toLowerCase()).includes(w)) S.aliases[t][l].push(w); }); });
  ok.forEach(g=>{
    const tr=(l)=>g.langs[l]?{question_examples:g.langs[l].examples,answer_text:g.langs[l].answer}:null;
    if(g.exists){ const e=g.existing; LANGS.forEach(l=>{ const x=tr(l); if(x&&(x.answer_text||x.question_examples.length)) e.translations[l]=x; }); if(g.topic) e.topic=g.topic; if(g.aspect) e.aspect=g.aspect; if(g.optional) e.topic_optional=true; e.dirty=true; nUpd++; }
    else { const id=Math.max(...S.kb.map(x=>x.id))+1; const tl={}; LANGS.forEach(l=>tl[l]=tr(l)||{question_examples:[],answer_text:''});
      S.kb.push({id,merchant:S.merchant,category:'Imported',intent_key:g.key,topic:g.topic||'',aspect:g.aspect||null,topic_optional:g.optional,translations:tl,status:I.status,dirty:true,updated:'just now'}); nNew++; }
  });
  change('Imported '+(nNew+nUpd)+' entries from '+(I.name||'pasted text')+' ('+nNew+' new, '+nUpd+' updated) for '+M().name);
  I.text=''; I.name=''; S.view='kb'; S.kbFilter=''; S.kbStatus='all'; render(); toast('Imported '+(nNew+nUpd)+' entries to draft');
}

/* ---------- Test chat: the real chat simulator, running on THIS draft ---------- */
let simTimer=null;
async function loadSim(){
  const inc=document.getElementById('sim_draft').checked; S.simDraft=inc;
  const f=document.getElementById('sim'); const info=document.getElementById('sim_info');
  try{
    const r=await api('/api/admin/draft',{snapshot:snapshotOf(S),includeDrafts:inc});
    f.src='/chat.html?draft='+r.draftId+'&merchant='+encodeURIComponent(S.merchant)+(isAdmin()?'':'&only=MERCH_A');
    const n=S.kb.filter(e=>e.merchant===S.merchant).length, d=S.kb.filter(e=>e.merchant===S.merchant&&e.status!=='live').length;
    info.innerHTML='Using <b>'+esc(M().name)+'</b>: '+(inc?n:n-d)+' entries'+(inc?' ('+d+' draft included)':' (live only, '+d+' draft left out)')+'. Last loaded just now.';
  }catch(e){ info.textContent='Could not start the test chat: '+e.message; }
}
async function liveInfo(){ const el=document.getElementById('sim_live'); if(!el) return;
  try{ const s=await api('/api/keywords/summary?merchant='+encodeURIComponent(S.merchant));
    el.innerHTML='Saved to Keywords for '+esc(M().name)+': <b>'+s.words+'</b> word'+(s.words===1?'':'s')+' · <b>'+s.unmatched+'</b> message'+(s.unmatched===1?'':'s')+' the bot did not understand. <button class="btn sm pri" data-kwgo="1" type="button">Keywords</button> <button class="btn sm" data-view="rank" type="button">Keyword ranking</button> <button class="btn sm" data-view="rev" type="button">Needs review</button>';
  }catch(e){ el.textContent=''; } }
window.addEventListener('message',async e=>{ const d=e.data; if(!d||d.kind!=='botlog') return; const f=document.getElementById('sim'); if(!f||e.source!==f.contentWindow) return;
  await loadMerchantData(); renderChrome(); liveInfo(); if(d.fresh&&d.fresh.length) toast('Saved to Keywords: '+d.fresh.slice(0,5).join(', ')+(d.fresh.length>5?'…':'')); });
function vCHAT(){
  const inc=S.simDraft!==false;
  $('#main').innerHTML=`<div class="card"><div class="head"><div><h2>Test chat</h2><div class="sub">Chat with your unpublished changes. Nothing goes live.</div></div>
    <div class="tools"><label class="tog" style="padding:0"><input type="checkbox" id="sim_draft" ${inc?'checked':''}> Include draft entries</label><button class="btn pri" data-act="simReload" type="button">Reload with my latest changes</button></div></div>
    <div class="quiet" id="sim_info"></div>
    <div class="quiet" id="sim_live"></div>
  </div>
    <iframe id="sim" title="Chat test" style="width:100%;height:820px;border:1px solid var(--line);border-radius:12px;background:var(--bg)"></iframe>`;
  loadSim(); liveInfo(); clearInterval(simTimer);
  simTimer=setInterval(()=>{ const f=document.getElementById('sim'); if(!f){ clearInterval(simTimer); return; } try{ const h=f.contentDocument.documentElement.scrollHeight; if(h>300) f.style.height=(h+4)+'px'; }catch(e){} },700);
}
/* ---------- Keywords ---------- */
const KW_TABS=[['short','Topics'],['aspect','Question words'],['small','Greetings'],['filler','Fillers'],['block','Block lists']];
const SMALL_NAMES={morning:'Morning greetings',greeting:'Other greetings',callout:'Calling for attention',thanks:'Thanks',bye:'Goodbye',ack:'Short acknowledgements'};
const ASPECT_NAMES={time:'Time (how long, pending, late)',limit:'Limit (minimum, maximum)',change:'Change (update, wrong)',hours:'Opening hours',how:'How to'};
const BLOCK_GROUPS=[['abuse','Rude words: reply kindly first','A message with any of these gets a friendly reply that asks for the problem. The chat closes only if the customer keeps being rude (see Merchant settings).'],
  ['abuse_soft','Mild words: only when alone or with other rude words','Harmless in names or normal text (md, cao, 吊). They count as rude only when they are the whole message, or come with another rude word.'],
  ['injection','Rule-change attempts: hand off','Messages that try to change the bot\'s rules go to a human.'],
  ['reveal_verb','Secret requests: asking words','Words like "show", "tell", "what is".'],
  ['secret_object','Secret requests: secret things','Password, full bank, card or ID number. Asking word + secret thing = polite refusal.'],
  ['secret_phrase','Secret requests: whole phrases','Phrases such as "what is my otp".'],
  ['reveal_except','Secret requests: exception words','If the message also has "change", "reset" or "forgot", it is a normal question.']];
const matchQ=(w,extra)=>{ const q=(S.kwQ||'').trim().toLowerCase(); return !q||String(w).toLowerCase().includes(q)||(extra&&String(extra).toLowerCase().includes(q)); };
const langOk=l=>!S.kwLang||S.kwLang==='all'||S.kwLang===l;
function chipGroup(byl,o){
  return LANGS.filter(l=>byl[l]&&langOk(l)).map(l=>{ const items=byl[l].map((w,i)=>[w,i]).filter(([w])=>matchQ(w,o.extra)); if(!items.length) return '';
    return `<div style="margin-bottom:6px"><span class="lang">${LN[l]}</span><div class="chips" style="display:inline-flex">${items.map(([w,i])=>`<span class="chip ${o.lock?'ro':''} ${S.kwNew.has(String(w).toLowerCase())?'new':''}">${esc(w)}${o.lock?'':`<button type="button" data-rm="${o.kind}" data-k="${esc(o.k)}" data-l="${l}" data-i="${i}" aria-label="Remove">×</button>`}</span>`).join('')}</div></div>`; }).join(''); }
const groupBlock=(title,sub,inner)=>inner?`<div class="group"><div class="lbl"><b>${esc(title)}</b><span class="lock">${esc(sub)}</span></div><div>${inner}</div></div>`:'';
/* ---- adding words: always confirm, never add a duplicate, show the new word ---- */

function kwDone(msg,chip,word){ if(word) S.kwNew.add(String(word).toLowerCase()); S.kwScroll=true; S.kwJust.unshift(chip); S.kwJust=S.kwJust.slice(0,8); S.kwQ=''; S.kwLang='all'; toast(msg); vKW(); }
function findDup(w){ const lw=w.toLowerCase(); const where=[];
  for(const [k,byl] of Object.entries(S.aliases)) for(const [l,vs] of Object.entries(byl)) if(vs.some(x=>x.toLowerCase()===lw)) where.push('a short form of "'+k+'"');
  const ma=S.mAliases[S.merchant].find(a=>a.variant.toLowerCase()===lw); if(ma) where.push('a short form of "'+ma.canonical+'" for '+M().name);
  for(const [k,byl] of Object.entries(S.aspects)) if(Object.values(byl).flat().some(x=>x.toLowerCase()===lw)) where.push('a question word ('+k+')');
  for(const [k,byl] of Object.entries(S.smalltalk)) if(Object.values(byl).flat().some(x=>x.toLowerCase()===lw)) where.push('a greeting phrase ('+k+')');
  if(Object.values(S.fillers).flat().some(x=>x.toLowerCase()===lw)) where.push('a filler word');
  for(const k of ['abuse','abuse_soft']) if(Object.values(S.guard[k]).flat().some(x=>x.toLowerCase()===lw)) where.push('a rude word');
  return where; }
function addAliasUI(){
  const v=$('#al_v').value.trim().toLowerCase(), k=$('#al_k').value, l=$('#al_l').value, sc=$('#al_s').value;
  if(!v){ toast('Type the short form first'); $('#al_v').focus(); return; }
  const dup=findDup(v); if(dup.length){ toast('"'+v+'" is already '+dup[0]+'. Nothing was added.'); return; }
  if(sc==='g'&&isAdmin()){ (S.aliases[k][l]=S.aliases[k][l]||[]).push(v); change('Added global short form "'+v+'" → '+k); kwDone('Added "'+v+'" → '+k+' (all merchants).',v+' → '+k+' · all merchants',v); }
  else { S.mAliases[S.merchant].push({language:l,variant:v,canonical:k}); change('Added short form "'+v+'" → '+k+' ('+M().name+')'); kwDone('Added "'+v+'" → '+k+' ('+M().name+' only). It is in the "'+k+'" group, on the '+M().name+' line.',v+' → '+k+' · '+M().name+' only',v); }
}
function addTopicUI(){
  const n=$('#tp_n').value.trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,''); if(!n){ toast('Type a name first'); $('#tp_n').focus(); return; }
  if(S.aliases[n]){ toast('The topic "'+n+'" already exists'); return; }
  const words=$('#tp_w').value.split(',').map(x=>x.trim().toLowerCase()).filter(Boolean); const byl={en:[n],ms:[],zh:[]};
  words.forEach(w=>{ const l=/[\u4e00-\u9fff]/.test(w)?'zh':'en'; if(!byl[l].includes(w)) byl[l].push(w); });
  S.aliases[n]=byl; change('Added topic "'+n+'"'); kwDone('Topic "'+n+'" created. You can now assign it to entries.','topic: '+n);
}
function addWordUI(kind){
  const f={filler:['fl_v',null,'fl_l'],aspect:['as_v','as_k','as_l'],small:['sm_v','sm_k','sm_l'],guard:['gd_v','gd_k','gd_l']}[kind];
  const v=$('#'+f[0]).value.trim().toLowerCase(), k=f[1]?$('#'+f[1]).value:null, l=$('#'+f[2]).value;
  if(!v){ toast('Type a word first'); $('#'+f[0]).focus(); return; }
  const dup=findDup(v); if(dup.length){ toast('"'+v+'" is already '+dup[0]+'. Nothing was added.'); return; }
  if(kind==='filler'){ (S.fillers[l]=S.fillers[l]||[]).push(v); change('Added filler word "'+v+'"'); kwDone('Added filler word "'+v+'".','filler: '+v,v); }
  if(kind==='aspect'){ (S.aspects[k][l]=S.aspects[k][l]||[]).push(v); change('Added question word "'+v+'" ('+k+')'); kwDone('Added question word "'+v+'" ('+k+').','question word: '+v+' · '+k,v); }
  if(kind==='small'){ (S.smalltalk[k][l]=S.smalltalk[k][l]||[]).push(v); change('Added greeting phrase "'+v+'"'); kwDone('Added greeting phrase "'+v+'".','greeting: '+v+' · '+k,v); }
  if(kind==='guard'){ (S.guard[k][l]=S.guard[k][l]||[]).push(v); change('Added to block list "'+v+'" ('+k+')'); kwDone('Added "'+v+'" to the block list.','block list: '+v+' · '+k,v); }
}
function kwLists(){
  const tab=S.kwTab, lock=!isAdmin(); let h='';
  if(tab==='short'){
    const mine=S.mAliases[S.merchant].map((a,i)=>[a,i]);
    const mineChips=(k)=>{ const it=mine.filter(([a])=>a.canonical===k&&langOk(a.language)&&matchQ(a.variant,k)); if(!it.length) return ''; return `<div style="margin-bottom:6px"><span class="lang">${esc(M().name)}</span><div class="chips" style="display:inline-flex">${it.map(([a,i])=>`<span class="chip ${S.kwNew.has(a.variant.toLowerCase())?'new':''}">${esc(a.variant)}<button type="button" data-rm="malias" data-i="${i}" aria-label="Remove">×</button></span>`).join('')}</div></div>`; };
    const known=Object.keys(S.aliases);
    Object.entries(S.aliases).forEach(([k,byl])=>{ h+=groupBlock(k,lock?'global · admin only':'global · all merchants',mineChips(k)+chipGroup(byl,{lock,kind:'alias',k,extra:k})); });
    const odd=mine.filter(([a])=>!known.includes(a.canonical)&&langOk(a.language)&&matchQ(a.variant,a.canonical));
    if(odd.length) h+=groupBlock(M().name+' only','this merchant',`<div class="chips">${odd.map(([a,i])=>`<span class="chip">${esc(a.variant+' → '+a.canonical)}<button type="button" data-rm="malias" data-i="${i}" aria-label="Remove">×</button></span>`).join('')}</div>`);
  }
  if(tab==='aspect') Object.entries(S.aspects).forEach(([k,byl])=>{ h+=groupBlock(k,(ASPECT_NAMES[k]||'')+(lock?' · admin only':''),chipGroup(byl,{lock,kind:'aspect',k,extra:k})); });
  if(tab==='small') Object.entries(S.smalltalk).forEach(([k,byl])=>{ h+=groupBlock(SMALL_NAMES[k]||k,lock?'global · admin only':'global',chipGroup(byl,{lock,kind:'small',k,extra:SMALL_NAMES[k]})); });
  if(tab==='filler') h+=groupBlock('Filler words','Words with no meaning of their own'+(lock?' · admin only':''),chipGroup(S.fillers,{lock,kind:'filler',k:'filler'}));
  if(tab==='block') BLOCK_GROUPS.forEach(([k,t,d])=>{ h+=groupBlock(t,d,chipGroup(S.guard[k]||{},{lock,kind:'guard',k,extra:t})); });
  return h||'<div class="sub">Nothing matches the filter.</div>';
}
function kwAdd(tab){
  const lock=!isAdmin(); const langSel=id=>`<label class="fld"><span>Language</span><select id="${id}">${LANGS.map(l=>`<option value="${l}">${LN[l]}</option>`).join('')}</select></label>`;
  if(tab==='short') return `${lock?'':`<div class="group"><div class="lbl"><b>New topic</b></div>
      <div class="addrow" style="margin-top:0"><label class="fld"><span>Topic name (one word, lowercase)</span><input type="text" id="tp_n" placeholder="e.g. refund"></label>
      <label class="fld w2"><span>Keywords (comma separated, any language)</span><input type="text" id="tp_w" placeholder="e.g. refunds, bayaran balik, 退款"></label>
      <button class="btn pri" data-act="addTopic" type="button">Create topic</button></div></div>`}
    <div class="group"><div class="lbl"><b>Add a keyword</b></div>
      <div class="addrow" style="margin-top:0"><label class="fld"><span>Keyword</span><input type="text" id="al_v" placeholder="e.g. depoo"></label>
      <label class="fld"><span>Topic</span><select id="al_k">${Object.keys(S.aliases).map(k=>`<option>${k}</option>`).join('')}</select></label>${langSel('al_l')}
      <label class="fld"><span>Applies to</span><select id="al_s"><option value="m">${esc(M().name)} only</option>${lock?'':'<option value="g">All merchants</option>'}</select></label>
      <button class="btn pri" data-act="addAlias" type="button">Add</button></div></div>`;
  if(lock) return '<div class="lock">Global lists are read-only for staff. You can request new words from an admin, or add short forms for your own merchant on the Short forms tab.</div>';
  if(tab==='aspect') return `<div class="addrow" style="margin-top:0"><label class="fld"><span>New word or phrase</span><input type="text" id="as_v" placeholder="e.g. cut off"></label><label class="fld"><span>Question type</span><select id="as_k">${Object.keys(S.aspects).map(k=>`<option>${k}</option>`).join('')}</select></label>${langSel('as_l')}<button class="btn pri" data-act="addAspect" type="button">Add</button></div>`;
  if(tab==='small') return `<div class="addrow" style="margin-top:0"><label class="fld"><span>New phrase</span><input type="text" id="sm_v" placeholder="e.g. hi moi"></label><label class="fld"><span>Type</span><select id="sm_k">${Object.keys(S.smalltalk).map(k=>`<option value="${k}">${esc(SMALL_NAMES[k]||k)}</option>`).join('')}</select></label>${langSel('sm_l')}<button class="btn pri" data-act="addSmall" type="button">Add</button></div>`;
  if(tab==='filler') return `<div class="addrow" style="margin-top:0"><label class="fld"><span>New filler word</span><input type="text" id="fl_v" placeholder="e.g. lh"></label>${langSel('fl_l')}<button class="btn pri" data-act="addFiller" type="button">Add</button></div>`;
  if(tab==='block') return `<div class="addrow" style="margin-top:0"><label class="fld"><span>New word</span><input type="text" id="gd_v" placeholder="word or phrase"></label><label class="fld"><span>List</span><select id="gd_k">${BLOCK_GROUPS.map(([k,t])=>`<option value="${k}">${esc(t)}</option>`).join('')}</select></label>${langSel('gd_l')}<button class="btn pri" data-act="addGuard" type="button">Add</button></div>`;
  return '';
}
const KW_INTRO={};
function vKW(){
  if(S.kwTab==='test'||S.kwTab==='new'||(!S.adv&&S.kwTab==='aspect')) S.kwTab='short';
  const tab=S.kwTab; const lock=!isAdmin();
  let inner='';
  {
    inner=`<details class="fold"><summary>＋ Add a topic or keyword</summary><div class="addbox">${kwAdd(tab)}</div></details>
    ${S.kwJust.length?`<div class="note" style="background:var(--okbg)"><b>Just added to the draft:</b> ${S.kwJust.map(x=>`<span class="chip new ro">${esc(x)}</span>`).join(' ')}</div>`:''}
    <div class="filt"><input type="search" id="kwq" placeholder="Filter words" aria-label="Filter words" value="${esc(S.kwQ)}" style="min-width:220px"><select id="kwl" aria-label="Language">${[['all','All languages'],['en','English'],['ms','Malay'],['zh','Chinese']].map(([v,l])=>`<option value="${v}" ${S.kwLang===v?'selected':''}>${l}</option>`).join('')}</select><span class="sub" id="kwcount"></span></div>
    <div id="kwlists">${kwLists()}</div>`;
  }
  $('#main').innerHTML=`<div class="card"><div class="head"><div><h2>Topics</h2><div class="sub">Each topic has the keywords that mean it. The bot looks for them anywhere in the customer's sentence.</div></div></div>
    <div class="tabs" role="tablist" style="margin-top:8px">${KW_TABS.filter(([k])=>S.adv||k!=='aspect').map(([k,l])=>`<button type="button" role="tab" data-kw="${k}" aria-selected="${k===tab}">${l}</button>`).join('')}</div>${lock?'<div class="note" style="margin:8px 0">You are signed in as staff: global lists are read-only. You can add short forms for your own merchant.</div>':''}
    <div style="margin-top:10px;display:flex;flex-direction:column;gap:10px">${inner}</div></div>`;
  {
    if(S.kwScroll){ S.kwScroll=false; setTimeout(()=>{ const c=document.querySelector('#kwlists .chip.new')||document.querySelector('.note .chip.new'); if(c) c.scrollIntoView({block:'nearest',behavior:'smooth'}); },60); } const upd=()=>{ $('#kwlists').innerHTML=kwLists(); $('#kwcount').textContent=document.querySelectorAll('#kwlists .chip').length+' words shown'; };
    $('#kwq').oninput=e=>{ S.kwQ=e.target.value; upd(); }; $('#kwl').onchange=e=>{ S.kwLang=e.target.value; upd(); }; upd(); }
}
/* ---------- Keyword ranking (words customers wrote most, like the live chat report) ---------- */
const RANK_TYPES={filler:['Filler','info'],slang:['Abbreviation','info'],topic:['Topic','ok'],question:['Question word','ok'],rude:['Rude word','bad'],greeting:['Greeting','info'],negation:['Negation',''],other:['Not classified','']};
const SAMPLES={lh:['tolong lah','cepat lah','boleh lah bos','lh lh lh'],tolonglh:['tolonglh','tolonglh dh lama','tolonglh bantu saya'],nk:['nk wd','nk tanya sikit','nk depo mcm mana'],dh:['dh 2 jam','dh bayar tak masuk','dh try banyak kali'],
 sial:['sial tak masuk lagi','sial la apa ni','sial duit hilang'],duit:['duit tak masuk','duit saya mana','nk tarik duit'],xde:['xde response','xde duit masuk','xde id'],babi:['babi punya sistem','babi lah lambat'],bodoh:['bodoh sistem ni','bodoh betul'],buka:['x boleh buka akaun','cs buka pukul berapa','buka game x boleh']};
function hashStr(s){ let h=7; for(const c of String(s)) h=(h*31+c.charCodeAt(0))>>>0; return h; }
function rnd(seed){ let s=seed>>>0; return ()=>{ s=(Math.imul(s,1664525)+1013904223)>>>0; return s/4294967296; }; }
function series(w,n,off){ const r=rnd(hashStr(w)+off*977); const base=[0.02,0.03,0.02,0.08,0.22,0.5,0.13].map(x=>x*(0.6+0.8*r())); const sum=base.reduce((a,b)=>a+b,0); const v=base.map(x=>Math.round(x/sum*n)); v[5]+=n-v.reduce((a,b)=>a+b,0); return v; }
function spark(v,w,h){ w=w||130; h=h||30; const mx=Math.max(...v,1); const pts=v.map((y,i)=>[4+i*(w-8)/(v.length-1),h-4-(y/mx)*(h-8)]);
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline fill="none" stroke="var(--accent)" stroke-width="1.6" stroke-linejoin="round" points="${pts.map(q=>q[0].toFixed(1)+','+q[1].toFixed(1)).join(' ')}"/></svg>`; }
function kwStatus(w){ const lw=w.toLowerCase(); const has=arr=>arr.some(x=>String(x).toLowerCase()===lw);
  for(const [k,byl] of Object.entries(S.aliases)) if(has(Object.values(byl).flat())) return {c:'ok',t:'Topic: '+k};
  const ma=S.mAliases[S.merchant].find(a=>a.variant.toLowerCase()===lw); if(ma) return {c:'ok',t:'Topic: '+ma.canonical+' (this merchant)'};
  for(const [k,byl] of Object.entries(S.aspects)) if(has(Object.values(byl).flat())) return {c:'ok',t:'Question word: '+k};
  for(const [k,byl] of Object.entries(S.smalltalk)) if(has(Object.values(byl).flat())) return {c:'ok',t:'Greeting list: '+k};
  if(has(Object.values(S.fillers).flat())) return {c:'ok',t:'Filler'};
  if(has(Object.values(S.guard.abuse).flat())) return {c:'bad',t:'Rude word'};
  if(has(Object.values(S.guard.abuse_soft).flat())) return {c:'warn',t:'Rude word (mild)'};
  return {c:'',t:'Not set yet'}; }
const chgPill=c=>`<span class="pill ${c>=0?'ok':'bad'}">${c>=0?'▲':'▼'} ${Math.abs(c)}%</span>`;
function medal(n){ const col={1:'#f0a81c',2:'#97a3b0',3:'#d27c2c'}[n]; return `<svg width="36" height="42" viewBox="0 0 36 42" aria-hidden="true"><polygon points="8,0 18,15 13,17 5,4" fill="#4c6ef5"/><polygon points="28,0 18,15 23,17 31,4" fill="#e5484d"/><circle cx="18" cy="26" r="13" fill="${col}"/><circle cx="18" cy="26" r="9.5" fill="none" stroke="rgba(255,255,255,.65)" stroke-width="1.5"/><text x="18" y="31" text-anchor="middle" font-size="14" font-weight="700" fill="#fff" font-family="sans-serif">${n}</text></svg>`; }
const RK_TABS=[['all','All'],['new','New from chat'],['unset','Needs a decision'],['filler','Fillers'],['slang','Abbreviations'],['rude','Rude words'],['meaning','Topics & other']];
const RK_MEANING=['topic','question','greeting','negation','other'];
const inTab=(r,t)=>t==='all'||(t==='new'?!!(r.isNew||r.live):t==='unset'?r.st.t==='Not set yet':t==='meaning'?RK_MEANING.includes(r.t):r.t===t);
const RK_TIPS={filler:'Words with no meaning of their own. The bot ignores them.',slang:'A short way to write a word. The bot turns it into the full word.',topic:'A subject the bot can answer about.',question:'Tells the bot what the customer wants to know.',rude:'Rude or abusive. The bot replies kindly first.',greeting:'A greeting, thanks or a call for attention.',negation:'A word meaning "not".',other:'Not classified yet.'};
function vRANK(){
  const rows=rankRows(); const total=rows.total; const vis=rows.filter(r=>S.rankShowEx||!S.rankExcluded.has(r.w)); vis.forEach((r,i)=>r.pos=i+1);
  const top=vis.slice(0,3); const exN=S.rankExcluded.size;
  const counts={}; RK_TABS.forEach(([k])=>counts[k]=vis.filter(r=>inTab(r,k)).length);
  const sumN=vis.reduce((s,r)=>s+r.n,0); const byType={}; vis.forEach(r=>byType[r.t]=(byType[r.t]||0)+r.n);
  const fillerShare=Math.round(((byType.filler||0)+(byType.slang||0))/Math.max(1,sumN)*100);
  const tabOf=t=>t==='filler'?'filler':t==='slang'?'slang':t==='rude'?'rude':'meaning';
  $('#main').innerHTML=`<div class="card"><div class="head"><div><h2>Keyword ranking</h2><div class="sub">The words customers wrote most in ${esc(M().name)} chats. Find fillers, short forms and rude words, and tell the bot what each one is.</div></div>
      <div class="tools"><button class="btn sm" data-rkweek="-1" type="button" ${S.rankWeek<=-4?'disabled':''} aria-label="Previous week">‹</button><span class="stat" style="padding:5px 12px"><b style="font-size:13px">Date</b>${dateLabel()}</span><button class="btn sm" data-rkweek="1" type="button" ${S.rankWeek>=0?'disabled':''} aria-label="Next week">›</button></div></div></div>
    <div class="quiet" style="margin:-4px 2px 0"><b>${total.toLocaleString()}</b> words written this week · <b>${vis.length}</b> different keywords · <b>${counts.unset}</b> need a decision</div>
    <div class="card rkfilter"><div class="head"><div class="segs" role="group" aria-label="Show">${RK_TABS.map(([k,l])=>`<button type="button" data-rktab="${k}" aria-pressed="${S.rankTab===k}">${l} <span class="n">${counts[k]}</span></button>`).join('')}</div>
      <div class="filt"><input type="search" id="rkq" placeholder="Filter keywords" aria-label="Filter keywords" value="${esc(S.rankQ)}" style="min-width:180px">
      <select id="rkl" aria-label="Language"><option value="all">All languages</option>${[['en','English'],['ms','Malay'],['zh','Chinese']].map(([v,l])=>`<option value="${v}" ${S.rankLang===v?'selected':''}>${l}</option>`).join('')}</select>
      <label class="tog" style="padding:0"><input type="checkbox" id="rkx" ${S.rankShowEx?'checked':''}> Show excluded${exN?' ('+exN+')':''}</label><span class="sub" id="rkcount"></span></div></div></div>
    <div class="card scroll" id="rktable"></div>`;
  const drawT=()=>{
    const q=S.rankQ.trim().toLowerCase();
    let list=vis.filter(r=>inTab(r,S.rankTab)&&(!q||r.w.toLowerCase().includes(q)||r.h.toLowerCase().includes(q))&&(S.rankLang==='all'||r.lg===S.rankLang));
    const k=S.rankSort.k, d=S.rankSort.d; const key={rank:r=>-r.n,n:r=>r.n,share:r=>r.share,c:r=>r.c,type:r=>r.t,st:r=>r.st.t,w:r=>r.w}[k];
    list=list.slice().sort((a,b)=>{ const x=key(a),y=key(b); const rv=(x>y?1:x<y?-1:0); return k==='rank'?rv*d:rv*(-d); });
    const maxShare=Math.max(...list.map(r=>r.share),1); const sel=S.rankSel; const allSel=list.length&&list.every(r=>sel.has(r.w));
    const th=(k,l,tip,cls)=>`<th class="sort ${cls||''}" data-rksort="${k}" title="${esc(tip||'')}">${l}${S.rankSort.k===k?(S.rankSort.d===1?' ▴':' ▾'):''}</th>`;
    const lock=!isAdmin();
    $('#rktable').innerHTML=`<div id="rkbulk"></div>
    <table style="min-width:940px"><thead><tr><th style="width:34px"><input type="checkbox" data-rkall="1" ${allSel?'checked':''} aria-label="Select all shown"></th>${th('rank','Rank','Position by count',' ')}${th('w','Keyword')}${th('type','Type')}<th>Trend</th>${th('n','Count','How many times customers wrote it. Repeating the same message counts.','num')}${th('c','Change','Compared with the previous 7 days.')}${th('st','Status','What the bot does with this word now.')}<th></th></tr></thead><tbody>
    ${list.map(r=>{ const ex=S.rankExcluded.has(r.w); const ty=RANK_TYPES[r.t]; const todo=r.st.t==='Not set yet';
      return `<tr class="${ex?'excl':''} ${todo&&!ex?'todo':''}"><td><input type="checkbox" data-rkcheck="${esc(r.w)}" ${sel.has(r.w)?'checked':''} aria-label="Select ${esc(r.w)}"></td><td>${r.pos}</td><td>${r.isNew?'<span class="pill info">New</span> ':''}<span class="kwlink" data-rkopen="${esc(r.w)}">${esc(r.w)}</span><div class="sub">${esc(r.h)}${r.live&&!r.isNew?' · +'+r.live+' from Test chat':''}${r.isNew&&r.live>1?' · '+r.live+' times':''}</div></td><td><span class="pill ${ty[1]}" title="${esc(RK_TIPS[r.t])}">${ty[0]}</span></td><td>${spark(r.series,110,28)}</td><td class="num">${r.n}</td>
      <td>${chgPill(r.c)}</td><td><span class="pill ${r.st.c}">${esc(r.st.t)}</span></td>
      <td style="white-space:nowrap;text-align:right">${ex?`<button class="btn sm" data-rkrestore="${esc(r.w)}" type="button">Restore</button>`:`<button class="btn sm" data-rkset="${esc(r.w)}" type="button">Set…</button> <button class="btn sm ghost" data-rkex="${esc(r.w)}" type="button">Exclude</button>`}</td></tr>`; }).join('')||'<tr><td colspan="10" class="sub">No keyword matches.</td></tr>'}</tbody></table>`;
    $('#rkcount').textContent=list.length+' keywords shown';
    window.__rkshown=list; drawBulk();
  };
  const drawBulk=()=>{
    const sel=S.rankSel, lock=!isAdmin(), list=window.__rkshown||[];
    $('#rkbulk').innerHTML=sel.size?`<div class="bulk"><b>${sel.size} selected</b><span class="tools"><button class="btn sm" data-rkbulk="filler" type="button" ${lock?'disabled':''}>Mark as filler</button><button class="btn sm" data-rkbulk="rude" type="button" ${lock?'disabled':''}>Mark as rude word</button><button class="btn sm" data-rkbulk="mild" type="button" ${lock?'disabled':''}>Mark as mild rude word</button><button class="btn sm" data-rkbulk="exclude" type="button">Exclude</button><button class="btn sm ghost" data-rkbulk="clear" type="button">Clear</button></span>${lock?'<span class="lock">Only admins can change these lists.</span>':''}</div>`:'';
    const all=document.querySelector('[data-rkall]'); if(all) all.checked=!!list.length&&list.every(r=>sel.has(r.w));
    document.querySelectorAll('[data-rkcheck]').forEach(c=>{ c.checked=sel.has(c.dataset.rkcheck); });
  };
  window.__rkbulkdraw=drawBulk;
  drawT();
  $('#rkq').oninput=e=>{ S.rankQ=e.target.value; drawT(); }; $('#rkl').onchange=e=>{ S.rankLang=e.target.value; drawT(); }; $('#rkx').onchange=e=>{ S.rankShowEx=e.target.checked; vRANK(); };
  window.__rkdraw=drawT; window.__rklist=()=>vis;
}
function assignWords(words,kind,topic){
  if(kind==='exclude'){ words.forEach(w=>ignoreWord(w)); return {done:words,skipped:[]}; }
  if(!isAdmin()&&kind!=='topic') return {err:'Only admins can change these lists'};
  const done=[],skipped=[];
  words.forEach(w=>{ if(kwStatus(w).t!=='Not set yet'){ skipped.push(w); return; }
    const r=baseRow(w)||{}; const lg=r.lg||(/[\u4e00-\u9fff]/.test(w)?'zh':'en'); const lw=w.toLowerCase();
    if(kind==='filler') (S.fillers[lg]=S.fillers[lg]||[]).push(lw);
    if(kind==='rude') (S.guard.abuse[lg]=S.guard.abuse[lg]||[]).push(lw);
    if(kind==='mild') (S.guard.abuse_soft[lg]=S.guard.abuse_soft[lg]||[]).push(lw);
    if(kind==='topic'){ if(isAdmin()){ (S.aliases[topic][lg]=S.aliases[topic][lg]||[]).push(lw); } else { S.mAliases[S.merchant].push({language:lg,variant:lw,canonical:topic}); } }
    done.push(w); });
  if(done.length) change(({filler:'Marked as filler words: ',rude:'Added rude words: ',mild:'Added mild rude words: ',topic:'Added keywords to topic "'+topic+'": '})[kind]+done.join(', '));
  return {done,skipped}; }
function bulkApply(kind){
  if(kind==='clear'){ S.rankSel.clear(); window.__rkbulkdraw(); return; }
  const words=[...S.rankSel]; if(!words.length) return;
  const res=assignWords(words,kind); if(res.err){ toast(res.err); return; }
  S.rankSel.clear(); vRANK(); toast(kind==='exclude'?words.length+' keywords ignored':res.done.length+' keyword'+(res.done.length===1?'':'s')+' added to the draft'+(res.skipped.length?' ('+res.skipped.length+' already set)':''));
}
async function openKwDrawer(w){ let real=[]; try{ real=await api('/api/admin/keywords/samples?merchant='+encodeURIComponent(S.merchant)+'&word='+encodeURIComponent(w)); }catch(e){}
  const r=rankRows().find(x=>x.w===w)||baseRow(w); const ty=RANK_TYPES[r.t]; const st=kwStatus(w);
  const sm=(real.length?real:(SAMPLES[w]||[w,'… '+w+' …','boss '+w])).map((s,i)=>`<div class="q"><div class="t">“${esc(s)}”</div><span class="sub">Customer ${i+1} · ${['Today','Today','Yesterday','2 days ago'][i%4]}</span></div>`).join('');
  $('#layer').innerHTML=`<div class="ov" data-close="1"><div class="pane" role="dialog" aria-label="Keyword chats"><div class="head"><h2>“${esc(w)}”</h2><button class="btn sm" data-act="closeEd" type="button">Close</button></div>
    <div class="kv"><span class="pill ${ty[1]}">${ty[0]}</span><span class="pill ${st.c}">${esc(st.t)}</span><span class="sub">${r.n} times · ${r.share!==undefined?r.share.toFixed(2)+'%':''}</span></div><div class="sub">${esc(r.h)}</div>
    <div><h3>Recent chats with this word (sample)</h3>${sm}</div>
    <div class="head" style="margin-top:auto"><span class="sub">Tell the bot what this word is.</span><button class="btn pri" data-rkset="${esc(w)}" type="button">Set…</button></div></div></div>`;
}
const SW_OPTS={newtopic:['Make it a new topic','Creates a new topic word from this keyword. Then assign the topic to entries in the Knowledge base.'],filler:['Filler','Ignored when looking for keywords. A message of only fillers gets a friendly reply, not a human.'],alias:['Add to an existing topic','Becomes another way to write that topic, for example wd → withdraw.'],aspect:['Question word','Tells the bot what the customer wants to know: time, limit, how, change, hours.'],greeting:['Greeting or thanks','Gets a friendly reply and topic buttons.'],rude_mild:['Rude word (mild)','Counts as rude only when it is the whole message, or comes with another rude word.'],rude_strong:['Rude word','The bot replies kindly first. The chat closes only if the customer keeps being rude.'],none:['Leave as it is','Nothing changes.']};
function openSetModal(w,preset){
  const r=baseRow(w)||{lg:/[一-鿿]/.test(w)?'zh':'en',h:''}; const st=kwStatus(w); const lock=!isAdmin();
  $('#layer').innerHTML=`<div class="ov c" data-close="1"><div class="pane modal" role="dialog" aria-label="Set keyword"><h2>What is “${esc(w)}”?</h2><div class="sub">Now: ${esc(st.t)}${r.h?' · '+esc(r.h):''}</div>
    <div class="form"><label class="fld full"><span>It is a</span><select id="sw_t">${Object.entries(SW_OPTS).filter(([k])=>S.adv||k!=='aspect').map(([k,v])=>`<option value="${k}" ${lock&&k!=='alias'&&k!=='none'?'disabled':''} ${k===((preset||{filler:'filler',slang:'alias',topic:'newtopic',question:S.adv?'aspect':'none',rude:'rude_strong',greeting:'greeting'}[r.t]||'none'))&&!lock?'selected':''}>${v[0]}</option>`).join('')}</select></label>
    <label class="fld" id="sw_nb"><span>Topic name (one word, lowercase)</span><input type="text" id="sw_name" value="${esc(/^[a-z0-9 _-]+$/i.test(w)?slug(w):'')}" placeholder="e.g. refund"></label>
    <label class="fld" id="sw_vb"><span id="sw_vl"></span><select id="sw_v"></select></label>
    <label class="fld"><span>Language</span><select id="sw_l">${LANGS.map(l=>`<option value="${l}" ${l===r.lg?'selected':''}>${LN[l]}</option>`).join('')}</select></label></div>
    <div class="note" id="sw_note"></div>${lock?'<div class="lock">Staff can only add short forms for their own merchant.</div>':''}
    <div class="head"><button class="btn" data-act="closeEd" type="button">Cancel</button><button class="btn pri" data-act="rkApply" data-w="${esc(w)}" type="button">Add to draft</button></div></div></div>`;
  if(lock) $('#sw_t').value='alias';
  const upd=()=>{ const t=$('#sw_t').value; const vb=$('#sw_vb'), v=$('#sw_v'), vl=$('#sw_vl'); $('#sw_note').textContent=SW_OPTS[t][1]; vb.hidden=!['alias','aspect','greeting'].includes(t); $('#sw_nb').hidden=t!=='newtopic';
    const opts={alias:[Object.keys(S.aliases),'Topic'],aspect:[Object.keys(S.aspects),'Question type'],greeting:[Object.keys(S.smalltalk),'Greeting type']}[t];
    if(opts){ vl.textContent=opts[1]; v.innerHTML=opts[0].map(x=>`<option>${x}</option>`).join(''); } };
  if(preset&&!lock) $('#sw_t').value=preset;
  $('#sw_t').onchange=upd; upd();
}
function unassign(w){ const lw=w.toLowerCase(); const rm=arr=>{ const i=arr.findIndex(x=>String(x).toLowerCase()===lw); if(i>=0) arr.splice(i,1); };
  Object.values(S.aliases).forEach(byl=>Object.values(byl).forEach(rm));
  S.mAliases[S.merchant]=S.mAliases[S.merchant].filter(a=>a.variant.toLowerCase()!==lw);
  Object.values(S.aspects).forEach(byl=>Object.values(byl).forEach(rm)); Object.values(S.smalltalk).forEach(byl=>Object.values(byl).forEach(rm));
  Object.values(S.fillers).forEach(rm); ['abuse','abuse_soft'].forEach(k=>Object.values(S.guard[k]).forEach(rm)); }
function applySet(){
  const w=$('[data-act="rkApply"]').dataset.w.toLowerCase(); const t=$('#sw_t').value, l=$('#sw_l').value, v=$('#sw_v')?$('#sw_v').value:'';
  const push=(obj,k)=>{ (obj[k]=obj[k]||[]); if(!obj[k].map(x=>x.toLowerCase()).includes(w)) obj[k].push(w); };
  if(t!=='none'&&kwStatus(w).t!=='Not set yet'&&!(t==='newtopic'&&S.aliases[slug($('#sw_name').value||'')])) unassign(w);
  if(t==='newtopic'){ const n=slug($('#sw_name').value||''); if(!n){ toast('Type a name for the topic first'); return; }
    if(S.aliases[n]){ toast('A topic named "'+n+'" already exists. Choose "Add to an existing topic" instead.'); return; }
    const byl={en:[n],ms:[],zh:[]}; if(w!==n){ (byl[l]=byl[l]||[]).push(w); } S.aliases[n]=byl; change('Made "'+w+'" a new topic: '+n); }
  if(t==='filler'){ push(S.fillers,l); change('Marked "'+w+'" as a filler word'); }
  if(t==='alias'){ if(isAdmin()){ S.aliases[v][l]=S.aliases[v][l]||[]; push(S.aliases[v],l); change('Added global short form "'+w+'" → '+v); } else { S.mAliases[S.merchant].push({language:l,variant:w,canonical:v}); change('Added short form "'+w+'" → '+v+' ('+M().name+')'); } }
  if(t==='aspect'){ push(S.aspects[v],l); change('Added question word "'+w+'" ('+v+')'); }
  if(t==='greeting'){ push(S.smalltalk[v],l); change('Added greeting phrase "'+w+'" ('+v+')'); }
  if(t==='rude_strong'){ push(S.guard.abuse,l); change('Added rude word "'+w+'"'); }
  if(t==='rude_mild'){ push(S.guard.abuse_soft,l); change('Added mild rude word "'+w+'"'); }
  $('#layer').innerHTML=''; toast(t==='none'?'No change':t==='newtopic'?'"'+w+'" is now a topic':'Added "'+w+'" to the draft'); if(S.view==='rank') vRANK(); if(S.view==='kw') vKW(); if(S.view==='store') vSTORE();
}
/* ---------- Keywords: every keyword saved automatically from chat ---------- */
const ST_TABS=[['all','All'],['unassigned','Not assigned'],['assigned','Assigned'],['ignored','Ignored']];
const stIn=(r,t)=>t==='all'||(t==='ignored'?r.ignored:t==='unassigned'?(!r.ignored&&r.st.t==='Not set yet'):(!r.ignored&&r.st.t!=='Not set yet'));
function stBulkHTML(){
  const sel=S.newSel; if(!sel.size) return ''; const lock=!isAdmin();
  return `<div class="bulk"><b>${sel.size} selected</b><span class="tools"><select id="nk_topic" aria-label="Topic">${Object.keys(S.aliases).map(k=>`<option>${k}</option>`).join('')}</select><button class="btn sm pri" data-nkbulk="topic" type="button">Add to this topic</button><button class="btn sm" data-nkbulk="filler" type="button" ${lock?'disabled':''}>Mark as filler</button><button class="btn sm" data-nkbulk="rude" type="button" ${lock?'disabled':''}>Mark as rude word</button><button class="btn sm" data-nkbulk="exclude" type="button">Ignore</button><button class="btn sm ghost" data-nkbulk="clear" type="button">Clear</button></span></div>`; }
function vSTORE(){
  const all=storeRows(); const counts={}; ST_TABS.forEach(([k])=>counts[k]=all.filter(r=>stIn(r,k)).length);
  const fresh=all.filter(r=>r.isNew).length;
  $('#main').innerHTML=`<div class="card"><div class="head"><div><h2>Keywords</h2><div class="sub">Every word customers type is saved here automatically. Make a keyword a topic, or add it to a topic.</div></div>
      </div><div class="quiet"><b>${all.length}</b> keywords saved · <b>${counts.unassigned}</b> not assigned yet</div></div>
    <div class="card rkfilter"><div class="head"><div class="segs" role="group" aria-label="Show">${ST_TABS.map(([k,l])=>`<button type="button" data-sttab="${k}" aria-pressed="${S.stTab===k}">${l} <span class="n">${counts[k]}</span></button>`).join('')}</div>
      <div class="filt"><input type="search" id="stq" placeholder="Filter keywords" aria-label="Filter keywords" value="${esc(S.stQ)}">
      <select id="stl" aria-label="Language"><option value="all">All languages</option>${[['en','English'],['ms','Malay'],['zh','Chinese']].map(([v,l])=>`<option value="${v}" ${S.stLang===v?'selected':''}>${l}</option>`).join('')}</select>
      <span class="sub" id="stcount"></span></div></div></div>
    <div class="card scroll"><div id="stbulk"></div><div id="sttable"></div></div>`;
  const draw=()=>{
    const q=S.stQ.trim().toLowerCase();
    const list=all.filter(r=>stIn(r,S.stTab)&&(!q||r.w.toLowerCase().includes(q)||r.h.toLowerCase().includes(q))&&(S.stLang==='all'||r.lg===S.stLang)).sort((a,b)=>b.n-a.n||a.w.localeCompare(b.w));
    window.__stshown=list; const sel=S.newSel, allSel=list.length&&list.every(r=>sel.has(r.w)); const lock=!isAdmin();
    $('#sttable').innerHTML=`<table style="min-width:960px"><thead><tr><th style="width:34px"><input type="checkbox" data-nkall="1" ${allSel?'checked':''} aria-label="Select all shown"></th><th>Keyword</th><th class="num">Heard</th><th>Language</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map(r=>{ const fresh=r.isNew||r.live; const todo=!r.ignored&&r.st.t==='Not set yet'; const stt=r.ignored?{c:'',t:'Ignored'}:r.st;
      const acts=r.ignored?`<button class="btn sm" data-strestore="${esc(r.w)}" type="button">Restore</button>`:todo?`<button class="btn sm pri" data-nkmk="${esc(r.w)}" type="button" ${lock?'disabled':''}>Make a topic</button> <button class="btn sm" data-nkadd="${esc(r.w)}" type="button">Add to a topic</button> <button class="btn sm ghost" data-stignore="${esc(r.w)}" type="button">Ignore</button>`:`<button class="btn sm" data-rkset="${esc(r.w)}" type="button">Change…</button> <button class="btn sm ghost" data-stignore="${esc(r.w)}" type="button">Ignore</button>`;
      return `<tr class="${r.ignored?'excl':''} ${todo?'todo':''}"><td><input type="checkbox" data-nkcheck="${esc(r.w)}" ${sel.has(r.w)?'checked':''} aria-label="Select ${esc(r.w)}"></td><td>${r.isNew?'<span class="pill info">New</span> ':''}<span class="kwlink" data-rkopen="${esc(r.w)}">${esc(r.w)}</span>${r.h&&!r.isNew?`<div class="sub">${esc(r.h)}</div>`:''}</td><td class="num">${r.n}${r.live&&!r.isNew?` <span class="sub">(+${r.live})</span>`:''}</td><td>${LN[r.lg]||r.lg}</td><td><span class="pill ${stt.c}">${esc(stt.t)}</span></td><td style="white-space:nowrap;text-align:right">${acts}</td></tr>`; }).join('')||'<tr><td colspan="6" class="sub">No keywords match. Words customers type are saved here automatically.</td></tr>'}</tbody></table>`;
    $('#stcount').textContent=list.length+' keywords shown'; window.__stbulk();
  };
  window.__stbulk=()=>{ $('#stbulk').innerHTML=stBulkHTML(); const all2=document.querySelector('[data-nkall]'); const l=window.__stshown||[]; if(all2) all2.checked=!!l.length&&l.every(r=>S.newSel.has(r.w)); document.querySelectorAll('[data-nkcheck]').forEach(c=>{ c.checked=S.newSel.has(c.dataset.nkcheck); }); };
  draw();
  $('#stq').oninput=e=>{ S.stQ=e.target.value; draw(); }; $('#stl').onchange=e=>{ S.stLang=e.target.value; draw(); };
}
/* ---------- Merchant settings ---------- */
function vSET(){
  const s=SET(); const lock=!isAdmin(); const TN={deposit_status:'Deposit status',withdraw_status:'Withdrawal status',balance:'Balance',transactions:'Recent transactions',points:'Points and level'};
  $('#main').innerHTML=`<div class="card"><div class="head"><div><h2>Merchant settings · ${esc(M().name)}</h2><div class="sub">How the bot behaves for this merchant.</div></div><button class="btn pri" data-act="saveSet" type="button">Save to draft</button></div>
    <div class="form" style="margin-top:12px">
      <label class="fld"><span>Tone of replies</span><select id="s_tone"><option value="friendly" ${s.tone==='friendly'?'selected':''}>Friendly</option><option value="formal" ${s.tone==='formal'?'selected':''}>Formal</option></select></label>
      <label class="fld"><span>Human group for handoff ${lock?'(admin only)':''}</span><input type="number" id="s_hg" value="${s.handoff_group}" ${lock?'disabled':''}></label>
      <div class="full"><div class="fld"><span>Answer when the match is at least ${s.answer.toFixed(2)}</span></div><div class="slider"><span class="sub">looser</span><input type="range" id="s_ans" min="0.5" max="0.95" step="0.01" value="${s.answer}" ${lock?'disabled':''}><span class="sub">stricter</span></div></div>
      <div class="full"><div class="fld"><span>Ask with buttons when the match is at least ${s.clarify.toFixed(2)}</span></div><div class="slider"><span class="sub">looser</span><input type="range" id="s_cl" min="0.2" max="0.7" step="0.01" value="${s.clarify}" ${lock?'disabled':''}><span class="sub">stricter</span></div></div>
    </div></div>
    <div class="card"><h3>Account tools ${lock?'<span class="lock">(admin only)</span>':''}</h3><div class="sub" style="margin-bottom:6px">A tool lets the bot read this customer's own data from the merchant's system, only after the signed login token is checked. An off tool hands the customer to a human.</div>
      ${Object.keys(s.tools).map(k=>`<label class="tog"><input type="checkbox" data-tool="${k}" ${s.tools[k]?'checked':''} ${lock?'disabled':''}> ${TN[k]} <span class="mono sub">${({deposit_status:'get_recent_deposits',withdraw_status:'get_recent_withdrawals',balance:'get_balance',transactions:'get_recent_transactions',points:'get_points'})[k]}</span></label>`).join('')}
      <div class="note" style="margin-top:8px">Always on and locked: the customer must be identified by a signed token. Passwords, OTP codes and full bank, card or ID numbers are never shown.</div></div>
    <div class="card"><h3>Rude or upset customers</h3><div class="sub">The bot replies kindly first, asks for the problem and offers an agent. It closes the chat only if the customer keeps being rude.</div>
      <div class="form" style="margin-top:8px"><label class="fld"><span>Close the chat after this many rude messages ${lock?'(admin only)':''}</span><input type="number" id="s_ab" min="0" max="10" value="${s.abuse_close_after}" ${lock?'disabled':''}><span class="lock">1 = close at the first rude message, 0 = never close</span></label></div></div>
    <div class="card"><h3>Fixed messages</h3><div class="tabs" role="tablist">${LANGS.map(l=>`<button type="button" role="tab" data-mtab="${l}" aria-selected="${l===(S.mtab||'en')}">${LN[l]}</button>`).join('')}</div>
      <div class="form" style="margin-top:8px"><label class="fld full"><span>Kind reply to a rude or upset customer (leave empty to use the standard reply)</span><textarea id="s_kind" lang="${S.mtab||'en'}">${esc(s.kind[S.mtab||'en'])}</textarea></label>
      <label class="fld full"><span>Last message before the chat is closed (after repeated rude messages)</span><textarea id="s_close" lang="${S.mtab||'en'}">${esc(s.closing[S.mtab||'en'])}</textarea></label>
      <label class="fld full"><span>Message when transferring to a human</span><textarea id="s_hand" lang="${S.mtab||'en'}">${esc(s.handoff[S.mtab||'en'])}</textarea></label></div></div>`;
}

/* ---------- Needs review ---------- */
function vREV(){
  const R=S.review, m=S.merchant, tab=S.revTab; const mk=(k)=>(R[k][m]||[]);
  const cnt=k=>mk(k).filter((_,i)=>!R.done[m+k+i]).length;
  let body='';
  if(tab==='unmatched') body=mk('unmatched').map((r,i)=>[r,i]).sort((a,b)=>(b[0][4]?1:0)-(a[0][4]?1:0)).map(([r,i])=>`<div class="q ${R.done[m+'unmatched'+i]?'done':''}"><div><div class="t">${r[4]?'<span class="pill info">New</span> ':''}“${esc(r[0])}”</div><div class="sub">${LN[r[1]]} · asked ${r[2]} times this week · Suggestion: ${esc(r[3])}</div></div>
      <div class="acts">${R.done[m+'unmatched'+i]?`<span class="pill ok">${esc(R.done[m+'unmatched'+i])}</span>`:`<button class="btn sm pri" data-newfrom="${i}" type="button">Write entry</button><button class="btn sm" data-kwfrom="${i}" type="button">Add as keyword</button><button class="btn sm" data-ign="unmatched${i}" type="button">Ignore</button>`}</div></div>`).join('')||'<div class="sub">Nothing to review.</div>';
  if(tab==='handoff') body=mk('handoff').map((r,i)=>`<div class="q ${R.done[m+'handoff'+i]?'done':''}"><div><div class="t">“${esc(r[0])}”</div><div class="sub">${r[3]} · Why a human: ${esc(r[2])}</div></div><div class="acts">${R.done[m+'handoff'+i]?`<span class="pill ok">${esc(R.done[m+'handoff'+i])}</span>`:`<button class="btn sm" data-ign="handoff${i}" type="button">Mark as reviewed</button>`}</div></div>`).join('')||'<div class="sub">Nothing to review.</div>';
  if(tab==='abuse') body=mk('abuse').map((r,i)=>`<div class="q ${R.done[m+'abuse'+i]?'done':''}"><div><div class="t">“${esc(r[0])}”</div><div class="sub">${r[2]} · ${esc(r[1])} · <b>${esc(r[3])}</b></div></div><div class="acts">${R.done[m+'abuse'+i]?`<span class="pill ok">${esc(R.done[m+'abuse'+i])}</span>`:`<button class="btn sm" data-ign="abuse${i}" data-lab="Reviewed" type="button">Reviewed</button>${/^Closed/.test(r[3])?`<button class="btn sm" data-reopen="${i}" type="button">Reopen chat</button>`:''}`}</div></div>`).join('')||'<div class="sub">Nothing to review.</div>';
  $('#main').innerHTML=`<div class="card"><div class="head"><div><h2>Needs review · ${esc(M().name)}</h2><div class="sub">The fastest way to make the bot better is to check these every week.</div></div></div>
    <div class="tabs" role="tablist" style="margin-top:8px">${[['unmatched','Not understood'],['handoff','Handed to a human'],['abuse','Rude messages']].map(([k,l])=>`<button type="button" role="tab" data-rev="${k}" aria-selected="${k===tab}">${l} (${cnt(k)})</button>`).join('')}</div>
    <div style="margin-top:6px">${body}</div></div>`;
}

/* ---------- Tests ---------- */
function vTEST(){
  const all=D.tests; const f=S.testFilter; const list=all.filter(t=>f==='all'||(f==='fail'?!t.ok:t.expected===f));
  const pass=all.filter(t=>t.ok).length; const kinds=[...new Set(all.map(t=>t.expected))];
  $('#main').innerHTML=`<div class="card"><div class="head"><div><h2>Tests</h2><div class="sub">Sample customer messages with the result the bot should give. Run them before every publish.</div></div><button class="btn pri" data-act="runTests" type="button">Run all tests</button></div>
    <div class="prog" style="margin-top:12px"><i id="prog" style="width:${S.testsRun?100:5}%"></i></div>
    <div class="quiet"><b id="tp">${S.testsRun?pass:0}</b> passed · <b id="tf">${S.testsRun?all.length-pass:0}</b> failed · ${all.length} total</div>
    <div class="tools" style="margin-top:10px"><select id="tfil" aria-label="Filter"><option value="all">All results</option><option value="fail" ${f==='fail'?'selected':''}>Failed only</option>${kinds.map(k=>`<option value="${k}" ${f===k?'selected':''}>Should be ${k}</option>`).join('')}</select></div></div>
    <div class="card scroll"><table><thead><tr><th>Customer message</th><th>Merchant</th><th>Should be</th><th>Bot gave</th><th></th></tr></thead><tbody>
    ${list.map(t=>`<tr><td>${esc(t.message)}</td><td class="sub">${esc((D.merchants.find(m=>m.code===t.merchant)||{}).name)}</td><td><span class="pill info">${t.expected}</span>${t.expIntent?` <span class="mono sub">${esc(t.expIntent)}</span>`:''}</td><td><span class="pill ${t.ok?'ok':'bad'}">${t.got}</span>${t.gotIntent?` <span class="mono sub">${esc(t.gotIntent)}</span>`:''}</td><td>${t.ok?'<span class="pill ok">pass</span>':'<span class="pill bad">fail</span>'}</td></tr>`).join('')}</tbody></table></div>`;
  $('#tfil').onchange=e=>{S.testFilter=e.target.value; vTEST();};
}
async function runTests(){ S.testsRun=false; D.tests=[]; vTEST(); const p=$('#prog'); let n=0; const id=setInterval(()=>{ n=Math.min(90,n+8); if(p) p.style.width=n+'%'; },120);
  try{ const r=await fetchTests(); clearInterval(id); vTEST(); toast(r.pass+' of '+r.total+' tests passed'); }catch(e){ clearInterval(id); S.testsRun=false; vTEST(); toast('Tests could not run: '+e.message); } }

/* ---------- History ---------- */
function vHIST(){
  $('#main').innerHTML=`<div class="card"><div class="head"><div><h2>History</h2><div class="sub">Every published version, who changed it, and when. Roll back if a change goes wrong.</div></div></div>
    <div style="margin-top:6px">${S.history.map((h,i)=>`<div class="q"><div><div class="t"><span class="mono">${esc(h[0])}</span> · ${esc(h[2])}</div><div class="sub">${esc(h[1])} · ${esc(h[3])}</div></div><div class="acts">${i===0?'<span class="pill ok">live</span>':`<button class="btn sm" data-roll="${esc(h[0])}" type="button">Roll back to this</button>`}</div></div>`).join('')}</div></div>`;
}

/* ---------- Publish ---------- */
async function openPublish(){
  if(!S.changes.length) return;
  $('#layer').innerHTML='<div class="ov c" data-close="1"><div class="pane modal" role="dialog" aria-label="Publish"><h2>Checking your changes…</h2><div class="note">Running the sample customer messages on your draft.</div></div></div>';
  let r; try{ r=await fetchTests(); }catch(e){ $('#layer').innerHTML=''; toast('Could not run the tests: '+e.message); return; }
  const fails=r.total-r.pass;
  $('#layer').innerHTML=`<div class="ov c" data-close="1"><div class="pane modal" role="dialog" aria-label="Publish"><h2>Publish ${S.changes.length} change${S.changes.length>1?'s':''}?</h2>
    <ul class="plain">${S.changes.map(c=>`<li>${esc(c)}</li>`).join('')}</ul>
    <div class="note" ${fails?'style="background:var(--warnbg)"':''}>Tests on the draft: <b>${r.pass} of ${r.total} passed</b>${fails?'. '+fails+' failed, see the Tests screen. You can still publish.':'.'} The bot starts using the new version straight away. You can roll back from History.</div>
    <div class="head"><button class="btn" data-act="closeEd" type="button">Cancel</button><button class="btn pri" data-act="doPublish" type="button">Publish v${S.ver+1}</button></div></div></div>`;
}
async function doPublish(){
  const btn=document.querySelector('[data-act="doPublish"]'); if(btn){ btn.disabled=true; btn.textContent='Publishing…'; }
  try{
    const r=await api('/api/admin/publish',{snapshot:snapshotOf(S),changes:S.changes,actor:isAdmin()?'admin':'staff'});
    clearDraft(); $('#layer').innerHTML=''; toast('Published as v'+r.ver); await reloadAll();
  }catch(e){ if(btn){ btn.disabled=false; btn.textContent='Publish v'+(S.ver+1); } toast('Publish failed: '+e.message); }
}
async function rollBack(v){
  if(S.changes.length&&!confirm('You have unpublished changes. Rolling back will discard them. Continue?')) return;
  if(!confirm('Roll back to '+v+'? The bot will use that version straight away.')) return;
  try{ const r=await api('/api/admin/rollback',{version:+v.slice(1),actor:isAdmin()?'admin':'staff'}); clearDraft(); toast('Rolled back. Now live as v'+r.ver); await reloadAll(); }
  catch(e){ toast('Rollback failed: '+e.message); }
}

/* ---------- events ---------- */
document.addEventListener('click',e=>{
  const t=e.target; const g=sel=>t.closest(sel);
  let el;
  if(g('[data-close]')&&t.classList.contains('ov')){ ED=null; $('#layer').innerHTML=''; return; }
  if(el=g('[data-view]')){ S.view=el.dataset.view; render(); return; }
  if(el=g('[data-edit]')){ openEditor(+el.dataset.edit); return; }
  if(el=g('[data-tab]')){ syncEd(); ED.tab=el.dataset.tab; drawEditor(); return; }
  if(el=g('[data-rmex]')){ syncEd(); ED.translations[ED.tab].question_examples.splice(+el.dataset.rmex,1); drawEditor(); return; }
  if(el=g('[data-okS]')){ syncEd(); const l=ED.sug[ED.tab]; ED.translations[ED.tab].question_examples.push(l.splice(+el.dataset.okS,1)[0]); drawEditor(); return; }
  if(el=g('[data-noS]')){ syncEd(); ED.sug[ED.tab].splice(+el.dataset.noS,1); drawEditor(); return; }
  if(el=g('[data-kwgo]')){ S.view='store'; render(); return; }
  if(el=g('[data-nkcheck]')){ if(el.checked) S.newSel.add(el.dataset.nkcheck); else S.newSel.delete(el.dataset.nkcheck); window.__stbulk(); return; }
  if(el=g('[data-nkall]')){ const on=el.checked; (window.__stshown||[]).forEach(r=>{ if(on) S.newSel.add(r.w); else S.newSel.delete(r.w); }); document.querySelectorAll('[data-nkcheck]').forEach(c=>{ c.checked=on; }); window.__stbulk(); return; }
  if(el=g('[data-nkbulk]')){ const k=el.dataset.nkbulk; if(k==='clear'){ S.newSel.clear(); vSTORE(); return; } const words=[...S.newSel]; if(!words.length) return; const topic=($('#nk_topic')||{}).value;
    const res=assignWords(words,k,topic); if(res.err){ toast(res.err); return; } S.newSel.clear(); vSTORE(); toast(k==='exclude'?words.length+' keywords ignored':res.done.length+' keyword'+(res.done.length===1?'':'s')+(k==='topic'?' added to the topic "'+topic+'"':' added to the draft')+(res.skipped.length?' ('+res.skipped.length+' already assigned)':'')); return; }
  if(el=g('[data-stignore]')){ ignoreWord(el.dataset.stignore); vSTORE(); toast('Ignored “'+el.dataset.stignore+'”'); return; }
  if(el=g('[data-strestore]')){ unignoreWord(el.dataset.strestore); vSTORE(); return; }
  if(el=g('[data-nkmk]')){ openSetModal(el.dataset.nkmk,'newtopic'); return; }
  if(el=g('[data-nkadd]')){ openSetModal(el.dataset.nkadd,'alias'); return; }
  if(el=g('[data-sttab]')){ S.stTab=el.dataset.sttab; S.newSel.clear(); vSTORE(); return; }
  if(el=g('[data-rktab]')){ S.rankTab=el.dataset.rktab; S.rankSel.clear(); vRANK(); return; }
  if(el=g('[data-rkcheck]')){ if(el.checked) S.rankSel.add(el.dataset.rkcheck); else S.rankSel.delete(el.dataset.rkcheck); window.__rkbulkdraw(); return; }
  if(el=g('[data-rkall]')){ const on=el.checked; document.querySelectorAll('[data-rkcheck]').forEach(c=>{ if(on) S.rankSel.add(c.dataset.rkcheck); else S.rankSel.delete(c.dataset.rkcheck); }); window.__rkbulkdraw(); return; }
  if(el=g('[data-rkbulk]')){ bulkApply(el.dataset.rkbulk); return; }
  if(el=g('[data-rkopen]')){ openKwDrawer(el.dataset.rkopen); return; }
  if(el=g('[data-rkset]')){ openSetModal(el.dataset.rkset); return; }
  if(el=g('[data-rkex]')){ ignoreWord(el.dataset.rkex); vRANK(); toast('Excluded “'+el.dataset.rkex+'” from the ranking'); return; }
  if(el=g('[data-rkrestore]')){ unignoreWord(el.dataset.rkrestore); vRANK(); return; }
  if(el=g('[data-rkweek]')){ S.rankWeek=Math.min(0,Math.max(-4,S.rankWeek+(+el.dataset.rkweek))); vRANK(); return; }
  if(el=g('[data-rksort]')){ const k=el.dataset.rksort; S.rankSort=S.rankSort.k===k?{k,d:-S.rankSort.d}:{k,d:1}; window.__rkdraw&&window.__rkdraw(); return; }
  if(el=g('[data-kw]')){ S.kwTab=el.dataset.kw; S.kwQ=''; S.kwJust=[]; S.kwNew=new Set(); vKW(); return; }
  if(el=g('[data-rev]')){ S.revTab=el.dataset.rev; vREV(); return; }
  if(el=g('[data-mtab]')){ S.mtab=el.dataset.mtab; vSET(); return; }
  if(el=g('[data-rm]')){ const k=el.dataset.rm, i=+el.dataset.i, kk=el.dataset.k, l=el.dataset.l;
    if(k==='alias'){ const w=S.aliases[kk][l].splice(i,1)[0]; change('Removed short form "'+w+'" → '+kk); }
    if(k==='malias'){ const a=S.mAliases[S.merchant].splice(i,1)[0]; change('Removed short form "'+a.variant+'" ('+M().name+')'); }
    if(k==='aspect'){ const w=S.aspects[kk][l].splice(i,1)[0]; change('Removed question word "'+w+'" ('+kk+')'); }
    if(k==='filler'){ const w=S.fillers[l].splice(i,1)[0]; change('Removed filler word "'+w+'"'); }
    if(k==='small'){ const w=S.smalltalk[kk][l].splice(i,1)[0]; change('Removed greeting phrase "'+w+'"'); }
    if(k==='guard'){ const w=S.guard[kk][l].splice(i,1)[0]; change('Removed from block list "'+w+'" ('+kk+')'); }
    vKW(); return; }
  if(el=g('[data-newfrom]')){ const r=S.review.unmatched[S.merchant][+el.dataset.newfrom]; markDone('unmatched',+el.dataset.newfrom,'entry drafted'); S.view='kb'; render(); openEditor(0,{lang:r[1],text:r[0]}); return; }
  if(el=g('[data-kwfrom]')){ const i=+el.dataset.kwfrom; const r=S.review.unmatched[S.merchant][i]; openKwPop(i,r); return; }
  if(el=g('[data-ign]')){ { const mm=/^([a-z]+)(\d+)$/.exec(el.dataset.ign); markDone(mm[1],+mm[2],el.dataset.lab||'reviewed'); } vREV(); renderChrome(); return; }
  if(el=g('[data-reopen]')){ markDone('abuse',+el.dataset.reopen,'reopened'); vREV(); renderChrome(); toast('Chat reopened. Consider moving that word to the mild list.'); return; }
  if(el=g('[data-roll]')){ rollBack(el.dataset.roll); return; }
  if(el=g('[data-pk]')){ const i=+el.dataset.pk, r=S.review.unmatched[S.merchant][i]; const v=$('#pk_v').value.trim(), kind=$('#pk_k').value; if(!v) return;
    const lang=r[1];
    if(kind==='alias'){ const k=$('#pk_m').value; S.mAliases[S.merchant].push({language:lang,variant:v.toLowerCase(),canonical:k}); change('Added short form "'+v+'" → '+k+' ('+M().name+')'); }
    else { const k=$('#pk_a').value; if(!isAdmin()){ toast('Only admins can add question words'); return; } S.aspects[k][lang].push(v.toLowerCase()); change('Added question word "'+v+'" ('+k+')'); }
    markDone('unmatched',i,'keyword added'); $('#layer').innerHTML=''; vREV(); return; }
  if(el=g('[data-act]')){ const a=el.dataset.act;
    if(a==='newEntry') openEditor(0);
    if(a==='closeEd'){ ED=null; $('#layer').innerHTML=''; }
    if(a==='addEx') addEx();
    if(a==='suggest'){ syncEd(); ED.sug[ED.tab]=suggestFor(); drawEditor(); }
    if(a==='saveEd') saveEd();
    if(a==='delEntry'){ const i=S.kb.findIndex(x=>x.id===ED.id); const n=S.kb[i].intent_key; S.kb.splice(i,1); change('Deleted entry "'+n+'" ('+M().name+')'); ED=null; $('#layer').innerHTML=''; render(); }
    if(a==='addAlias') addAliasUI();
    if(a==='addTopic') addTopicUI();
    if(a==='addFiller') addWordUI('filler');
    if(a==='addAspect') addWordUI('aspect');
    if(a==='addSmall') addWordUI('small');
    if(a==='addGuard') addWordUI('guard');
    if(a==='saveSet'){ const s=SET(); const g=id=>document.getElementById(id); s.tone=g('s_tone').value; if(isAdmin()){ s.handoff_group=+g('s_hg').value; s.answer=+g('s_ans').value; s.clarify=+g('s_cl').value; document.querySelectorAll('[data-tool]').forEach(c=>s.tools[c.dataset.tool]=c.checked); }
      if(isAdmin()) s.abuse_close_after=Math.max(0,Math.min(10,+g('s_ab').value||0)); const l=S.mtab||'en'; s.kind[l]=g('s_kind').value; s.closing[l]=g('s_close').value; s.handoff[l]=g('s_hand').value; change('Changed settings for '+M().name); toast('Saved to draft'); vSET(); }
    if(a==='runTests') runTests();
    if(a==='rkApply') applySet();
    if(a==='simReload'){ loadSim(); toast('Chat reloaded with your latest draft'); }
    if(a==='impSample'){ S.imp=S.imp||{mode:'update',status:'draft'}; S.imp.text=sampleCSV(); S.imp.name='sample_'+S.merchant.toLowerCase()+'.csv'; S.imp.out=''; vIMP(); }
    if(a==='impClear'){ S.imp.text=''; S.imp.name=''; vIMP(); }
    if(a==='impTpl'||a==='impKb'){ const txt=a==='impTpl'?TPL_HEAD:kbToCSV(); const done=()=>toast(a==='impTpl'?'Template copied':'KB copied as CSV'); const fail=()=>{ S.imp.out=txt; vIMP(); };
      try{ navigator.clipboard.writeText(txt).then(done,fail); }catch(err){ fail(); } }
    if(a==='impRun') impRun();
    if(a==='doPublish') doPublish();
    if(a==='discardDraft') discardDraft();
    return; }
});
document.addEventListener('input',e=>{ const t=e.target;
  if(t.id==='s_ans'){ t.closest('.full').querySelector('.fld span').textContent='Answer when the match is at least '+(+t.value).toFixed(2); }
  if(t.id==='s_cl'){ t.closest('.full').querySelector('.fld span').textContent='Ask with buttons when the match is at least '+(+t.value).toFixed(2); } });
function openKwPop(i,r){
  $('#layer').innerHTML=`<div class="ov c" data-close="1"><div class="pane modal" role="dialog" aria-label="Add keyword"><h2>Add as keyword</h2><div class="sub">From “${esc(r[0])}” (${LN[r[1]]})</div>
    <div class="form"><label class="fld full"><span>Word or phrase from the message</span><input type="text" id="pk_v" value="${esc(r[0].split(' ')[0])}"></label>
    <label class="fld"><span>It is a</span><select id="pk_k"><option value="alias">Short form of a topic</option><option value="aspect" ${isAdmin()?'':'disabled'}>Question word (admin)</option></select></label>
    <label class="fld"><span>Topic it means</span><select id="pk_m">${Object.keys(S.aliases).map(k=>`<option>${k}</option>`).join('')}</select></label>
    <label class="fld"><span>Or question type</span><select id="pk_a">${Object.keys(S.aspects).map(k=>`<option>${k}</option>`).join('')}</select></label></div>
    <div class="head"><button class="btn" data-act="closeEd" type="button">Cancel</button><button class="btn pri" data-pk="${i}" type="button">Add to draft</button></div></div></div>`;
}
$('#merchant').onchange=async e=>{S.merchant=e.target.value; S.newSel.clear(); S.rankSel.clear(); await loadMerchantData(); render();};
$('#role').onchange=async e=>{S.role=e.target.value; if(S.role==='staff'&&S.merchant!=='MERCH_A'){ S.merchant='MERCH_A'; await loadMerchantData(); } render();};
$('#publish').onclick=openPublish;
$('#adv').onchange=e=>{ S.adv=e.target.checked; if(!S.adv&&S.kwTab==='aspect') S.kwTab='short'; render(); };
document.addEventListener('keydown',e=>{ if(e.key==='Enter'&&e.target.matches&&e.target.matches('.addrow input')){ e.preventDefault(); const b=e.target.closest('.addrow').querySelector('.btn.pri'); if(b) b.click(); return; }
   if(e.key==='Escape'&&$('#layer').innerHTML){ ED=null; $('#layer').innerHTML=''; } });

(async function boot(){
  try{
    const srv=await api('/api/admin/state'); D.merchants=srv.merchants; S=makeState(srv);
    const restored=restoreDraft(); await loadMerchantData(); render();
    if(restored) toast('Restored your unpublished changes');
  }catch(e){ document.getElementById('main').innerHTML='<div class="card"><h2>Cannot reach the bot server</h2><div class="sub">'+esc(e.message)+'. Start it with <span class="mono">npm run dev</span> and refresh this page.</div></div>'; }
})();
